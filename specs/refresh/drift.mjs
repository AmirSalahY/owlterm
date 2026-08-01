// Spec drift report.
//
// Why this exists: the bundled Fig corpus is FROZEN. withfig/autocomplete's last
// commit is 2025-05-05 and @withfig/autocomplete@2.692.3 was published the same
// day (inshellisense pins the even older 2.675.0), because Fig was absorbed into
// Amazon Q — since renamed Kiro — and the spec repo went dormant. So flags added
// to these tools since mid-2025 are simply missing.
//
// This compares each tool's LIVE `--help` output against the bundled spec and
// reports flags that exist on your machine but not in the spec.
//
// It reports; it does not silently rewrite specs. `--help` parsing is heuristic:
// it cannot recover descriptions reliably, cannot tell a global flag from a
// subcommand-scoped one, and happily invents flags out of usage examples. Treat
// the output as a work list, and `--scaffold` output as a draft to edit.
//
// Usage:
//   node specs/refresh/drift.mjs                 # report all known targets
//   node specs/refresh/drift.mjs adb pnpm        # only these
//   node specs/refresh/drift.mjs --scaffold adb  # also emit a draft override spec
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const specResourcesPath = path.join(os.homedir(), ".inshellisense", "spec");

// Priority targets: the stacks in daily use.
//
// `helpArgs` differs per tool because several don't support `--help` (adb,
// xcodebuild) or write help to stderr.
//
// `subcommands` matters for topic-style CLIs (oclif: eas, expo). Their top-level
// `--help` lists only topics and no flags at all, so a top-level-only scrape
// reports "0 live flags" and hides everything worth checking. Each listed
// subcommand is scraped as `<bin> <sub> --help` and compared against that
// subcommand's own options in the spec.
const TARGETS = {
  adb: { bin: "adb", helpArgs: ["help"] },
  pnpm: { bin: "pnpm", helpArgs: ["--help"] },
  bun: { bin: "bun", helpArgs: ["--help"] },
  yarn: { bin: "yarn", helpArgs: ["--help"] },
  eas: { bin: "eas", helpArgs: ["--help"], subcommands: ["build", "submit", "update", "credentials", "deploy"] },
  gradle: { bin: "gradle", helpArgs: ["--help"] },
  flutter: { bin: "flutter", helpArgs: ["--help"], subcommands: ["build", "run", "test"] },
  xcodebuild: { bin: "xcodebuild", helpArgs: ["-usage"] },
  git: { bin: "git", helpArgs: ["--help"], subcommands: ["checkout", "commit", "push", "rebase", "switch"] },
  docker: { bin: "docker", helpArgs: ["--help"], subcommands: ["build", "run", "compose"] },
};

const loadSpec = async (name) => {
  const file = path.join(specResourcesPath, `${name}.js`);
  if (!fs.existsSync(file)) return null;
  try {
    const spec = (await import(pathToFileURL(file).href)).default;
    return typeof spec === "object" && spec != null ? spec : null;
  } catch (e) {
    console.error(`  ! could not import bundled spec '${name}': ${e.message}`);
    return null;
  }
};

const collectOptionNames = (node, into) => {
  for (const o of node?.options ?? []) {
    for (const n of Array.isArray(o.name) ? o.name : [o.name]) into.add(n);
  }
  return into;
};

/** Flags the spec declares, flattened across options and one subcommand level. */
const specFlags = (spec) => {
  const flags = new Set();
  const walk = (node, depth) => {
    collectOptionNames(node, flags);
    if (depth > 0) for (const sub of node.subcommands ?? []) walk(sub, depth - 1);
  };
  walk(spec, 1);
  return flags;
};

const findSubcommand = (spec, name) =>
  (spec.subcommands ?? []).find((s) => (Array.isArray(s.name) ? s.name : [s.name]).includes(name));

/** Flags a specific subcommand declares, including the parent's persistent options. */
const subcommandSpecFlags = (spec, subName) => {
  const sub = findSubcommand(spec, subName);
  if (!sub) return null;
  const flags = collectOptionNames(sub, new Set());
  // Parent options are legal after the subcommand too, so don't report them missing.
  collectOptionNames(spec, flags);
  return flags;
};

/**
 * Flags mentioned anywhere in help text.
 *
 * Intentionally greedy — recall matters more than precision here, since a human
 * reviews the list. Known cost: it picks up flags out of usage examples too.
 */
