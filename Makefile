VENDOR := vendor/inshellisense

.PHONY: setup shell-init specs test verify complete upstream patches release clean

## One-shot bootstrap on a new machine (idempotent — safe to re-run)
setup:
	npm install
	npm run setup

## Append the auto-start hook to your shell rc (backs up + syntax-checks + rolls back)
shell-init:
	npm run shell-init

## Cut a release: bump, tag, push, and wait for users to be notified
## make release            (patch)
## make release V=minor    (or major, or an explicit 1.2.3)
## make release V=--dry-run
release:
	npm run release -- $(V)

## Recompile our specs after editing specs/src
specs:
	npm run build:specs

## Vendor test suite
## NOTE: 3 tests fail on clean upstream too (one shells out to a real `brew
## search`, two depend on terminal cursor sequences). Compare before believing a
## regression. `npm run test:e2e` needs a `shell-use` daemon that isn't on npm.
test:
	npm run test:vendor

## Confirm the install resolved our specs, not just the bundled corpus
verify:
	node scripts/verify.mjs

## Headless completion probe: make complete Q="adb -s "
complete:
	@./bin/termauto complete "$(Q)"

## Replay our patches onto the latest upstream, then re-export them
upstream:
	cd $(VENDOR) && git fetch upstream && git rebase upstream/main
	cd $(VENDOR) && npm ci && npm run build
	npm run patches
	@echo "Remember to bump PINNED_COMMIT in scripts/setup.mjs"

## Re-export vendor commits to patches/ (do this after ANY vendor edit)
patches:
	npm run patches

clean:
	rm -rf specs/build specs/.tsc
