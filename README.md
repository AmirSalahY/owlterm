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
with an `upstream` remote so our changes stay a rebasable series.

```
scripts/setup.mjs   bootstrap: clone pinned engine, apply patches, build, configure
specs/src/          our specs (filename = command name)
specs/src/lib/      shared generators + spec-augment helpers
specs/refresh/      --help vs spec drift report
bin/termauto        launcher (path-independent)
patches/            NOT committed — regenerated by `npm run patches`
vendor/             NOT committed — recreated by `npm run setup`
```

> ### ⚠️ The engine changes are not in this repo
>
> `patches/` is gitignored, and `vendor/inshellisense` has its own repo with no
> remote. The 8 engine commits — frecency, Enter/Right accept, the styled menu,
> the icon sets, the Esc fix — therefore exist **only on the machine that made
> them**, in `vendor/inshellisense/.git` and the untracked `patches/` directory.
>
> A fresh clone runs `npm run setup`, finds no `patches/`, and installs vanilla
> inshellisense: none of the above, and Esc stays broken. That is expected, not a
> bug — but it means **`vendor/inshellisense/.git` is the only copy of that work.**
> Back it up, or push it to a fork, before wiping the checkout.

**If you edit anything under `vendor/`, run `make patches`** to refresh the local
`patches/`. It keeps this machine reproducible; it no longer travels with the repo.

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
useNerdFont = false       # legacy shorthand for theme.icons = "nerd"
acceptOnEnter = true      # our addition; Enter accepts the highlighted suggestion
acceptOnRightArrow = true # our addition; Right accepts at end of line only

[theme]                        # all ours; upstream hardcoded one purple
icons = "auto"                 # "auto" | "codicon" | "unicode" | "emoji" | "none"
border = "#2C2C2E"             # hairline border, shaded (bottom/right) edge
borderHighlight = "#48484A"    # lit (top/left) edge — reads as a raised panel
activeBackground = "#0A84FF"   # systemBlue selection
activeForeground = "#FFFFFF"   # selected row text
foreground = "#E5E5EA"         # unselected row text
icon = "#8E8E93"               # icon column on unselected rows (dimmed)
description = "#98989D"        # secondary text (dimmed)
pointer = "›"                  # selected-row marker; must be 1 cell wide
corners = "rounded"            # "rounded" (macOS menu) or "square"
surface = "clear"              # "clear" (glass) or a hex fill
```

Defaults model a frosted native macOS menu: rounded corners, a hairline border lit
along the top-left and shaded bottom-right, systemBlue selection, a dimmed icon
column so the labels stay dominant, and a clear body.

#### Icons

Upstream shipped emoji, which are double-width and — for the ones carrying a
variation selector — measured inconsistently across terminals, so the icon column
knocked labels out of alignment. Every glyph in the `nerd` and `unicode` sets is
single-cell, enforced by a test.

| `theme.icons` | What you get |
| --- | --- |
| `auto` *(default)* | `codicon` when the terminal can render them, else `unicode` |
| `codicon` | [Codicons](https://microsoft.github.io/vscode-codicons/) — VS Code's own icon set, the same artwork IntelliSense uses for its completion list |
| `unicode` | Geometric symbols (`◆ ▪ ▸ · ★`) — **the only set that renders in every terminal** |
| `emoji` | Upstream's set, alignment caveat and all |
| `none` | No icon column |

`nerd` is accepted as a deprecated alias for `codicon`.

**Which set works everywhere: `unicode`.** Its glyphs are real assigned
codepoints, so when a terminal's font lacks one the OS substitutes a font that
has it — the same mechanism that draws 📄 in Menlo, which contains no emoji at
all, and `╭` in Monaco, which has no rounded corners. The private use area gets
no such fallback: no system font claims those codepoints, so Codicons render as
blanks or boxes in any terminal not set to a patched font. That asymmetry is the
whole story, and why `unicode` is the safe default.

Run `scripts/icon-check.sh` in a terminal to see which sets it can draw.

**Codicons are delivered by a Nerd Font.** A terminal renders text and nothing
else, so an icon has to *be* a character: Codicons occupy U+EA60–U+EC1E in the
private use area, and a patched font is the only way those codepoints resolve to
artwork. Nerd Font is the container; Codicons are the contents.

`auto` therefore checks two things — that a patched font is installed, and that
this terminal is actually configured to use it. The second matters: a font
selected in iTerm does nothing for the VS Code terminal, which has its own
`terminal.integrated.fontFamily` and falls back to Menlo. Installing is a
one-liner, and you must also select it as your terminal's font:

```sh
brew install --cask font-jetbrains-mono-nerd-font
```

`is doctor` prints the resolved style with a sample row and names which of the two
conditions failed, which is the quickest way to tell "no font installed" from
"font installed but this terminal isn't using it". `IS_ICONS=emoji is` overrides
the style for one session without touching config.

Why not SVG: no terminal renders SVG. The image protocols that exist (iTerm2
inline images, Kitty, Sixel) take rasterised bitmaps, aren't supported by every
terminal, and — decisively — sit outside the character-cell model this renderer
patches into on every keystroke. See `SuggestionRenderer`.

#### Glass

ANSI has no blur, so `surface = "clear"` gets there by painting no background at
all: the terminal shows through the menu, and your terminal's own transparency and
blur become the frosted backdrop. In iTerm2 that's Settings → Profiles → Window →
Transparency + Blur. Set `surface` to a hex value instead for a flat tint on an
opaque terminal.

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
prints it). `patches/` is gitignored, so there is nothing to commit — the refresh
only updates this machine.

Our eight commits, kept separate so rebases stay cheap:

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
- **`feat(ui): icon sets (nerd/unicode/emoji) + frosted glass menu styling`** —
  swaps the emoji icon column for Nerd Font glyphs with a plain-Unicode fallback
  (see [Icons](#icons)), dims the icon column, and adds a lit/shaded border plus
  `theme.surface`. Also tightens the `specs` schema: a root key written below the
  `[specs]` header is TOML-scoped *into* that table, so it validated fine while
  being silently ignored — which is how the generated config's
  `maxSuggestions = 10` sat dead and everyone got 5.

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
