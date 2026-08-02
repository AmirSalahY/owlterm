// Shared generators for termauto specs.
//
// LATENCY IS THE PRIME CONSTRAINT: every generator here runs on the keystroke
// path. Two rules:
//   1. Prefer in-process `custom` + node:fs over spawning a shell. Reading
//      package.json is ~0ms; `sh -c cat package.json` is tens of ms.
//   2. Anything that shells out to a slow tool (xcodebuild, simctl) MUST set
//      `cache`, and its arg should set `debounce: true`.
//
// `generator.cache` is honoured by vendor/inshellisense/src/runtime/generatorCache.ts:
//   { ttl (ms), strategy: "max-age", cacheKey?, cacheByDirectory? }
// Omitting cacheKey makes the cache key include cwd + context tokens.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Walk up from `cwd` looking for a file — RN/monorepo layouts nest deeply. */
const findUp = (cwd: string, filename: string, limit = 12): string | undefined => {
  let dir = cwd;
  for (let i = 0; i < limit; i++) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
};

const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return undefined; // a malformed package.json must not break the dropdown
  }
};

/**
 * Script names from the nearest package.json.
 * In-process, so no shell spawn and no cache needed.
 */
export const packageScripts: Fig.Generator = {
  custom: async (_tokens, _exec, context) => {
    const pkgPath = findUp(context.currentWorkingDirectory, "package.json");
    if (!pkgPath) return [];
    const scripts = readJson(pkgPath)?.scripts;
    if (!scripts || typeof scripts !== "object") return [];
    return Object.entries(scripts).map(([name, cmd]) => ({
      name,
      description: typeof cmd === "string" ? cmd : undefined,
      icon: "fig://icon?type=npm",
      // Above plain options (45) and spec defaults (50): in a project, the script
      // you meant is almost always what you want first.
      priority: 75,
    }));
  },
};

/**
 * Resolve `adb` without assuming it is on PATH.
 *
 * The generator runs in the engine's environment, which is not necessarily the
 * interactive shell's — and plenty of setups never put platform-tools on PATH at
 * all. Falling back to the standard SDK locations (honouring ANDROID_HOME /
 * ANDROID_SDK_ROOT) is the difference between "no devices" and "works".
 */
const adbCandidates = (): string[] => {
  const home = os.homedir();
  const sdks = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean) as string[];
  return [
    "adb",
    ...sdks.map((s) => path.join(s, "platform-tools", "adb")),
    path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"), // macOS default
    path.join(home, "Android", "Sdk", "platform-tools", "adb"), // Linux default
    "/usr/local/bin/adb",
    "/opt/homebrew/bin/adb",
  ];
};

/** Connected Android devices/emulators, parsed from `adb devices -l`. */
export const adbDevices: Fig.Generator = {
  // `command -v` probes PATH first, then each known SDK location, and runs the
  // first one that exists. Exits quietly when Android tooling isn't installed.
  script: [
    "sh",
    "-c",
    adbCandidates()
      .map((c) => (c === "adb" ? `command -v adb >/dev/null 2>&1 && exec adb devices -l` : `[ -x "${c}" ] && exec "${c}" devices -l`))
      .join("; ") + "; exit 0",
  ],
  // Devices are global, not per-directory — a fixed cacheKey stops us
  // re-shelling once per directory for the same answer.
  cache: { ttl: 5_000, strategy: "max-age", cacheKey: "termauto:adb-devices" },
  postProcess: (out) =>
    out
      .split("\n")
      .slice(1) // drop "List of devices attached"
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [serial, state, ...rest] = line.split(/\s+/);
        if (!serial || state === "offline") return [];
        const model = rest.find((f) => f.startsWith("model:"))?.slice("model:".length);
        return [
          {
            name: serial,
            description: [model?.replace(/_/g, " "), state].filter(Boolean).join(" · ") || "device",
            icon: "fig://icon?type=android",
          },
        ];
      }),
};

/** Schemes from `xcodebuild -list -json`. SLOW (seconds) — cached aggressively. */
export const xcodeSchemes: Fig.Generator = {
  script: ["xcodebuild", "-list", "-json"],
  scriptTimeout: 20_000, // cold xcodebuild on a big project blows past the 5s default
  cache: { ttl: 120_000, strategy: "max-age", cacheByDirectory: true },
  postProcess: (out) => {
    try {
      const root = JSON.parse(out);
      // Shape differs between .xcodeproj and .xcworkspace
      const schemes: string[] = root?.project?.schemes ?? root?.workspace?.schemes ?? [];
      return schemes.map((name) => ({ name, description: "scheme", icon: "fig://icon?type=apple" }));
    } catch {
      return [];
    }
  },
};

/**
 * Available simulators from `xcrun simctl list devices -j`.
 *
 * `name` is the HUMAN-READABLE label and `insertValue` carries the udid, because:
 *   - the engine's toSuggestion() ignores `displayName` entirely (it only keeps
 *     name/description/icon/allNames/priority/insertValue/type/hidden), so a udid
 *     in `name` means a dropdown of unreadable hex; and
 *   - the default filter strategy is prefix-on-name, so a readable name is also
 *     what makes typing "iPhone 17" narrow the list.
 * The runtime is appended to keep names unique — removeDuplicateSuggestion()
 * dedupes by name, which would otherwise silently drop same-named devices from
 * different runtimes.
 */
