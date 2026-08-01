#!/usr/bin/env node
// termauto bootstrap — idempotent, safe to re-run.
//
// vendor/ is intentionally NOT committed (it keeps its own git repo so our patches
// stay rebasable). So on a fresh machine there is no engine at all, and our two
// vendor changes exist only as patch files. This script reconstructs the whole
// thing from scratch:
//
//   1. check the Node version   (engine requires >=18 <23)
//   2. clone inshellisense at a PINNED commit + apply patches/*.patch
//   3. npm ci && build
//   4. unpack the Fig spec corpus into ~/.inshellisense/spec
//   5. compile our specs
//   6. write (or tell you how to merge) ~/.config/inshellisense/rc.toml with the
//      absolute specs path for THIS machine
import { execFileSync as run } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VENDOR = path.join(ROOT, "vendor", "inshellisense");
const PATCHES = path.join(ROOT, "patches");
const SPECS_BUILD = path.join(ROOT, "specs", "build");

const UPSTREAM = "https://github.com/microsoft/inshellisense";
// Pinned so a rebuild months from now produces the same engine our patches were
// written against. Bump deliberately via `npm run upstream`, never incidentally.
const PINNED_COMMIT = "6bd0ae7";

const sh = (cmd, args, opts = {}) => run(cmd, args, { stdio: "inherit", encoding: "utf8", ...opts });

const TOTAL_STEPS = 7;
const step = (n, msg) => console.log(`\n\x1b[1m[${n}/${TOTAL_STEPS}] ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

// ── 1. Node version ────────────────────────────────────────────────────────────
step(1, "Checking Node version");
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18 || major >= 23) {
    die(
      `Node ${process.versions.node} is unsupported — the engine declares "node >=18.0 <23.0.0".\n` +
        `    node-pty's prebuilt binding is ABI-matched, so a newer Node fails at runtime, not at install.\n` +
        `    Install Node 20 or 22 (e.g. \`brew install node@22\` or use nvm) and re-run.`,
    );
  }
  ok(`Node ${process.versions.node}`);

  const platform = `${process.platform}-${process.arch}`;
  const supported = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"];
  if (!supported.includes(platform)) warn(`platform ${platform} has no node-pty prebuild; it may need a native compile`);
  else ok(`platform ${platform} (node-pty prebuild available)`);
}

// ── 2. Vendor engine ──────────────────────────────────────────────────────────
step(2, "Fetching the engine");
{
  const alreadyCloned = fs.existsSync(path.join(VENDOR, ".git"));
  if (!alreadyCloned) {
    fs.mkdirSync(path.dirname(VENDOR), { recursive: true });
    sh("git", ["clone", UPSTREAM, VENDOR]);
    sh("git", ["-C", VENDOR, "remote", "rename", "origin", "upstream"]);
    // Detach at the pinned commit, then replay our patches on top as real commits
    // so `git rebase upstream/main` stays the upgrade path.
    sh("git", ["-C", VENDOR, "checkout", "-q", "-B", "termauto", PINNED_COMMIT]);

    const patches = fs.existsSync(PATCHES)
      ? fs.readdirSync(PATCHES).filter((f) => f.endsWith(".patch")).sort()
      : [];
    if (patches.length === 0) {
      warn("no patches/ found — running unpatched upstream (frecency will be absent)");
    } else {
      // `git am` needs an identity; a clone may have none configured.
      const ident = ["-c", "user.name=termauto", "-c", "user.email=termauto@localhost"];
      sh("git", ["-C", VENDOR, ...ident, "am", ...patches.map((p) => path.join(PATCHES, p))]);
      ok(`applied ${patches.length} patch(es) on top of ${PINNED_COMMIT}`);
    }
  } else {
    ok("vendor/inshellisense already present (leaving its git history alone)");
  }
}

// ── 3. Dependencies + build ───────────────────────────────────────────────────
step(3, "Installing dependencies and building the engine");
sh("npm", ["ci"], { cwd: VENDOR });
sh("npm", ["run", "build"], { cwd: VENDOR });
ok("engine built");

