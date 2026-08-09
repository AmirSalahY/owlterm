#!/usr/bin/env node
// Install the auto-start hook at the TOP of your shell rc file, safely.
//
// Does what `is init zsh >> ~/.zshrc` does, plus the parts that matter:
//   - refuses to add itself twice
//   - backs the file up first
//   - SYNTAX-CHECKS the result and restores the backup if it broke
//   - wraps the hook in a stronger guard than the generated script's own
//   - moves a block left at the bottom by an older install up to the top
//
// Why the top and not the bottom, which is what upstream tells you to do: the
// hook execs the wrapper and never returns, so everything below it is dead code
// for an interactive shell either way. Put it last and the OUTER shell first
// evaluates the whole rc file — plugin manager, compinit, nvm, the lot — and the
// wrapped shell then evaluates it a second time. Put it first and that cost is
// paid once. On a p10k + nvm + rvm profile the difference measured 3.3s -> 1.9s
// to a usable prompt.
//
// Usage: node scripts/shell-init.mjs [zsh|bash] [--dry-run]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "owlterm (inshellisense)";
// termauto was renamed to owlterm. An rc file from before the rename still
// carries the old marker, and its block behaves identically (it only sources
// ~/.inshellisense/init/<shell>/init.<ext>, unaffected by the rename) — so
// treat it as already installed rather than appending a second, redundant block.
const LEGACY_MARKER = "termauto (inshellisense)";

/** The command name the generated init script re-execs. Must match setup.mjs. */
const CMD = "owlterm";

// Running first means the PATH lines further down the rc file have not happened
// yet, so the block cannot rely on them. It re-adds the one directory it needs —
// the same one setup.mjs linked the launcher into — and only inside the branch
// that is about to hand the terminal over, so a wrapped shell never sees it twice.
const SHELLS = {
  zsh: {
    rc: path.join(os.homedir(), ".zshrc"),
    check: (f) => execFileSync("zsh", ["-n", f], { stdio: "pipe" }),
    // The guards are the point. zsh does NOT put `c` in $- for `zsh -i -c`, so the
    // generated script's own `$- != *c*` test misses it and any tooling running
    // `zsh -i -c ...` hangs waiting on the PTY. ZSH_EXECUTION_STRING is set only
    // when -c was used, which identifies a real interactive shell reliably.
    block: (binDir) => `# ── ${MARKER} — keep this FIRST in this file ──
# It execs the wrapper and never returns, so everything below runs once, inside
# the wrapped shell. Moved to the bottom, the outer shell evaluates this whole
# file before handing over and the wrapped shell then evaluates it again.
#
# The extra guards matter: zsh does NOT put \`c\` in $- for \`zsh -i -c\`, so the
# generated script's own \`$- != *c*\` test doesn't catch that case, and tooling that
# runs \`zsh -i -c ...\` would hang waiting on the PTY. ZSH_EXECUTION_STRING is set
# only when -c was used, which distinguishes a real interactive shell reliably.
if [[ -o interactive && -z "$ZSH_EXECUTION_STRING" && -z "$ISTERM" ]]; then
  export PATH="${binDir}:$PATH"
  [[ -f ~/.inshellisense/init/zsh/init.zsh ]] && source ~/.inshellisense/init/zsh/init.zsh
fi

`,
  },
  bash: {
    rc: path.join(os.homedir(), ".bashrc"),
    check: (f) => execFileSync("bash", ["-n", f], { stdio: "pipe" }),
    // Single brackets, not [[ ]]: `owlterm doctor` looks for this line verbatim
    // and the form it knows is the POSIX test.
    block: (binDir) => `# ── ${MARKER} — keep this FIRST in this file ──
# It execs the wrapper and never returns, so everything below runs once, inside
# the wrapped shell. Moved to the bottom, the outer shell evaluates this whole
# file before handing over and the wrapped shell then evaluates it again.
#
# $- does contain 'i' only for interactive shells; also require a TTY so that
# non-interactive tooling never ends up waiting on the PTY.
case $- in *i*)
  if [[ -z "$ISTERM" && -t 0 ]]; then
    export PATH="${binDir}:$PATH"
    [ -f ~/.inshellisense/init/bash/init.sh ] && source ~/.inshellisense/init/bash/init.sh
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
  console.error(`For fish/pwsh/nu, use: ${CMD} init <shell>  (and place it FIRST in the rc file)`);
  process.exit(1);
}

// The generated init script invokes the engine by the bare name `owlterm`;
// without that on PATH nothing starts and there is no visible error. Fail loudly
// rather than write a dead hook. The directory is also what the block re-adds to
// PATH, since running first means the rc file's own PATH lines haven't run yet.
let binDir;
try {
  const resolved = execFileSync("sh", ["-c", `command -v ${CMD}`], { encoding: "utf-8" }).trim();
  // dirname of the entry on PATH, not of its symlink target: the linked location
  // is the one that will still resolve after the checkout moves.
  binDir = path.dirname(resolved);
} catch {
  console.error(`✗ \`${CMD}\` is not on your PATH, so the hook would never start.`);
  console.error(`  Run \`npm run setup\` (it links bin/${CMD} onto PATH) and try again.`);
  process.exit(1);
}