export const simulators: Fig.Generator = {
  script: ["xcrun", "simctl", "list", "devices", "available", "-j"],
  scriptTimeout: 15_000,
  cache: { ttl: 60_000, strategy: "max-age", cacheKey: "termauto:simctl-devices" },
  postProcess: (out) => {
    try {
      const byRuntime = JSON.parse(out)?.devices ?? {};
      return Object.entries<any>(byRuntime).flatMap(([runtime, devices]) => {
        const shortRuntime = runtime.split(".").pop() ?? runtime;
        return (devices ?? [])
          .filter((d: any) => d.isAvailable !== false)
          .map((d: any) => ({
            name: `${d.name} · ${shortRuntime}`,
            insertValue: d.udid,
            description: `${d.state} · ${d.udid}`,
            icon: "fig://icon?type=apple",
            // Surface an already-booted simulator first — usually the intended target.
            priority: d.state === "Booted" ? 80 : 60,
          }));
      });
    } catch {
      return [];
    }
  },
};

/** Target names declared in the nearest Podfile. */
export const podfileTargets: Fig.Generator = {
  custom: async (_tokens, _exec, context) => {
    const podfile = findUp(context.currentWorkingDirectory, "Podfile");
    if (!podfile) return [];
    let contents: string;
    try {
      contents = fs.readFileSync(podfile, "utf-8");
    } catch {
      return [];
    }
    const targets = [...contents.matchAll(/^\s*target\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    return [...new Set(targets)].map((name) => ({
      name,
      description: "Podfile target",
      icon: "fig://icon?type=apple",
    }));
  },
};

/** Gradle tasks, best-effort. Kept opt-in: `gradlew tasks` can take 10s+. */
export const gradleTasks: Fig.Generator = {
  script: ["sh", "-c", "./gradlew -q tasks --all 2>/dev/null || gradle -q tasks --all 2>/dev/null"],
  scriptTimeout: 30_000,
  cache: { ttl: 300_000, strategy: "max-age", cacheByDirectory: true },
  postProcess: (out) =>
    out
      .split("\n")
      .flatMap((line) => {
        // "taskName - description"
        const m = /^([a-zA-Z][\w:]*)\s+-\s+(.*)$/.exec(line.trim());
        return m ? [{ name: m[1], description: m[2], icon: "fig://icon?type=gradle" }] : [];
      }),
};

// ── Laravel ───────────────────────────────────────────────────────────────────

/** Directory containing `filename`, walking up from cwd. */
const findUpDir = (cwd: string, filename: string, limit = 12): string | undefined => {
  const found = findUp(cwd, filename, limit);
  return found ? path.dirname(found) : undefined;
};

type ArtisanOption = { name?: string; shortcut?: string; description?: string };
type ArtisanCommand = {
  name?: string;
  description?: string;
  hidden?: boolean;
  definition?: { options?: Record<string, ArtisanOption> };
};

/**
 * `artisan list --format=json` for the project containing cwd.
 *
 * Memoised per project root rather than via `generator.cache`, because two
 * generators (command names, and that command's options) need the SAME payload —
 * the engine's cache is keyed per generator, so without this the list would be
 * fetched twice for one keystroke.
 *
 * ~300ms cold on a real app, which is why nothing here runs unless an `artisan`
 * file actually exists above cwd.
 */
const artisanCacheTtl = 60_000;
const artisanCache = new Map<string, { at: number; commands: ArtisanCommand[] }>();

const loadArtisanCommands = async (cwd: string, exec: Fig.ExecuteCommandFunction): Promise<ArtisanCommand[]> => {
  const root = findUpDir(cwd, "artisan");
  if (!root) return []; // not a Laravel project — never spawn php

  const cached = artisanCache.get(root);
  if (cached && Date.now() - cached.at < artisanCacheTtl) return cached.commands;

  try {
    const { stdout } = await exec({ command: "php", args: ["artisan", "list", "--format=json"], cwd: root });
    const parsed = JSON.parse(stdout);
    const commands: ArtisanCommand[] = Array.isArray(parsed?.commands) ? parsed.commands : [];
    artisanCache.set(root, { at: Date.now(), commands });
    return commands;
  } catch {
    // No php, a boot error in the app, or non-JSON output. A broken app must not
    // break the dropdown — fall back to no suggestions.
    return [];
  }
};

/**
 * The command being completed, given the raw tokens.
 *
 * Handles `artisan x`, `./artisan x` and `php artisan x` alike by anchoring on
 * the artisan token rather than a fixed index.
 */
const artisanSubcommand = (tokens: string[]): string | undefined => {
  const anchor = tokens.findIndex((t) => t === "artisan" || t.endsWith("/artisan"));
  const rest = tokens.slice(anchor === -1 ? 1 : anchor + 1);
  return rest.find((t) => t.length > 0 && !t.startsWith("-"));
};

/** Every artisan command the project actually has, including package-provided ones. */
export const artisanCommands: Fig.Generator = {
  custom: async (tokens, exec, context) => {
    const commands = await loadArtisanCommands(context.currentWorkingDirectory, exec);
    return commands
      .filter((c) => c.name && !c.hidden)
      .map((c) => ({
        name: c.name!,
        description: c.description,
        icon: "fig://icon?type=command",
        // Above spec defaults: in a Laravel project the artisan command you meant
        // is the point of typing `artisan` at all.
        priority: 75,
      }));
  },
};

/** Options for whichever artisan command has already been typed. */
export const artisanCommandOptions: Fig.Generator = {
  custom: async (tokens, exec, context) => {
    const name = artisanSubcommand(tokens);
    if (!name) return [];
    const commands = await loadArtisanCommands(context.currentWorkingDirectory, exec);
    const options = commands.find((c) => c.name === name)?.definition?.options ?? {};
    return Object.values(options)
      .filter((o) => o.name)
      .map((o) => ({
        name: o.shortcut ? [o.shortcut, o.name!] : o.name!,
        description: o.description,
        type: "option" as const,
      }));
  },
};
