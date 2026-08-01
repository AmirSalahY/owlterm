#!/usr/bin/env node
// Report why the dropdown isn't appearing. Run this INSIDE the terminal where it
// is failing — several checks only mean anything from that process.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[33m·\x1b[0m ${m}`);

console.log("\n\x1b[1mtermauto diagnostics\x1b[0m");

// 1. Are we inside a wrapped session? This is THE question — if not, no dropdown
// can ever appear, and the cause is the shell hook, not the renderer.
console.log("\n[1] Inside a termauto/inshellisense session?");
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

// 3. The hook invokes the engine by the bare name `is`.
console.log("\n[3] `is` resolvable on PATH");
try {
  const p = execFileSync("sh", ["-c", "command -v is"], { encoding: "utf8" }).trim();
  const target = fs.realpathSync(p);
  const expected = fs.realpathSync(path.join(ROOT, "bin", "termauto"));
  target === expected ? ok(`${p} -> ${target}`) : bad(`${p} resolves to ${target}, expected ${expected}`);
} catch {
  bad("`is` not found on PATH — the hook can never start. Run: npm run setup");
}

// 4. Hook present in the rc file, and last.
console.log("\n[4] Shell hook in ~/.zshrc");
const rc = path.join(os.homedir(), ".zshrc");
if (!fs.existsSync(rc)) bad(`${rc} missing`);
else {
  const lines = fs.readFileSync(rc, "utf8").split("\n");
  const idx = lines.findIndex((l) => l.includes("inshellisense/init/zsh/init.zsh"));
  if (idx === -1) bad("hook not found — run: npm run shell-init");
  else {
    ok(`found at line ${idx + 1} of ${lines.length}`);
    const after = lines.slice(idx + 1).filter((l) => l.trim() && !l.trimStart().startsWith("#") && !l.trim().startsWith("fi"));
    if (after.length) {
      bad(`${after.length} active line(s) run AFTER the hook — this can break it:`);
      after.slice(0, 5).forEach((l) => info(`    ${l.trim().slice(0, 70)}`));
    } else ok("nothing active runs after it");
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
