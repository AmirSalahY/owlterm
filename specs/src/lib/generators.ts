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

/** Connected Android devices/emulators, parsed from `adb devices -l`. */
export const adbDevices: Fig.Generator = {
  script: ["adb", "devices", "-l"],
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
