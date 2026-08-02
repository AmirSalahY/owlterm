#!/usr/bin/env node
// Append the auto-start hook to your shell rc file, safely.
//
// Does what `is init zsh >> ~/.zshrc` does, plus the parts that matter:
//   - refuses to add itself twice
//   - backs the file up first
//   - SYNTAX-CHECKS the result and restores the backup if it broke
//   - wraps the hook in a stronger guard than the generated script's own
//
// Usage: node scripts/shell-init.mjs [zsh|bash] [--dry-run]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "termauto (inshellisense)";

/** The command name the generated init script re-execs. Must match setup.mjs. */
const CMD = "termauto";

const SHELLS = {
  zsh: {
    rc: path.join(os.homedir(), ".zshrc"),
    check: (f) => execFileSync("zsh", ["-n", f], { stdio: "pipe" }),
    // The guards are the point. zsh does NOT put `c` in $- for `zsh -i -c`, so the
    // generated script's own `$- != *c*` test misses it and any tooling running
    // `zsh -i -c ...` hangs waiting on the PTY. ZSH_EXECUTION_STRING is set only
    // when -c was used, which identifies a real interactive shell reliably.
    block: `
# ── ${MARKER} — MUST stay the LAST thing in this file ──
# Anything that initialises after this point (notably a plugin manager) can break it.
#
# The extra guards matter: zsh does NOT put \`c\` in $- for \`zsh -i -c\`, so the
# generated script's own \`$- != *c*\` test doesn't catch that case, and tooling that
# runs \`zsh -i -c ...\` would hang waiting on the PTY. ZSH_EXECUTION_STRING is set
# only when -c was used, which distinguishes a real interactive shell reliably.
if [[ -o interactive && -z "$ZSH_EXECUTION_STRING" && -z "$ISTERM" ]]; then
  [[ -f ~/.inshellisense/init/zsh/init.zsh ]] && source ~/.inshellisense/init/zsh/init.zsh
fi
`,
  },
  bash: {
    rc: path.join(os.homedir(), ".bashrc"),
    check: (f) => execFileSync("bash", ["-n", f], { stdio: "pipe" }),
    block: `
# ── ${MARKER} — MUST stay the LAST thing in this file ──
# $- does contain 'i' only for interactive shells; also require a TTY so that
# non-interactive tooling never ends up waiting on the PTY.
case $- in *i*)
  if [[ -z "$ISTERM" && -t 0 ]]; then
    [[ -f ~/.inshellisense/init/bash/init.sh ]] && source ~/.inshellisense/init/bash/init.sh
  fi
;; esac
`,
  },
};

const shellName = process.argv.find((a) => a === "zsh" || a === "bash") ?? path.basename(process.env.SHELL ?? "zsh");
const dryRun = process.argv.includes("--dry-run");
const shell = SHELLS[shellName];

if (!shell) {
  console.error(`unsupported shell '${shellName}' — supported: ${Object.keys(SHELLS).join(", ")}`);
  console.error(`For fish/pwsh/nu, use: ${CMD} init <shell>  (and place it LAST in the rc file)`);
  process.exit(1);
}

// The generated init script invokes the engine by the bare name `termauto`;
// without that on PATH nothing starts and there is no visible error. Fail loudly
// rather than write a dead hook.
try {
  execFileSync("sh", ["-c", `command -v ${CMD}`], { stdio: "pipe" });
} catch {
  console.error(`✗ \`${CMD}\` is not on your PATH, so the hook would never start.`);
  console.error(`  Run \`npm run setup\` (it links bin/${CMD} onto PATH) and try again.`);
  process.exit(1);
}

const { rc, block, check } = shell;

if (fs.existsSync(rc) && fs.readFileSync(rc, "utf-8").includes(MARKER)) {
  console.log(`✓ already present in ${rc} — nothing to do`);
  process.exit(0);
}

if (dryRun) {
  console.log(`would append to ${rc}:\n${block}`);
  process.exit(0);
}

const original = fs.existsSync(rc) ? fs.readFileSync(rc, "utf-8") : "";
const backup = `${rc}.pre-termauto-${new Date().toISOString().replace(/[:.]/g, "-")}`;
if (original) fs.writeFileSync(backup, original);

fs.writeFileSync(rc, original + block);

try {
  check(rc);
} catch (e) {
  // A broken rc file breaks every new shell — put it back immediately.
  fs.writeFileSync(rc, original);
  console.error(`✗ the result failed a syntax check, so ${rc} was restored unchanged.`);
  console.error(String(e.stderr ?? e.message));
  process.exit(1);
}

console.log(`✓ appended to ${rc}`);
if (original) console.log(`  backup: ${backup}`);
console.log(`\nOpen a NEW terminal, then type \`git ch\` — the dropdown should appear.`);
console.log(`To undo: delete the "${MARKER}" block from ${rc}.`);
