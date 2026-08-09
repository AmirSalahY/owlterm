#!/usr/bin/env node
// Report why the dropdown isn't appearing. Run this INSIDE the terminal where it
// is failing — several checks only mean anything from that process.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** The command name the generated init script re-execs. Must match setup.mjs. */
const CMD = "owlterm";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[33m·\x1b[0m ${m}`);

console.log("\n\x1b[1mowlterm diagnostics\x1b[0m");

// 1. Are we inside a wrapped session? This is THE question — if not, no dropdown
// can ever appear, and the cause is the shell hook, not the renderer.
console.log("\n[1] Inside a owlterm/inshellisense session?");
if (process.env.ISTERM) ok(`yes — ISTERM=${process.env.ISTERM}`);
else {
  bad("no — ISTERM is unset, so the shell was never wrapped");
  info("Everything below is about why the wrapper didn't start.");
}

// 2. Terminal identity. Some terminals do their own line editing and fight a PTY
// wrapper; the init script also deliberately skips VS Code env resolution.
console.log("\n[2] Terminal");
info(`TERM=${process.env.TERM ?? "(unset)"}  TERM_PROGRAM=${process.env.TERM_PROGRAM ?? "(unset)"}`);
if (process.env.VSCODE_RESOLVING_ENVIRONMENT) info("VSCODE_RESOLVING_ENVIRONMENT set — the hook intentionally skips this pass");
if (process.env.TERM === "dumb") bad("TERM=dumb — no dropdown is possible");

// 3. The hook invokes the engine by the bare name `owlterm`.
console.log(`\n[3] \`${CMD}\` resolvable on PATH`);
try {
  const p = execFileSync("sh", ["-c", `command -v ${CMD}`], { encoding: "utf8" }).trim();
  const target = fs.realpathSync(p);
  const expected = fs.realpathSync(path.join(ROOT, "bin", CMD));
  target === expected ? ok(`${p} -> ${target}`) : bad(`${p} resolves to ${target}, expected ${expected}`);
} catch {
  bad(`\`${CMD}\` not found on PATH — the hook can never start. Run: npm run setup`);
}

// 3b. The generated init script bakes the launcher name in at generation time, so
// a stale one from before the rename still calls `is` and silently does nothing.
{
  const initScript = path.join(os.homedir(), ".inshellisense", "init", "zsh", "init.zsh");
  if (fs.existsSync(initScript)) {
    const body = fs.readFileSync(initScript, "utf8");
    if (body.includes(`${CMD} -s zsh`)) ok(`init.zsh invokes \`${CMD}\``);
    else bad(`init.zsh still invokes \`${body.trim().match(/^\s*(\S+) -s zsh/m)?.[1] ?? "?"}\` — run: npm run setup`);
  }
}

// 4. Hook present in the rc file, and early enough to be worth having.
console.log("\n[4] Shell hook in ~/.zshrc");
const rc = path.join(os.homedir(), ".zshrc");
if (!fs.existsSync(rc)) bad(`${rc} missing`);
else {
  const lines = fs.readFileSync(rc, "utf8").split("\n");
  const idx = lines.findIndex((l) => l.includes("inshellisense/init/zsh/init.zsh"));
  if (idx === -1) bad("hook not found — run: npm run shell-init");
  else {
    ok(`found at line ${idx + 1} of ${lines.length}`);
    // Position is a performance property, not a correctness one: the hook execs
    // the wrapper and never returns, so whatever sits below it never runs in the
    // outer shell. What it costs is the lines ABOVE it, which the outer shell
    // evaluates in full and the wrapped shell then evaluates all over again.
    const before = lines.slice(0, idx).filter((l) => l.trim() && !l.trimStart().startsWith("#"));
    if (before.length > 5) {
      info(`${before.length} active line(s) run BEFORE the hook, so they are evaluated twice per terminal`);
      info(`    move the block to the top of ${rc} — run: npm run shell-init`);
    } else ok("nothing meaningful runs before it");
  }
}

// 5. The generated init script and unpacked specs.
console.log("\n[5] Engine resources");
const initScript = path.join(os.homedir(), ".inshellisense", "init", "zsh", "init.zsh");
fs.existsSync(initScript) ? ok(initScript) : bad(`${initScript} missing — run: npm run setup`);
const specDir = path.join(os.homedir(), ".inshellisense", "spec");
const specCount = fs.existsSync(specDir) ? fs.readdirSync(specDir).length : 0;
specCount > 100 ? ok(`${specCount} specs unpacked`) : bad(`only ${specCount} specs in ${specDir} — run: npm run setup`);

// 6. Config must validate, or the engine exits at startup and the shell looks normal.
console.log("\n[6] Config validates");
try {
  execFileSync("node", [path.join(ROOT, "vendor", "inshellisense", "build", "index.js"), "complete", "git ch"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  ok("config parses and completions resolve");
} catch (e) {
  bad("engine failed to run — likely an invalid config:");
  info(String(e.stderr ?? e.message).split("\n").slice(0, 4).join("\n  "));
}

// 7. Known conflicts: tools that also own the line editor.
console.log("\n[7] Line-editor conflicts");
const conflicts = [
  ["ATUIN_SESSION", "atuin (rebinds up-arrow / ctrl-r)"],
  ["ZSH_AUTOSUGGEST_STRATEGY", "zsh-autosuggestions (draws inline text)"],
  ["POWERLEVEL9K_INSTANT_PROMPT", "powerlevel10k instant prompt"],
];
const active = conflicts.filter(([v]) => process.env[v]);
if (active.length === 0) ok("none detected in this process");
else active.forEach(([, label]) => info(`present: ${label}`));

console.log("\nRun this from the terminal where the dropdown is missing.\n");
