#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const REPO = process.env.OWLTERM_UPDATE_REPO ?? "AmirSalahY/owlterm";
const API_URL = process.env.OWLTERM_UPDATE_URL ?? `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = Number(process.env.OWLTERM_UPDATE_TIMEOUT_MS ?? 5000);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const output = (command, args) => execFileSync(command, args, { cwd: ROOT, encoding: "utf8" }).trim();

const readPackage = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch {
    return {};
  }
};

const fetchLatestTag = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `owlterm/${readPackage().version}`,
      },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const json = await response.json();
    if (!json?.tag_name) throw new Error("latest release has no tag_name");
    return json.tag_name;
  } finally {
    clearTimeout(timer);
  }
};

const assertCleanCheckout = () => {
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    console.error("owlterm update: this install is not a git checkout.");
    process.exit(1);
  }
  const dirty = output("git", ["status", "--porcelain"]);
  if (dirty) {
    console.error("owlterm update: local changes are present; refusing to overwrite them.");
    console.error("Commit, stash, or remove those changes, then run `owlterm update` again.");
    process.exit(1);
  }
};

const main = async () => {
  assertCleanCheckout();

  const before = readPackage();
  const tag = process.env.OWLTERM_REF || (await fetchLatestTag());

  console.log(`Updating owlterm ${before.version} -> ${tag}`);
  run("git", ["fetch", "--quiet", "origin", "tag", tag]);
  run("git", ["checkout", "--quiet", tag]);
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"]);
  run("npm", ["run", "--silent", "setup"]);

  const after = readPackage();
  if (before.name && after.name && before.name !== after.name) {
    // A package rename means the command name changed too — the loudest, most
    // surprising thing this update just did, so it gets a colour and doesn't
    // scroll off with the rest of the setup log.
    console.log(`\n\x1b[33m${before.name} is now ${after.name} — the command is \`${after.name}\`. Restart any running sessions.\x1b[0m`);
  } else {
    console.log(`${after.name ?? "owlterm"} is now at ${tag}. Restart any running sessions.`);
  }
};

await main();
