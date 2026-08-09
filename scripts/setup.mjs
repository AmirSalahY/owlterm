#!/usr/bin/env node
// owlterm bootstrap — idempotent, safe to re-run.
//
// vendor/ is intentionally NOT committed (it keeps its own git repo so our patches
// stay rebasable). So on a fresh machine there is no engine at all, and our vendor
// changes exist only as the committed patches/*.patch files. This script
// reconstructs the whole thing from scratch:
//
//   1. check the Node version   (engine requires >=18 <23)
//   2. clone inshellisense at a PINNED commit + apply patches/*.patch
//   3. npm ci && build
//   4. unpack the Fig spec corpus into ~/.inshellisense/spec
//   5. compile our specs
//   6. link bin/owlterm onto PATH as `owlterm`
//   7. regenerate the shell init scripts so they invoke `owlterm`, and retire
//      any leftover `is` link from before the rename
//   8. write (or tell you how to merge) ~/.config/inshellisense/rc.toml with the
//      absolute specs path for THIS machine
import { execFileSync as run } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VENDOR = path.join(ROOT, "vendor", "inshellisense");
const PATCHES = path.join(ROOT, "patches");
const SPECS_BUILD = path.join(ROOT, "specs", "build");
const DEFAULT_CONFIG_PATH = path.join(ROOT, "owlterm.config.json");
const DEFAULT_CONFIG = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

/** The command name we install. Also baked into the generated shell init scripts. */
const CMD = "owlterm";

/**
 * Must be the same string bin/owlterm exports as ISTERM_VERSION — the engine
 * stamps it into ~/.inshellisense/version.txt at unpack time and refuses to start
 * a session when the two disagree. Read from the same package.json the launcher
 * reads, so there is one source of truth rather than two that can drift.
 */
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;

const UPSTREAM = "https://github.com/microsoft/inshellisense";
// Pinned so a rebuild months from now produces the same engine our patches were
// written against. Bump deliberately via `npm run upstream`, never incidentally.
//
// Was 5c97e85 — upstream rewrote its history at some point after we pinned it
// (same PR, same tree, new SHA: "ci: update package location (#433)" is now
// 6bd0ae7), which made a plain `git clone` fail with "not a commit" for anyone
// installing fresh, since a normal clone only transfers objects reachable from
// upstream's current refs.
const PINNED_COMMIT = "6bd0ae7";

const sh = (cmd, args, opts = {}) => run(cmd, args, { stdio: "inherit", encoding: "utf8", ...opts });

const TOTAL_STEPS = 8;
const step = (n, msg) => console.log(`\n\x1b[1m[${n}/${TOTAL_STEPS}] ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};
const tomlString = (value) => JSON.stringify(value);

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
  const git = (...args) => run("git", ["-C", VENDOR, ...args], { encoding: "utf8" }).trim();
  // `git am` needs an identity; a clone may have none configured.
  const ident = ["-c", "user.name=owlterm", "-c", "user.email=owlterm@localhost"];
  const applyPatches = (patches) => sh("git", ["-C", VENDOR, ...ident, "am", "--3way", ...patches.map((p) => path.join(PATCHES, p))]);

  const patches = fs.existsSync(PATCHES) ? fs.readdirSync(PATCHES).filter((f) => f.endsWith(".patch")).sort() : [];

  const alreadyCloned = fs.existsSync(path.join(VENDOR, ".git"));
  if (!alreadyCloned) {
    fs.mkdirSync(path.dirname(VENDOR), { recursive: true });
    sh("git", ["clone", UPSTREAM, VENDOR]);
    sh("git", ["-C", VENDOR, "remote", "rename", "origin", "upstream"]);
    // Detach at the pinned commit, then replay our patches on top as real commits
    // so `git rebase upstream/main` stays the upgrade path.
    sh("git", ["-C", VENDOR, "checkout", "-q", "-B", "owlterm", PINNED_COMMIT]);

    if (patches.length === 0) {
      warn("no patches/ found — running unpatched upstream (frecency will be absent)");
    } else {
      applyPatches(patches);
      ok(`applied ${patches.length} patch(es) on top of ${PINNED_COMMIT}`);
    }
  } else {
    // An existing vendor/ was never re-checked against patches/ — an `owlterm
    // update` that added new patches left the engine running whatever series was
    // applied whenever vendor/ was first cloned, silently, with no error. That
    // shipped a launcher branded for a newer patch than the engine underneath it
    // actually had (e.g. the termauto -> owlterm rebrand patch missing from the
    // engine while the launcher already exported the new env var name), which
    // crashed every session. Count what's actually applied and catch up.
    const base = git("rev-parse", "upstream/main");
    const applied = Number(git("rev-list", "--count", `${base}..HEAD`));
    if (applied < patches.length) {
      const missing = patches.slice(applied);
      warn(`vendor/inshellisense has ${applied}/${patches.length} patches applied — catching up`);
      applyPatches(missing);
      ok(`applied ${missing.length} missing patch(es) (${patches.length}/${patches.length} now)`);
    } else if (applied > patches.length) {
      warn(`vendor/inshellisense has ${applied} local commit(s) but patches/ only describes ${patches.length} — leaving it alone (run \`make patches\` if those are unexported work)`);
    } else {
      ok(`vendor/inshellisense already present, ${applied}/${patches.length} patches applied`);
    }
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
  //
  // ISTERM_VERSION must match what bin/owlterm exports. unpackResources() stamps
  // ~/.inshellisense/version.txt with getVersion(), and every session start
  // compares the two; on a mismatch the engine prints "resources out of date" and
  // exits(1) — which, since the shell hook is `owlterm -s zsh ; exit`, closes
  // the terminal. Unpacking under a different version than the launcher reports
  // makes that happen on EVERY new shell.
  sh("node", ["--input-type=module", "-e", 'import { unpackResources } from "./build/utils/node.js"; await unpackResources();'], {
    cwd: VENDOR,
    env: { ...process.env, ISTERM_LAUNCHER: CMD, ISTERM_VERSION: VERSION },
  });
  const specDir = path.join(os.homedir(), ".inshellisense", "spec");
  const count = fs.existsSync(specDir) ? fs.readdirSync(specDir).length : 0;
  if (count === 0) die(`nothing landed in ${specDir} — completions would silently return nothing`);
  ok(`${count} entries in ${specDir}`);

  const stamped = fs.readFileSync(path.join(os.homedir(), ".inshellisense", "version.txt"), "utf-8").trim();
  if (stamped !== VERSION) die(`version.txt says ${stamped}, launcher reports ${VERSION} — every new shell would close itself`);
  ok(`resources stamped ${VERSION}`);
}

