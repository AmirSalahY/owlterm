# Internals

Engineering notes moved out of the main README to keep that page short.
See [README.md](../README.md) for install and usage.

---

## Why this repo is small

`vendor/` is **deliberately not committed** — the engine keeps its own git repo
with an `upstream` remote so our changes stay a rebasable series.

```
install.sh          curl-pipe installer: clone + hand off to setup
scripts/setup.mjs   bootstrap: clone pinned engine, apply patches, build, configure
specs/src/          our specs (filename = command name)
specs/src/lib/      shared generators + spec-augment helpers
specs/refresh/      --help vs spec drift report
bin/owlterm        launcher (path-independent)
patches/            our engine commits, exported by `npm run patches`
vendor/             NOT committed — recreated by `npm run setup`
```

> ### The engine changes live in `patches/`
>
> `vendor/inshellisense` keeps its own git repo with no remote, so the engine
> commits — frecency, Right-arrow accept, the styled menu, the icon sets, the Esc
> fix, the `owlterm` branding — exist there as real commits and nowhere else.
> `patches/` is the exported copy, and it **is committed**: it is the only form in
> which those changes reach another machine. Without it a fresh clone installs
> vanilla inshellisense and none of the above works.
>
> The files are regenerated output and churn badly — the `[PATCH n/m]` counter
> rewrites every one of them whenever a commit is added — which is why they were
> gitignored originally. Being able to bootstrap is worth the noisy diffs.

**If you edit anything under `vendor/`, run `make patches` and commit the
result.** Skipping it means the change works here and nowhere else.

### Cutting a release

```sh
make release                # patch bump: 0.1.7 -> 0.1.8
make release V=minor        # or major, or an explicit V=1.2.3
make release V=--dry-run    # print every step, change nothing
```

It bumps `package.json`, commits as `chore: release X.Y.Z`, tags `vX.Y.Z` and
pushes — the tag is what `.github/workflows/release.yml` turns into a GitHub
release.

That release is also the only thing that tells existing users anything: on shell
start `scripts/check-update.mjs` reads the repo's latest release and prints the
upgrade notice, so a tag that never publishes reaches nobody. The script
therefore waits for the release to actually become _latest_ on that endpoint and
fails loudly if it doesn't (`--no-wait` skips it). It also refuses to release a
checkout whose `vendor/` work was never exported into `patches/`.

Users see the notice on their next update check — within 6h, or immediately on
`owlterm update`.

---

## How it works

Three non-obvious things carry the design:

**1. Local specs override bundled ones.** `loadLocalSpecsSet()` feeds the _same_
mutable `specSet` as the bundled corpus and runs _after_ it, so a spec we emit
under a given name replaces the bundled one. Adding specs and fixing stale ones
needs **no engine changes at all** — just `specs.path` in the config.

**2. We augment rather than duplicate.** `specs/src/lib/augment.ts` imports the
bundled spec and injects only what's missing (see `adb.ts`, `xcodebuild.ts`).
Copy-pasting an 11KB spec to add one generator would mean re-forking it on every
upstream change; this way untouched parts keep tracking upstream.
`patchOptionArg` **throws** if a flag vanishes, so an upstream rename fails the
build instead of silently leaving a dead generator.

**3. Frecency is one bounded number.** Ranking is a single `priority` sort. Our
patch adds a shared `rankSuggestions()` — used by _both_ recommendation paths so
they can't drift apart — with a boost capped at 25 against the engine's own scale
(options 45, spec default 50, generators 60). History can lift a suggestion; it
can never flatten what the spec says. Hits decay with a 14-day half-life, and
same-directory hits count 4x global ones. With no history the boost is 0 and
ordering is byte-identical, which is why all 93 upstream snapshots still pass.

> The ranking key is built from `allTokens`, not `acceptedTokens`. The recursion
> is seeded with `activeCmd.slice(1)` and `acceptedTokens` defaulted to `[]`, so
> the command name is missing from it at every depth — ranking off that looked up
> `"rebase"` while history had stored `"git rebase"`, and the boost was dead for
> every subcommand. Unit-testing `rankingBoost()` alone did not catch it; the
> regression test now goes through `getSuggestions()`.

### What we add on top of Fig

Fig's corpus (`@withfig/autocomplete`, 716 specs) is bundled whole, so `git`,
`docker`, `npm`, `composer`, `php` and hundreds more already work — there is
nothing to add for those, and writing our own would just shadow a better spec.

Our seven exist because Fig's corpus is missing or thin there:

| Spec         | Why                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| `artisan`    | **absent from Fig entirely.** Laravel's actual day-to-day CLI                    |
| `sail`       | absent from Fig; Laravel's Docker wrapper                                        |
| `php`        | augmented so `php artisan <TAB>` chains into the artisan spec                    |
| `adb`        | augmented with connected-device completion                                       |
| `xcodebuild` | augmented with real schemes and simulators                                       |
| `rtk`        | private tool, no upstream spec                                                   |
| `owlterm`   | this tool. Fig has no spec for it under any name — not `is`, not `inshellisense` |

`artisan` and `sail` are **fully dynamic**: the command list comes from
`artisan list --format=json`, so it includes whatever the project actually has —
`queue:*` from Horizon, `nova:*`, your own `App\Console\Commands` — and the
options come from each command's own definition. Hardcoding the framework's
built-ins would be wrong for every real app.

Nothing is spawned unless an `artisan` file exists above the cwd, and the JSON is
memoised per project root so the two generators (command names, and that
command's options) share one `php` invocation rather than one each.

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

## Releases

Releases are tag-driven. Bump `package.json`, commit it, then tag the same
version with a leading `v`:

```sh
git tag v0.1.1
git push origin v0.1.1
```

`.github/workflows/release.yml` validates that the tag matches `package.json`,
builds the specs, and creates or updates the GitHub Release. That release is the
metadata `owlterm` checks when deciding whether to show the update notice.

Our commits, kept separate so rebases stay cheap:

- **`fix(complete): load config so local specs resolve`** — an upstream bug:
  `complete` never called `loadConfig()`, so `specs.path` stayed `[]` and the
  debug command silently disagreed with a real session. Also guards a
  `JSON.stringify(undefined)` crash. **Worth sending upstream as a PR.**
- **`feat(frecency): rank suggestions by directory-aware usage history`**
- **`fix(ui): make Esc actually dismiss, and style the menu like a macOS menu`**
- **`feat(ui): accept on Enter/Right, and actually style the dropdown`** — also
  fixes a latent upstream bug: `renderBox` did `chalk.hex(color).apply(text)`,
  which calls `Function.prototype.apply` with `text` as _thisArg_ and **no
  arguments**, so chalk returned `""` and every border character disappeared.
  Dormant only because no caller ever passed a `borderColor`. **Also PR-worthy.**
- **`feat(ui): icon sets (nerd/unicode/emoji) + frosted glass menu styling`** —
  swaps the emoji icon column for Nerd Font glyphs with a plain-Unicode fallback,
  dims the icon column, and adds a lit/shaded border plus `theme.surface`. Also
  tightens the `specs` schema: a root key written below the `[specs]` header is
  TOML-scoped _into_ that table, so it validated fine while being silently
  ignored — which is how the generated config's `maxSuggestions = 10` sat dead
  and everyone got 5.
- **`feat(alias): cap the recent-commands prompt to the last 5`**

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