const { rc, check } = shell;
const block = shell.block(binDir);

const original = fs.existsSync(rc) ? fs.readFileSync(rc, "utf-8") : "";

/**
 * Everything from an existing block's header line to EOF, or undefined when
 * there is no block. Older installs appended, so the block always ran to the end
 * of the file — but only strip that region once every line in it is recognisably
 * part of the hook. A line this doesn't know about is a line someone added by
 * hand, and moving the block is not worth silently deleting it.
 */
const findOldBlock = (body) => {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.includes(MARKER) || l.includes(LEGACY_MARKER));
  if (start === -1) return undefined;

  // Already at the top: this is the shape this script writes, and the rest of the
  // file is the user's config. Nothing to scan and nothing to move.
  if (lines.slice(0, start).join("\n").trim() === "") return { start, body: "", alreadyFirst: true };

  const ours = (line) => {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) return true;
    if (t.includes(".inshellisense/init/")) return true;
    return ["fi", ";; esac", "case $- in *i*)", "if [[ -o interactive && -z \"$ZSH_EXECUTION_STRING\" && -z \"$ISTERM\" ]]; then", 'if [[ -z "$ISTERM" && -t 0 ]]; then'].includes(t);
  };

  const foreign = lines.slice(start).find((l) => !ours(l));
  if (foreign != null) {
    console.error(`✗ ${rc} has an owlterm block, but this line sits below it and isn't part of it:`);
    console.error(`    ${foreign.trim()}`);
    console.error(`  Move the block to the top of the file by hand, or delete it and re-run.`);
    process.exit(1);
  }
  return { start, body: lines.slice(start).join("\n") };
};

const old = findOldBlock(original);
if (old?.alreadyFirst) {
  console.log(`✓ already present at the top of ${rc} — nothing to do`);
  process.exit(0);
}

const stripped = old ? original.slice(0, original.length - old.body.length).trimEnd() : original.trimEnd();
const updated = stripped === "" ? block : `${block}${stripped}\n`;

if (dryRun) {
  console.log(old ? `would move the block to the top of ${rc}:\n${block}` : `would prepend to ${rc}:\n${block}`);
  process.exit(0);
}

const backup = `${rc}.pre-owlterm-${new Date().toISOString().replace(/[:.]/g, "-")}`;
if (original) fs.writeFileSync(backup, original);

fs.writeFileSync(rc, updated);

try {
  check(rc);
} catch (e) {
  // A broken rc file breaks every new shell — put it back immediately.
  fs.writeFileSync(rc, original);
  console.error(`✗ the result failed a syntax check, so ${rc} was restored unchanged.`);
  console.error(String(e.stderr ?? e.message));
  process.exit(1);
}

console.log(old ? `✓ moved the hook to the top of ${rc}` : `✓ prepended to ${rc}`);
if (original) console.log(`  backup: ${backup}`);
console.log(`\nOpen a NEW terminal, then type \`git ch\` — the dropdown should appear.`);
console.log(`To undo: delete the "${MARKER}" block from ${rc}.`);
