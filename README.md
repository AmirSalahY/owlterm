# termauto

IDE-style dropdown autocomplete in the terminal — the Amazon Q autocomplete
experience, self-hosted — tuned for JS / React Native / iOS / Android tooling.

Type `xcodebuild -scheme ` and get your project's **real** schemes. Type `adb -s `
and get your **actually connected** devices. Suggestions are ranked by what you
actually run, in the directory you're in.

Built on a fork of [`microsoft/inshellisense`](https://github.com/microsoft/inshellisense)
(MIT), which supplies the hard part: a PTY wrapper that tracks your prompt and
cursor by parsing the live screen with `@xterm/headless`, then paints a dropdown
with ANSI escapes.

---

## Install on a new device

### Requirements

| | |
|---|---|
| **Node** | `>=18` and `<23` — **hard requirement** (see below). Check with `node -v` |
| **git** | to fetch the engine |
| **OS** | macOS, Linux, or Windows (`darwin/linux/win32` × `x64/arm64`) |
| Optional | Xcode CLT for scheme/simulator completion; Android SDK for `adb` completion |

> **Node must be < 23.** The engine declares `node >=18.0 <23.0.0` and `node-pty`
> loads a prebuilt native binding matched to the Node ABI — so a too-new Node
> fails at *runtime*, not at install, which looks like "the dropdown just doesn't
> appear". `nvm install 22` or `brew install node@22` if you're on 23+.
> Setup checks this and refuses to continue.

### Three commands

```sh
git clone <this-repo> termauto && cd termauto
npm install
npm run setup
```

`npm run setup` is idempotent — safe to re-run any time. It:

1. verifies your Node version and platform,
2. clones the engine at a **pinned** commit and applies `patches/*.patch`,
3. installs deps and builds it,
4. unpacks the ~727-entry spec corpus into `~/.inshellisense/spec`,
5. compiles our specs,
6. links `bin/termauto` onto your PATH as **`is`** — the generated shell hook
   invokes it by that bare name, and without it auto-start silently never fires,
7. writes `~/.config/inshellisense/rc.toml` **with the absolute paths for that
   machine** — or, if you already have a config, prints the block to merge
   instead of overwriting it.

Then start a session:

```sh
./bin/termauto
```

Type `git ch`, `yarn `, or `xcodebuild -scheme ` and the dropdown appears.

Keys: <kbd>Tab</kbd> / <kbd>Enter</kbd> / <kbd>→</kbd> accept · <kbd>↑</kbd>/<kbd>↓</kbd> navigate ·
<kbd>Esc</kbd> dismiss · <kbd>Tab</kbd> re-open after dismissing.

Upstream only accepts on <kbd>Tab</kbd>. We add two more, both config-gated:

- <kbd>Enter</kbd> accepts the highlighted suggestion, then a second <kbd>Enter</kbd>
  runs the command. If the word is **already fully typed** there's nothing to
  accept, so <kbd>Enter</kbd> submits directly rather than demanding two presses.
- <kbd>→</kbd> accepts **only with the cursor at end of line** — mid-line it still
  moves the cursor, otherwise the line would be uneditable.

Set `acceptOnEnter = false` / `acceptOnRightArrow = false` to get the
Tab-only behaviour back.

<kbd>Esc</kbd> closes the menu **for the rest of the line** — it no longer pops
back on the next character (upstream reset its hidden flag on the very next
keystroke, which made Esc look broken). <kbd>Tab</kbd> re-opens it, as does
submitting or clearing the line. <kbd>↑</kbd>/<kbd>↓</kbd> deliberately do *not*
re-open: upstream already uses those to keep the menu hidden while you browse
shell history.

### Start it automatically in every shell

```sh
npm run shell-init          # zsh (default) — or: npm run shell-init bash
npm run shell-init -- --dry-run   # preview without writing
```

Use this rather than the upstream `is init zsh >> ~/.zshrc`, because it also:

- **backs up** your rc file first,
- **syntax-checks** the result and **restores the backup if it broke** (a broken
  `.zshrc` breaks every new shell),
- refuses to add itself twice,
- fails loudly if `is` isn't on PATH instead of writing a hook that silently
  never starts,
- and wraps the hook in a **stronger guard** than the generated script's.

> **Why the stronger guard.** zsh does *not* put `c` in `$-` for `zsh -i -c`, so
> upstream's `$- != *c*` test doesn't catch that case — any tooling that runs
> `zsh -i -c …` would hang forever waiting on the PTY. The added
> `-z "$ZSH_EXECUTION_STRING"` check identifies a genuinely interactive shell.

> It **must be the last thing** in the rc file. Anything initialising after it —
> notably a plugin manager — can break it.

For fish / pwsh / nu: `./bin/termauto init <shell>`, placed last in that rc file.

**To undo:** delete the `termauto (inshellisense)` block from `~/.zshrc` (a
timestamped `~/.zshrc.pre-termauto-*` backup is kept). Full removal:

```sh
rm -rf ~/.inshellisense ~/.config/inshellisense ~/.local/bin/is
```

### Verify the install

```sh
make verify                            # spec count + confirms OUR specs loaded
make complete Q="git ch"               # headless completion probe
make complete Q="xcodebuild -scheme "  # run this from inside an Xcode project
```

Expected output:

```
707 specs loaded
ours: 3 (2 override bundled, 1 unique)
✓ specs.path resolved — confirmed via rtk (present only in this checkout)
```

It keys on a spec that exists *only* here, because most of ours override bundled
specs (`adb`, `xcodebuild`) — seeing those names would prove nothing, since
they'd be loaded anyway. If it fails, `specs.path` isn't pointing at this
checkout's `specs/build`; the usual cause is a pre-existing config that setup
declined to overwrite (step 6 prints the block to merge).

---

## Why this repo is small

`vendor/` is **deliberately not committed** — the engine keeps its own git repo
with an `upstream` remote so our changes stay a rebasable series. Our engine
changes live in **`patches/`**, which is the only portable record of them.

```
patches/            our 2 engine commits — WITHOUT these, no frecency
scripts/setup.mjs   bootstrap: clone pinned engine, apply patches, build, configure
specs/src/          our specs (filename = command name)
specs/src/lib/      shared generators + spec-augment helpers
specs/refresh/      --help vs spec drift report
bin/termauto        launcher (path-independent)
vendor/             NOT committed — recreated by `npm run setup`
```

**If you edit anything under `vendor/`, run `make patches`.** Otherwise the change
exists on your machine only and no other device can reproduce it.

---

## How it works

Three non-obvious things carry the design:

**1. Local specs override bundled ones.** `loadLocalSpecsSet()` feeds the *same*
mutable `specSet` as the bundled corpus and runs *after* it, so a spec we emit
under a given name replaces the bundled one. Adding specs and fixing stale ones
needs **no engine changes at all** — just `specs.path` in the config.

**2. We augment rather than duplicate.** `specs/src/lib/augment.ts` imports the
bundled spec and injects only what's missing (see `adb.ts`, `xcodebuild.ts`).
Copy-pasting an 11KB spec to add one generator would mean re-forking it on every
upstream change; this way untouched parts keep tracking upstream.
`patchOptionArg` **throws** if a flag vanishes, so an upstream rename fails the
build instead of silently leaving a dead generator.

**3. Frecency is one bounded number.** Ranking is a single `priority` sort. Our
patch adds a shared `rankSuggestions()` — used by *both* recommendation paths so
they can't drift apart — with a boost capped at 25 against the engine's own scale
(options 45, spec default 50, generators 60). History can lift a suggestion; it
can never flatten what the spec says. Hits decay with a 14-day half-life, and
same-directory hits count 4× global ones. With no history the boost is 0 and
ordering is byte-identical, which is why all 93 upstream snapshots still pass.

### Config

`~/.config/inshellisense/rc.toml` (generated by setup). The schema is
`additionalProperties: false` — an unknown key fails validation at startup.

```toml
[specs]
path = ["/abs/path/to/termauto/specs/build"]   # machine-specific

maxSuggestions = 10       # default 5 is cramped for e.g. xcodebuild's 78 options
useFrecency = true        # our addition; false disables usage-based ranking
useNerdFont = false       # true resolves fig:// icons to Nerd Font glyphs
acceptOnEnter = true      # our addition; Enter accepts the highlighted suggestion
acceptOnRightArrow = true # our addition; Right accepts at end of line only

[theme]                        # all ours; upstream hardcoded one purple
border = "#3A3A3C"             # hairline border
activeBackground = "#0A84FF"   # systemBlue selection
activeForeground = "#FFFFFF"   # selected row text
description = "#98989D"        # secondary text (dimmed)
pointer = "▸"                  # selected-row marker; must be 1 cell wide
corners = "rounded"            # "rounded" (macOS menu) or "square"
```

Defaults model a native macOS menu: rounded corners, hairline border, systemBlue
selection, dimmed secondary text, and no body fill so your terminal background
shows through.

The `pointer` sits in a fixed-width gutter rendered on **every** row, so the text
never shifts sideways as the selection moves. Keep it one cell wide or the box
alignment breaks.

Frecency history lives at `~/.inshellisense/frecency.jsonl`. Delete it to reset
ranking.

---

## Adding your own completions

Drop a file in `specs/src/` — **the filename is the command name** — then
`make specs`.

New CLI from scratch (see `specs/src/rtk.ts`):

```ts
const spec: Fig.Spec = {
  name: "mytool",
  subcommands: [{ name: "deploy", description: "Ship it" }],
};
export default spec;
```

Fixing an existing CLI (see `specs/src/adb.ts`):

```ts
import { loadBundledSpec, patchOptionArg } from "./lib/augment.js";
const spec = await loadBundledSpec("adb");
patchOptionArg(spec, "-s", { name: "SERIAL", generators: adbDevices });
export default spec;
```

Shared helpers go in `specs/src/lib/` — that folder is excluded from the spec
index, and `tsc` preserves its structure so `./lib/x.js` imports keep resolving.

### Writing generators

Generators run **on the keystroke path**, so:

- Prefer in-process `custom` + `node:fs` over spawning a shell. Reading
  `package.json` is ~0ms.
- Anything slow needs `cache: { ttl, strategy: "max-age" }` **and**
  `debounce: true` on the arg. `xcodebuild -list` takes ~2s cold.
- `script` without `postProcess` or `splitOn` silently yields nothing.
- Don't assume tools are on `PATH` — the engine's environment isn't your
  interactive shell's. See `adbCandidates()` for the fallback pattern.

---

## Gotchas

- **`displayName` is not supported** — the engine's `toSuggestion()` drops it. Put
  the readable label in `name` and the real value in `insertValue` (see the
  `simulators` generator). The default filter is prefix-on-`name`, so a readable
  label is also what makes typing narrow the list.
- **Suggestions dedupe by `name`**, so same-named items (one simulator model
  across two runtimes) silently collapse unless you disambiguate the name.
- **Spec unpacking needs cwd = `vendor/inshellisense`.** In a non-SEA (dev) build
  `unpackSpecs()` reads `process.cwd()/node_modules/@withfig/autocomplete/build`.
  Upstream ships as a single executable with specs embedded as assets; from a
  plain `tsc` build nothing populates `~/.inshellisense/spec` and **every
  completion silently returns nothing**. `npm run setup` handles this.
- `gcloud`, `az` and `aws` are excluded upstream (`ignoredSpecs`) for size —
  that's why they never complete.

---

## Spec drift

The bundled Fig corpus is **frozen**: last commit `2025-05-05`, and
`@withfig/autocomplete@2.692.3` was published the same day (the engine pins the
older `2.675.0`). Fig was absorbed into Amazon Q — since renamed Kiro — and the
spec repo went dormant. Flags added since mid-2025 are simply missing, so
override specs are a **maintained asset**, not a one-time fix.

```sh
npm run refresh                             # drift report, all targets
node specs/refresh/drift.mjs eas            # one target; drills into subcommands
node specs/refresh/drift.mjs --scaffold bun # emit a draft override
```

Output is **heuristic**: `--help` parsing can't recover descriptions, can't tell a
global flag from a scoped one, and picks up flags from usage examples. Review
before promoting a draft into `specs/src/`. Only top-level gaps are scaffolded —
subcommand gaps are reported but need placing by hand.

---

## Upstream upgrades

```sh
make upstream    # fetch, rebase our 2 commits, rebuild, re-export patches
```

Then bump `PINNED_COMMIT` in `scripts/setup.mjs` to the new base (the command
prints it) and commit the refreshed `patches/`.

Our two commits, kept separate so rebases stay cheap:

- **`fix(complete): load config so local specs resolve`** — an upstream bug:
  `complete` never called `loadConfig()`, so `specs.path` stayed `[]` and the
  debug command silently disagreed with a real session. Also guards a
  `JSON.stringify(undefined)` crash. **Worth sending upstream as a PR.**
- **`feat(frecency): rank suggestions by directory-aware usage history`**
- **`fix(ui): make Esc actually dismiss, and style the menu like a macOS menu`**
- **`feat(ui): accept on Enter/Right, and actually style the dropdown`** — also
  fixes a latent upstream bug: `renderBox` did `chalk.hex(color).apply(text)`,
  which calls `Function.prototype.apply` with `text` as *thisArg* and **no
  arguments**, so chalk returned `""` and every border character disappeared.
  Dormant only because no caller ever passed a `borderColor`. **Also PR-worthy.**

> **Heads-up on testing the dropdown's looks:** `src/tests/ui/` — the only suite
> that snapshots the rendered dropdown — is **excluded** from `npm test`
> (`testPathIgnorePatterns`), and it needs the `shell-use` daemon anyway. So the
> 93 passing snapshots say nothing about the visuals. Verify styling by driving
> the render methods directly, as `_renderSuggestions`/`_renderDescription` are
> TS-`private` (not `#private`) and reachable at runtime.

## Tests

```sh
make test
```

**3 tests fail on a clean upstream checkout too** — one shells out to a real
`brew search`, two depend on terminal cursor sequences. Compare against
`git checkout <PINNED_COMMIT>` before believing you caused a regression.

`npm run test:e2e` (the interactive-dropdown suite) needs a `shell-use` native
daemon that isn't installable from npm; it fails identically on clean upstream.
