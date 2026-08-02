#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const REPO = process.env.TERMAUTO_UPDATE_REPO ?? "AmirSalahY/termauto";
const API_URL = process.env.TERMAUTO_UPDATE_URL ?? `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = Number(process.env.TERMAUTO_UPDATE_TIMEOUT_MS ?? 5000);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const output = (command, args) => execFileSync(command, args, { cwd: ROOT, encoding: "utf8" }).trim();

const readPackageVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const fetchLatestTag = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `termauto/${readPackageVersion()}`,
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
    console.error("termauto update: this install is not a git checkout.");
    process.exit(1);
  }
  const dirty = output("git", ["status", "--porcelain"]);
  if (dirty) {
    console.error("termauto update: local changes are present; refusing to overwrite them.");
    console.error("Commit, stash, or remove those changes, then run `termauto update` again.");
    process.exit(1);
  }
};

const main = async () => {
  assertCleanCheckout();

  const current = readPackageVersion();
  const tag = process.env.TERMAUTO_REF || (await fetchLatestTag());

  console.log(`Updating termauto ${current} -> ${tag}`);
  run("git", ["fetch", "--quiet", "origin", "tag", tag]);
  run("git", ["checkout", "--quiet", tag]);
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"]);
  run("npm", ["run", "--silent", "setup"]);
  console.log(`termauto is now at ${tag}. Restart any running termauto sessions.`);
};

await main();
