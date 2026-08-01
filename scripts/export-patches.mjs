#!/usr/bin/env node
// Re-export our vendor commits into patches/.
//
// patches/ is the ONLY portable record of our engine changes — vendor/ is not
// committed. So after changing anything under vendor/, run this or the change
// exists on this machine only and no other device can reproduce it.
//
// Also run it after `git rebase upstream/main`, together with bumping
// PINNED_COMMIT in scripts/setup.mjs to the new upstream base.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VENDOR = path.join(ROOT, "vendor", "inshellisense");
const PATCHES = path.join(ROOT, "patches");

if (!fs.existsSync(path.join(VENDOR, ".git"))) {
  console.error("no vendor/inshellisense checkout — run `npm run setup` first");
  process.exit(1);
}

const git = (...args) => execFileSync("git", ["-C", VENDOR, ...args], { encoding: "utf8" }).trim();

// Everything since the last upstream-authored commit is ours.
const base = git("rev-parse", "upstream/main");
const ours = git("log", "--format=%h %s", `${base}..HEAD`);
if (!ours) {
  console.log("no local commits on top of upstream/main — nothing to export");
  process.exit(0);
}

fs.rmSync(PATCHES, { recursive: true, force: true });
fs.mkdirSync(PATCHES, { recursive: true });
execFileSync("git", ["-C", VENDOR, "format-patch", `${base}..HEAD`, "-o", PATCHES], { stdio: "inherit" });

console.log(`\nexported from base ${base.slice(0, 7)}:`);
for (const line of ours.split("\n")) console.log(`  ${line}`);
console.log(`\nIf the base moved, update PINNED_COMMIT in scripts/setup.mjs to ${base.slice(0, 7)}.`);
