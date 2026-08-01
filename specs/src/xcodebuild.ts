// Override: xcodebuild
//
// The bundled Fig spec has ZERO generators (verified), so every one of these takes
// a bare placeholder. It also mis-declares `-destination` as `template: "folders"`,
// but a destination is a specifier like `platform=iOS Simulator,id=<udid>` — never
// a folder. We inject real generators and fix that.
//
// -list is slow on large projects, so schemes/configurations/targets share one
// cached generator (see lib/generators.ts) and their args set `debounce: true`.
import { loadBundledSpec, patchOptionArgs } from "./lib/augment.js";
import { xcodeSchemes, simulators } from "./lib/generators.js";

const spec = await loadBundledSpec("xcodebuild");

patchOptionArgs(spec, {
  "-scheme": {
    name: "NAME",
    description: "Scheme to build",
    debounce: true,
    generators: xcodeSchemes,
  },
  "-destination": {
    name: "DESTINATION SPECIFIER",
    description: "e.g. platform=iOS Simulator,id=<udid>",
    debounce: true,
    // Emit the full specifier, not a bare udid — pasting a raw udid here is an error.
    // The base generator puts the udid in insertValue (name is the readable label),
    // so wrap insertValue, not name.
    generators: {
      ...simulators,
      postProcess: (out: string) =>
        (simulators.postProcess?.(out, []) ?? []).map((s) => ({
          ...s,
          insertValue: `platform=iOS Simulator,id=${s.insertValue}`,
        })),
    },
  },
  "-project": {
    name: "NAME",
    description: "Xcode project",
    template: "filepaths",
  },
});

export default spec;