// ── 4. Unpack the spec corpus ─────────────────────────────────────────────────
step(4, "Unpacking the bundled spec corpus");
{
  // MUST run with cwd = VENDOR: in a non-SEA (dev) build, unpackSpecs() reads
  // `process.cwd()/node_modules/@withfig/autocomplete/build`. Upstream ships as a
  // single executable with the specs embedded as assets; from a plain tsc build
  // nothing populates ~/.inshellisense/spec and every completion silently
  // returns nothing. Upstream calls this inside `is init` but un-awaited, so we
  // invoke it directly.
  sh(
    "node",
    [
      "--input-type=module",
      "-e",
      'import { unpackResources } from "./build/utils/node.js"; await unpackResources();',
    ],
    { cwd: VENDOR },
  );
  const specDir = path.join(os.homedir(), ".inshellisense", "spec");
  const count = fs.existsSync(specDir) ? fs.readdirSync(specDir).length : 0;
  if (count === 0) die(`nothing landed in ${specDir} — completions would silently return nothing`);
  ok(`${count} entries in ${specDir}`);
}

// ── 5. Our specs ──────────────────────────────────────────────────────────────
step(5, "Compiling termauto specs");
sh("npm", ["run", "build:specs"], { cwd: ROOT });

// ── 6. `is` on PATH ───────────────────────────────────────────────────────────
step(6, "Linking the `is` launcher onto PATH");
{
  // The generated shell-init script invokes the engine by the BARE NAME `is`
  // (`is -s zsh ; exit`). Without that name resolvable, auto-start fails in every
  // new shell — the dropdown just never appears, with no obvious cause. So the
  // launcher has to be reachable as `is`, not only as ./bin/termauto.
  const launcher = path.join(ROOT, "bin", "termauto");
  fs.chmodSync(launcher, 0o755);

  if (process.platform === "win32") {
    warn("skipping symlink on Windows — ensure bin/termauto is reachable as `is` on PATH yourself");
  } else {
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
    const preferred = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin"), "/usr/local/bin"];
    // Only pick a directory already on PATH, otherwise the link is invisible.
    const target = preferred.find((d) => pathDirs.includes(d));

    if (!target) {
      warn(`none of ${preferred.join(", ")} is on your PATH.`);
      console.log(`\n      Add one to PATH and re-run, or link it manually:`);
      console.log(`        ln -sf "${launcher}" <a-dir-on-your-PATH>/is\n`);
    } else {
      const link = path.join(target, "is");
      const existing = fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false }) != null;
      const ours = existing && fs.realpathSync(link) === fs.realpathSync(launcher);
      if (existing && !ours) {
        // Never silently replace someone else's binary called `is`.
        warn(`${link} already exists and is not ours — leaving it alone.`);
        console.log(`        Point it at ${launcher} yourself if auto-start doesn't work.`);
      } else {
        fs.mkdirSync(target, { recursive: true });
        fs.rmSync(link, { force: true });
        fs.symlinkSync(launcher, link);
        ok(`${link} -> bin/termauto`);
      }
    }
  }
}

// ── 7. Config ─────────────────────────────────────────────────────────────────
step(7, "Configuring specs path");
{
  // Upstream reads ~/.inshellisenserc first, then ~/.config/inshellisense/rc.toml.
  const xdg = path.join(os.homedir(), ".config", "inshellisense", "rc.toml");
  const legacy = path.join(os.homedir(), ".inshellisenserc");
  const block = `[specs]
path = ["${SPECS_BUILD}"]

maxSuggestions = 10
useFrecency = true
useNerdFont = false
`;

  const existing = [xdg, legacy].filter((p) => fs.existsSync(p));
  if (existing.length === 0) {
    fs.mkdirSync(path.dirname(xdg), { recursive: true });
    fs.writeFileSync(xdg, `# Generated by termauto setup on this machine.\n${block}`);
    ok(`wrote ${xdg}`);
  } else {
    const alreadyPointed = existing.some((p) => fs.readFileSync(p, "utf-8").includes(SPECS_BUILD));
    if (alreadyPointed) {
      ok(`config already points at ${SPECS_BUILD}`);
    } else {
      // Never silently rewrite a config that is already there — a TOML merge done
      // blind can drop custom keybindings.
      warn(`config already exists at ${existing.join(", ")} — not modifying it.`);
      console.log(`\n  Add this to it (merge into any existing [specs] table):\n`);
      console.log(
        block
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    }
  }
}

console.log(`\n\x1b[1mDone.\x1b[0m Start a session:\n`);
console.log(`  ${path.join(ROOT, "bin", "termauto")}\n`);
console.log(`Then type \`git ch\` or \`yarn \` and the dropdown should appear.`);
console.log(`To start it automatically, append this to ~/.zshrc — it MUST be the last thing`);
console.log(`in the file, and run \`npm run shell-init\` to add it safely:\n`);
console.log(`  npm run shell-init\n`);
