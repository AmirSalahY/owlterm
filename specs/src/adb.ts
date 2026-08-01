// Override: adb
//
// The bundled Fig spec has ZERO generators (verified), so `adb -s <TAB>` offers a
// bare "SERIAL" placeholder instead of your actually-connected devices. Everything
// else in the spec is fine, so we only inject the device generator.
import { loadBundledSpec, patchOptionArg } from "./lib/augment.js";
import { adbDevices } from "./lib/generators.js";

const spec = await loadBundledSpec("adb");

patchOptionArg(spec, "-s", {
  name: "SERIAL",
  description: "Connected device serial",
  generators: adbDevices,
});

export default spec;
