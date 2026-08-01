# termauto

IDE-style dropdown autocomplete in the terminal for JS / React Native / iOS /
Android tooling — the Amazon Q autocomplete experience, self-hosted.

Built on a fork of [`microsoft/inshellisense`](https://github.com/microsoft/inshellisense)
(MIT), which supplies the hard part: a PTY wrapper that tracks the prompt and
cursor by parsing the live screen with `@xterm/headless`, and paints a dropdown
with ANSI escapes.

## Setup

```sh
make setup      # build engine, unpack the spec corpus, compile our specs
```

Then point the engine at our specs (already done at `~/.config/inshellisense/rc.toml`):

```toml
[specs]
path = ["/Users/amir/Desktop/RTN-folder/termauto/specs/build"]
maxSuggestions = 10
useFrecency = true
```

Start a session with `./bin/termauto`. To start it automatically in every new
shell, append the plugin line to `~/.zshrc` — note it **must be the last line**,
or a later plugin-manager init can break it:

```sh
./bin/termauto init zsh >> ~/.zshrc
```

Keys: <kbd>Tab</kbd> accept · <kbd>↑</kbd>/<kbd>↓</kbd> navigate · <kbd>Esc</kbd> dismiss.

## Layout

```
vendor/inshellisense/   MIT fork; its OWN git repo, `upstream` remote, 2 commits of ours
specs/src/              our specs (filename = command name)
specs/src/lib/          shared generators + spec-augment helpers
specs/refresh/drift.mjs --help vs spec drift report
bin/termauto            launcher
```

## How this hangs together

Three things make the design work, none of them obvious from the outside:

**1. Local specs override bundled ones.** `loadLocalSpecsSet()` feeds the *same*
mutable `specSet` as the bundled corpus and runs *after* it, so a spec we emit
under a given name replaces the bundled one. Adding specs and fixing stale ones
therefore needs **no engine changes at all** — just `specs.path`.

**2. We augment rather than duplicate.** `specs/src/lib/augment.ts` imports the
bundled spec and injects only what's missing (see `adb.ts`, `xcodebuild.ts`).
Copy-pasting an 11KB spec to add one generator would mean re-forking it on every
upstream change; this way untouched parts keep tracking upstream. `patchOptionArg`
throws if a flag disappears, so an upstream rename fails the build instead of
silently producing a dead generator.

**3. Frecency is one bounded number.** Ranking is a single `priority` sort. The
patch adds a shared `rankSuggestions()` (used by *both* recommendation paths, so
they can't drift) with a boost capped at 25 against the engine's scale — options
45, spec default 50, generators 60. History can lift a suggestion; it can't
flatten what the spec says. With no history the boost is 0 and ordering is
byte-identical, which is why all 93 upstream snapshots still pass.

## Vendor patches

Only two commits sit on top of upstream, kept separate so `make upstream`
(`git fetch && git rebase upstream/main`) stays cheap:

- `fix(complete): load config so local specs resolve` — upstream bug: `complete`
  never called `loadConfig()`, so `specs.path` stayed `[]` and the debug command
  silently disagreed with a real session. Also guards a
  `JSON.stringify(undefined)` crash. **Upstream-able as a PR.**
- `feat(frecency): rank suggestions by directory-aware usage history`

## Gotchas

- **Node must stay `<23`** (`engines: >=18 <23`). Currently v20.19.4. `node-pty`
  ships a `darwin-arm64` prebuild, so no native compile is needed.
- **`make unpack` must run with cwd = `vendor/inshellisense`.** In a non-SEA (dev)
  build, `unpackSpecs()` reads `process.cwd()/node_modules/@withfig/autocomplete/build`.
  Upstream ships as a Node SEA with specs embedded as assets; from a plain `tsc`
  build nothing populates `~/.inshellisense/spec` and every completion silently
  returns nothing.
- **`displayName` is not supported** by the engine — `toSuggestion()` drops it.
  Put the readable label in `name` and the real value in `insertValue` (see the
  `simulators` generator). The default filter is prefix-on-`name`, so the readable
  label is also what makes typing narrow the list.
- **Suggestions dedupe by `name`**, so same-named items (e.g. one simulator model
  across two runtimes) silently collapse unless the name is disambiguated.
- **Generators run on the keystroke path.** Anything slow needs `cache` plus
  `debounce: true` on the arg. `xcodebuild -list` takes ~2s cold.
- `gcloud`, `az` and `aws` are excluded by upstream (`ignoredSpecs`) for size —
  that's why they never complete.

## Spec drift

The bundled Fig corpus is **frozen**: last commit `2025-05-05`, and
`@withfig/autocomplete@2.692.3` was published the same day (inshellisense pins
the older `2.675.0`). Fig was absorbed into Amazon Q — since renamed Kiro — and
the spec repo went dormant. Flags added since mid-2025 are simply missing, so
override specs are a maintained asset rather than a one-time fix.

```sh
npm run refresh                        # drift report, all targets
node specs/refresh/drift.mjs eas       # one target, drills into subcommands
node specs/refresh/drift.mjs --scaffold bun
```

Output is **heuristic** — `--help` parsing can't recover descriptions, can't tell
a global flag from a scoped one, and picks flags out of usage examples. Review
before promoting a draft into `specs/src/`.

## Verify

```sh
make test                              # vendor suite
make complete Q="adb -s "              # headless completion probe
./bin/termauto specs list              # confirm our specs are registered
```

Three vendor tests fail on a clean upstream checkout too, for environmental
reasons (one shells out to a real `brew search`; two depend on terminal cursor
sequences). Not regressions — compare against `git stash` before believing
otherwise.
