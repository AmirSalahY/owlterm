#!/usr/bin/env node
// Post-install check: is the engine resolving OUR specs, or only the bundled ones?
//
// The failure this catches: `specs.path` not pointing at this checkout, usually
// because setup found a pre-existing config and (correctly) declined to rewrite
// it. Everything still "works" — you just silently get stock completions.
//
// Subtlety: most of our specs are OVERRIDES of bundled ones (adb, xcodebuild), so
// seeing those names in the loaded set proves nothing — they'd be there anyway.
// Only a spec that exists nowhere in the bundled corpus is real evidence that our
// path resolved, so that's what the check keys on.
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUR_BUILD = path.join(ROOT, "specs", "build");
const BUNDLED = path.join(os.homedir(), ".inshellisense", "spec");

const fail = (msg, ...rest) => {
  console.error(`✗ ${msg}`);
  for (const r of rest) console.error(r);
  process.exit(1);
};

const entry = path.join(ROOT, "vendor", "inshellisense", "build", "index.js");
if (!fs.existsSync(entry)) fail("engine not built — run `npm run setup`");
if (!fs.existsSync(path.join(OUR_BUILD, "index.js"))) fail("our specs not compiled — run `npm run build:specs`");

// What we actually built, straight from the generated index (no hardcoded list to
// drift out of date).
const ourSpecs = (await import(pathToFileURL(path.join(OUR_BUILD, "index.js")).href)).default;

let loaded;
try {
  loaded = JSON.parse(execFileSync("node", [entry, "specs", "list"], { encoding: "utf8", maxBuffer: 1 << 24 }));
} catch (e) {
  fail(`could not list specs: ${e.message}`);
}

const isBundled = (name) => fs.existsSync(path.join(BUNDLED, `${name}.js`));
const unique = ourSpecs.filter((n) => !isBundled(n)); // only these prove path resolution
const overrides = ourSpecs.filter(isBundled);
const missing = ourSpecs.filter((n) => !loaded.includes(n));

console.log(`${loaded.length} specs loaded`);
console.log(`ours: ${ourSpecs.length} (${overrides.length} override bundled, ${unique.length} unique)`);

if (missing.length > 0) {
  fail(
    `missing from the loaded set: ${missing.join(", ")}`,
    `\n  specs.path is not pointing at:\n    ${OUR_BUILD}`,
    `  Fix ~/.config/inshellisense/rc.toml (or ~/.inshellisenserc), then re-run \`npm run setup\`.`,
  );
}

if (unique.length === 0) {
  console.log(`! every spec we ship overrides a bundled one, so this can't confirm the path resolved.`);
  console.log(`  Probe a specific override instead, e.g. \`make complete Q="adb -s "\`.`);
  process.exit(0);
}

if (!unique.every((n) => loaded.includes(n))) {
  fail(`unique specs absent: ${unique.filter((n) => !loaded.includes(n)).join(", ")}`);
}

console.log(`✓ specs.path resolved — confirmed via ${unique.join(", ")} (present only in this checkout)`);