// ── 5. Our specs ──────────────────────────────────────────────────────────────
step(5, "Compiling owlterm specs");
sh("npm", ["run", "build:specs"], { cwd: ROOT });

// ── 6. `owlterm` on PATH ─────────────────────────────────────────────────────
step(6, `Linking the \`${CMD}\` launcher onto PATH`);
let linkedOnPath = false;
{
  // The generated shell-init script invokes the engine by BARE NAME
  // (`owlterm -s zsh ; exit`). Without that name resolvable, auto-start fails in
  // every new shell — the dropdown just never appears, with no obvious cause. So
  // the launcher has to be reachable as `owlterm`, not only as ./bin/owlterm.
  const launcher = path.join(ROOT, "bin", CMD);
  fs.chmodSync(launcher, 0o755);

  if (process.platform === "win32") {
    warn(`skipping symlink on Windows — ensure bin/${CMD} is reachable as \`${CMD}\` on PATH yourself`);
  } else {
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
    const preferred = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin"), "/usr/local/bin"];

    // A link is only useful in a directory that is BOTH on PATH and writable
    // without sudo. /usr/local/bin is commonly on PATH but root-owned, and
    // attempting it raised EACCES and aborted the whole setup.
    const writable = (dir) => {
      try {
        if (fs.existsSync(dir)) {
          fs.accessSync(dir, fs.constants.W_OK);
          return true;
        }
        // Not there yet — can we create it?
        fs.accessSync(path.dirname(dir), fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    };

    const target = preferred.find((d) => pathDirs.includes(d) && writable(d));

    const manual = () => {
      console.log(`\n      Link it yourself into a directory on your PATH, then re-run:`);
      console.log(`        ln -sf "${launcher}" <dir-on-PATH>/${CMD}\n`);
      console.log(`      Auto-start (npm run shell-init) needs \`${CMD}\` resolvable; a plain`);
      console.log(`      \`${launcher}\` session works without it.\n`);
    };

    if (!target) {
      const onPath = preferred.filter((d) => pathDirs.includes(d));
      warn(
        onPath.length > 0
          ? `${onPath.join(", ")} is on PATH but not writable without sudo.`
          : `none of ${preferred.join(", ")} is on your PATH.`,
      );
      manual();
    } else {
      const link = path.join(target, CMD);
      try {
        const present = fs.lstatSync(link, { throwIfNoEntry: false }) != null;
        let ours = false;
        if (present) {
          try {
            ours = fs.realpathSync(link) === fs.realpathSync(launcher);
          } catch {
            ours = false; // dangling link — safe to replace
          }
        }
        if (present && !ours) {
          // Never silently replace an unrelated binary of the same name.
          warn(`${link} already exists and isn't ours — leaving it alone.`);
          console.log(`        Point it at ${launcher} yourself if auto-start doesn't fire.`);
        } else {
          fs.mkdirSync(target, { recursive: true });
          fs.rmSync(link, { force: true });
          fs.symlinkSync(launcher, link);
          linkedOnPath = true;
          ok(`${link} -> bin/${CMD}`);
        }
      } catch (e) {
        // Not fatal: everything else still works, only auto-start needs this.
        warn(`could not link ${link}: ${e.message}`);
        manual();
      }
    }
  }
}

// ── 7. Shell init scripts ─────────────────────────────────────────────────────
step(7, "Regenerating the shell init scripts");
{
  // These live in ~/.inshellisense/init/<shell>/ and re-exec the engine by bare
  // name. The name is baked in at generation time, so a rename is only real once
  // they are rewritten — otherwise every new shell still calls the old one and
  // auto-start dies silently. ISTERM_LAUNCHER is what getShellConfig reads.
  try {
    sh(
      "node",
      ["--input-type=module", "-e", 'import { createShellConfigs } from "./build/utils/shell.js"; await createShellConfigs();'],
      { cwd: VENDOR, env: { ...process.env, ISTERM_LAUNCHER: CMD } },
    );
    const zshInit = path.join(os.homedir(), ".inshellisense", "init", "zsh", "init.zsh");
    if (fs.existsSync(zshInit) && !fs.readFileSync(zshInit, "utf-8").includes(`${CMD} -s zsh`)) {
      warn(`${zshInit} does not invoke \`${CMD}\` — auto-start may not fire`);
    } else {
      ok(`init scripts invoke \`${CMD}\``);
    }
  } catch (e) {
    warn(`could not regenerate init scripts: ${e.message}`);
  }

  // Retire links from before a rename (`is` -> `termauto` -> `owlterm`), but only
  // once the replacement is in place and only if it is ours — an unrelated
  // binary of the same name must survive untouched. Its old target is very
  // likely gone by now (the launcher file itself was renamed), so compare the
  // raw symlink target rather than realpath, which would throw ENOENT on a
  // dangling link and skip it.
  if (linkedOnPath && process.platform !== "win32") {
    for (const dir of [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin"), "/usr/local/bin"]) {
      for (const legacyName of ["is", "termauto"]) {
        const legacy = path.join(dir, legacyName);
        const expectedTarget = path.join(ROOT, "bin", legacyName);
        try {
          if (!fs.lstatSync(legacy, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
          if (fs.readlinkSync(legacy) !== expectedTarget) continue;
          fs.rmSync(legacy);
          ok(`removed the old \`${legacyName}\` link at ${legacy}`);
        } catch {
          continue; // dangling, unreadable or not ours — leave it alone
        }
      }
    }
  }
}

// ── 7. Config ─────────────────────────────────────────────────────────────────
step(8, "Configuring specs path");
{
  // Upstream reads ~/.inshellisenserc first, then ~/.config/inshellisense/rc.toml.
  const xdg = path.join(os.homedir(), ".config", "inshellisense", "rc.toml");
  const legacy = path.join(os.homedir(), ".inshellisenserc");
  // Document-root keys MUST come before the first [table] header. TOML scopes
  // everything after a header into that table, so `maxSuggestions` written below
  // [specs] parses as specs.maxSuggestions and is silently ignored.
  const block = `maxSuggestions = ${DEFAULT_CONFIG.maxSuggestions}
useFrecency = ${DEFAULT_CONFIG.useFrecency}

[theme]
icons = ${tomlString(DEFAULT_CONFIG.theme.icons)}     # "auto" | "nerd" | "unicode" | "emoji" | "none"
surface = ${tomlString(DEFAULT_CONFIG.theme.surface)}  # "clear" lets your terminal's transparency/blur show through

[specs]
path = ["${SPECS_BUILD}"]
`;

  const existing = [xdg, legacy].filter((p) => fs.existsSync(p));
  if (existing.length === 0) {
    fs.mkdirSync(path.dirname(xdg), { recursive: true });
    fs.writeFileSync(xdg, `# Generated by owlterm setup on this machine.\n${block}`);
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
console.log(`  ${linkedOnPath ? CMD : path.join(ROOT, "bin", CMD)}\n`);
console.log(`Then type \`git ch\` or \`yarn \` and the dropdown should appear.`);
console.log(`To start it automatically in every new shell, run:\n`);
console.log(`  npm run shell-init\n`);
console.log(`It puts a guarded hook at the TOP of ~/.zshrc — first, so a new terminal`);
console.log(`evaluates the file once rather than twice — after backing the file up and`);
console.log(`syntax-checking the result.\n`);
