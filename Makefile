VENDOR := vendor/inshellisense
SPECS_BUILD := $(CURDIR)/specs/build

.PHONY: setup build unpack specs test complete clean upstream

## Full first-time setup
setup: build unpack specs

## Compile the vendored engine (tsc only; node-pty ships a darwin-arm64 prebuild,
## so no native compile is needed)
build:
	cd $(VENDOR) && npm ci && npm run build

## Populate ~/.inshellisense/spec from the bundled Fig corpus.
## IMPORTANT: in a non-SEA (dev) build, unpackSpecs() reads
## `process.cwd()/node_modules/@withfig/autocomplete/build`, so this MUST run with
## cwd = $(VENDOR). Upstream normally does this inside `is init`, but there it is
## called un-awaited (a race), so we invoke it directly and await it.
unpack:
	cd $(VENDOR) && node --input-type=module -e \
	  'import { unpackResources } from "./build/utils/node.js"; await unpackResources(); console.log("specs unpacked");'

## Compile our own + override specs into specs/build
specs:
	npm run build:specs

## Vendor test suite (jest, needs --experimental-vm-modules)
test:
	cd $(VENDOR) && npm test

## Headless completion check: make complete Q="adb -s "
complete:
	@cd $(VENDOR) && node build/index.js complete "$(Q)"

## Replay our patches onto the latest upstream
upstream:
	cd $(VENDOR) && git fetch upstream && git rebase upstream/main

clean:
	rm -rf specs/build
