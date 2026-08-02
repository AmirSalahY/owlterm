#!/usr/bin/env bash
# termauto installer.
#
#   curl -fsSL https://raw.githubusercontent.com/AmirSalahY/termauto/main/install.sh | bash
#
# Clones this repo, then hands off to scripts/setup.mjs, which does the real work:
# fetches the pinned engine, applies patches/, builds, unpacks the spec corpus and
# links `termauto` onto PATH. Re-running is safe — an existing checkout is updated
# in place rather than re-cloned.
#
# Environment:
#   TERMAUTO_HOME   where to keep the checkout   (default ~/.termauto/src)
#   TERMAUTO_REF    branch, tag or commit to use (default main)
#   TERMAUTO_REPO   clone URL                    (default this repo on GitHub)
set -euo pipefail

REPO="${TERMAUTO_REPO:-https://github.com/AmirSalahY/termauto.git}"
REF="${TERMAUTO_REF:-main}"
HOME_DIR="${TERMAUTO_HOME:-$HOME/.termauto/src}"

# Colours only when stdout is a terminal — this script is routinely piped.
if [[ -t 1 ]]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; N=''
fi

say()  { printf '%s\n' "${B}==>${N} $*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '  %s✗%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
say "Checking prerequisites"

command -v git  >/dev/null 2>&1 || die "git is required but not installed."
command -v node >/dev/null 2>&1 || die "Node.js is required but not installed. Install Node 20 or 22, then re-run."
command -v npm  >/dev/null 2>&1 || die "npm is required but not installed."

# The engine declares "node >=18.0 <23.0.0". node-pty ships an ABI-matched
# prebuilt binding, so an unsupported Node fails at RUNTIME, not at install —
# which surfaces as a shell that mysteriously won't start. Refuse up front.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 18 || "$NODE_MAJOR" -ge 23 ]]; then
  die "Node $(node -v) is unsupported — the engine requires >=18 <23. Install Node 20 or 22 and re-run."
fi
ok "node $(node -v), npm $(npm -v), git present"

# ── Fetch or update the checkout ──────────────────────────────────────────────
if [[ -d "$HOME_DIR/.git" ]]; then
  say "Updating $HOME_DIR"
  # Never clobber local edits: this directory is a normal checkout the user may
  # well have been working in.
  if [[ -n "$(git -C "$HOME_DIR" status --porcelain)" ]]; then
    warn "local changes present — skipping the update and building what is there"
  else
    git -C "$HOME_DIR" fetch --quiet origin "$REF"
    git -C "$HOME_DIR" checkout --quiet FETCH_HEAD
    ok "at $(git -C "$HOME_DIR" rev-parse --short HEAD)"
  fi
else
  say "Cloning $REPO"
  [[ -e "$HOME_DIR" ]] && die "$HOME_DIR exists but is not a git checkout — move it aside and re-run."
  mkdir -p "$(dirname "$HOME_DIR")"
  git clone --quiet --branch "$REF" "$REPO" "$HOME_DIR"
  ok "cloned to $HOME_DIR"
fi

cd "$HOME_DIR"

# ── Build ─────────────────────────────────────────────────────────────────────
say "Installing dependencies"
npm install --silent --no-audit --no-fund

say "Running setup"
npm run --silent setup

# ── Report ────────────────────────────────────────────────────────────────────
printf '\n%sInstalled.%s\n\n' "$B" "$N"

if command -v termauto >/dev/null 2>&1; then
  ok "\`termauto\` is on your PATH"
  printf '\nStart a session:\n\n  termauto\n\n'
else
  # setup.mjs prints the specific reason (nothing writable on PATH, or a
  # conflicting binary); don't guess at it here, just point at the fallback.
  warn "\`termauto\` is not on your PATH yet — see the setup output above"
  printf '\nStart a session with the full path:\n\n  %s/bin/termauto\n\n' "$HOME_DIR"
fi

printf 'To start it automatically in every new shell:\n\n'
printf '  cd %s && npm run shell-init\n\n' "$HOME_DIR"
printf 'To uninstall, remove %s and the termauto block from your shell rc file.\n' "$HOME_DIR"
