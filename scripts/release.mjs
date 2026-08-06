#!/usr/bin/env node
// Cuts a release and confirms it reached the users.
//
// There is no broadcast channel: `scripts/check-update.mjs` polls the repo's
// latest GitHub release on shell start and prints the upgrade notice. So
// notifying users *is* publishing the release, and the release is published by
// .github/workflows/release.yml when a `v*` tag lands. This script does the
// three things around that which are easy to get wrong by hand — refuse to tag
// a tree whose vendor work was never exported, tag and push atomically, then
// poll the same endpoint the clients poll so a silently failed workflow can't
// look like a successful release.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor", "inshellisense");
const REPO = process.env.TERMAUTO_UPDATE_REPO ?? "AmirSalahY/termauto";
const API_URL = process.env.TERMAUTO_UPDATE_URL ?? `https://api.github.com/repos/${REPO}/releases/latest`;
// The workflow checks out, installs, builds specs and calls the GitHub API.
const PUBLISH_TIMEOUT_MS = Number(process.env.TERMAUTO_RELEASE_TIMEOUT_MS ?? 10 * 60 * 1000);
const POLL_INTERVAL_MS = 10_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
};
const dryRun = flag("--dry-run");
const noWait = flag("--no-wait");
const bump = args[0] ?? "patch";

const die = (message, ...rest) => {
  console.error(`release: ${message}`);
  for (const line of rest) console.error(`  ${line}`);
  process.exit(1);
};

const capture = (command, commandArgs, cwd = ROOT) => execFileSync(command, commandArgs, { cwd, encoding: "utf8" }).trim();

const run = (command, commandArgs, cwd = ROOT) => {
  if (dryRun) {
    console.log(`  would run: ${command} ${commandArgs.join(" ")}${cwd === ROOT ? "" : ` (in ${path.relative(ROOT, cwd)})`}`);
    return;
  }
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  if (result.status !== 0) die(`\`${command} ${commandArgs.join(" ")}\` failed`);
};

const packageVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

/** npm does the real bump; this only needs to name the tag for the pre-flight checks. */
const nextVersion = (current) => {
  if (/^\d+\.\d+\.\d+/.test(bump)) return bump;
  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return die(`unknown bump "${bump}"`, "expected: major, minor, patch, or an explicit version like 1.2.3");
  }
};

const preflight = (tag) => {
  // A vendor edit that was never committed and re-exported ships on one machine
  // only — the patches are what everyone else installs from.
  if (capture("git", ["status", "--porcelain"], VENDOR)) {
    die("vendor/inshellisense has uncommitted changes", "Commit them there, then run `npm run patches`.");
  }
  run("npm", ["run", "--silent", "patches"]);
  if (!dryRun && capture("git", ["status", "--porcelain", "--", "patches"])) {
    die("patches/ is out of date with the vendor checkout", "`npm run patches` just changed it — review and commit that first.");
  }
  if (capture("git", ["status", "--porcelain"])) {
    die("working tree is dirty", "npm version refuses to tag over uncommitted changes.");
  }

  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  run("git", ["fetch", "--quiet", "origin", branch, "--tags"]);
  if (!dryRun) {
    const behind = capture("git", ["rev-list", "--count", `HEAD..origin/${branch}`]);
    if (behind !== "0") die(`${branch} is ${behind} commit(s) behind origin`, "Pull first — the release would drop them.");
  }
  if (capture("git", ["tag", "--list", tag])) die(`tag ${tag} already exists locally`);

  return branch;
};

const fetchLatestTag = async () => {
  const response = await fetch(API_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `termauto/${packageVersion()}` },
  });
  if (!response.ok) return undefined;
  return (await response.json())?.tag_name;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The clients read `/releases/latest`, so that — not the workflow's exit code —
 * is what decides whether anyone is told. Poll it rather than trusting the push.
 */
const awaitPublished = async (tag) => {
  const deadline = Date.now() + PUBLISH_TIMEOUT_MS;
  process.stdout.write(`Waiting for the release workflow to publish ${tag}`);
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    process.stdout.write(".");
    let latest;
    try {
      latest = await fetchLatestTag();
    } catch {
      continue; // A flaky network read shouldn't end the wait.
    }
    if (latest === tag) {
      process.stdout.write("\n");
      return true;
    }
  }
  process.stdout.write("\n");
  return false;
};

const main = async () => {
  const current = packageVersion();
  const version = nextVersion(current);
  const tag = `v${version}`;
  console.log(`Releasing termauto ${current} -> ${version}${dryRun ? " (dry run)" : ""}\n`);

  const branch = preflight(tag);

  // npm writes package.json + package-lock.json, commits, and tags in one step,
  // which is exactly the shape of every release commit in this history.
  run("npm", ["version", bump, "-m", "chore: release %s"]);
  run("git", ["push", "origin", branch, "--follow-tags"]);

  if (dryRun) {
    console.log(`\nDry run: nothing was committed, tagged, or pushed.`);
    return;
  }
  if (noWait) {
    console.log(`\nPushed ${tag}. The release workflow will publish it and users will be notified on their next update check.`);
    return;
  }

  if (await awaitPublished(tag)) {
    console.log(`Published ${tag}. Users are notified on their next update check (within ${process.env.TERMAUTO_UPDATE_TTL_MS ? "the configured TTL" : "6h"}), or immediately via \`termauto update\`.`);
    return;
  }
  die(
    `${tag} was pushed but has not appeared as the latest release`,
    `Check the workflow: https://github.com/${REPO}/actions`,
    "Users will not see an update notice until it publishes.",
  );
};

await main();