const helpFlags = async ({ bin, helpArgs }) => {
  let out;
  try {
    // Many CLIs write help to stderr and/or exit non-zero for a help request.
    const r = await execFileAsync(bin, helpArgs, {
      encoding: "utf8",
      maxBuffer: 1 << 24,
      timeout: 30_000,
      env: { ...process.env, PATH: `${process.env.PATH}:${os.homedir()}/Library/Android/sdk/platform-tools` },
    });
    out = `${r.stdout}\n${r.stderr}`;
  } catch (e) {
    if (e.code === "ENOENT") return { missing: true, flags: new Set() };
    out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    if (!out.trim()) return { missing: false, flags: new Set(), error: e.message };
  }

  const flags = new Set();
  // Long flags (--foo, --foo-bar) and xcodebuild-style single-dash words (-scheme).
  for (const m of out.matchAll(/(?<![\w-])(--?[A-Za-z][\w-]{1,40})/g)) {
    const f = m[1];
    if (/^--?\d/.test(f)) continue; // negative numbers in examples
    flags.add(f);
  }
  return { missing: false, flags };
};

const scaffold = (name, missing) => {
  const lines = missing.map((f) => `    { name: "${f}", description: "TODO: describe ${f}" },`).join("\n");
  return `// DRAFT override for ${name} — generated by specs/refresh/drift.mjs.
// Descriptions are placeholders: --help parsing cannot recover them reliably.
// Review every entry, and delete any that came from a usage example rather than a
// real flag, before moving this into specs/src/.
import { loadBundledSpec } from "./lib/augment.js";

const spec = await loadBundledSpec("${name}");

spec.options = [
  ...(spec.options ?? []),
${lines}
];

export default spec;
`;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const doScaffold = argv.includes("--scaffold");
  const requested = argv.filter((a) => !a.startsWith("--"));
  const names = requested.length > 0 ? requested : Object.keys(TARGETS);

  let totalMissing = 0;
  const report = [];

  for (const name of names) {
    const target = TARGETS[name];
    if (!target) {
      console.error(`unknown target '${name}' (known: ${Object.keys(TARGETS).join(", ")})`);
      continue;
    }
    const spec = await loadSpec(name);
    if (spec == null) {
      report.push({ name, status: "no bundled spec" });
      continue;
    }
    const declared = specFlags(spec);
    const { missing: notInstalled, flags: live, error } = await helpFlags(target);
    if (notInstalled) {
      report.push({ name, status: "not installed" });
      continue;
    }
    if (error) {
      report.push({ name, status: `help failed: ${error}` });
      continue;
    }

    const gap = [...live].filter((f) => !declared.has(f)).sort();
    totalMissing += gap.length;
    report.push({ name, status: "ok", declared: declared.size, live: live.size, gap });

    for (const subName of target.subcommands ?? []) {
      const subDeclared = subcommandSpecFlags(spec, subName);
      if (subDeclared == null) {
        report.push({ name: `${name} ${subName}`, status: "subcommand absent from spec", sub: true });
        continue;
      }
      const subLive = await helpFlags({ bin: target.bin, helpArgs: [subName, "--help"] });
      if (subLive.error || subLive.missing) {
        report.push({ name: `${name} ${subName}`, status: `help failed`, sub: true });
        continue;
      }
      const subGap = [...subLive.flags].filter((f) => !subDeclared.has(f)).sort();
      totalMissing += subGap.length;
      report.push({ name: `${name} ${subName}`, status: "ok", declared: subDeclared.size, live: subLive.flags.size, gap: subGap, sub: true });
    }

    // Only top-level gaps are scaffolded. Subcommand gaps are reported but not
    // generated, because placing them correctly means editing the right entry in
    // spec.subcommands — a judgement call that a heuristic gets wrong more often
    // than it gets right.
    if (doScaffold && gap.length > 0) {
      const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), "drafts");
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${name}.ts`);
      fs.writeFileSync(outFile, scaffold(name, gap));
      console.log(`  scaffolded draft -> ${outFile}`);
    }
  }

  console.log("\n═══ spec drift report ═══");
  console.log("(flags seen in live --help but absent from the bundled spec)\n");
  for (const r of report) {
    const label = (r.sub ? `  ↳ ${r.name}` : r.name).padEnd(22);
    if (r.status !== "ok") {
      console.log(`${label} ${r.status}`);
      continue;
    }
    const head = `${label} spec:${String(r.declared).padStart(4)}  live:${String(r.live).padStart(4)}  missing:${String(r.gap.length).padStart(4)}`;
    console.log(head);
    if (r.gap.length > 0) {
      // Cap the printout, but say so — a silent truncation reads as "that's all of them".
      const shown = r.gap.slice(0, 15);
      console.log(`             ${shown.join(" ")}${r.gap.length > shown.length ? `  … and ${r.gap.length - shown.length} more` : ""}`);
    }
  }
  console.log(`\ntotal candidate gaps: ${totalMissing}`);
  console.log("Heuristic output — review before turning any of it into a spec.");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
