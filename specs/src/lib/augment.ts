// Helpers for overriding a bundled Fig spec by AUGMENTING it rather than
// duplicating it.
//
// Why: loadLocalSpecsSet() overrides bundled specs by name, so a local `adb.js`
// fully replaces the bundled one. Copy-pasting an 11KB spec just to add one
// generator would mean re-forking it on every upstream change. Instead we import
// the bundled spec and inject only what's missing — so the parts we didn't touch
// keep tracking upstream.
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Same location as vendor/inshellisense/src/utils/constants.ts:specResourcesPath.
// Populated by `make unpack`.
const specResourcesPath = path.join(os.homedir(), ".inshellisense", "spec");

/**
 * Import a bundled spec by name.
 *
 * Safe to mutate the result: because our local spec wins the name, the engine
 * never loads the bundled module itself — we are its only importer.
 */
export const loadBundledSpec = async (name: string): Promise<Fig.Subcommand> => {
  const url = pathToFileURL(path.join(specResourcesPath, `${name}.js`)).href;
  const mod = await import(url);
  const spec = mod.default;
  if (typeof spec !== "object" || spec == null) {
    throw new Error(`termauto: bundled spec '${name}' is not a plain object (got ${typeof spec})`);
  }
  return spec as Fig.Subcommand;
};

const optionNames = (o: Fig.Option): string[] => (Array.isArray(o.name) ? o.name : [o.name]);

/**
 * Replace the `args` of an option, in place.
 *
 * Throws when the option is absent: a silent no-op here would look exactly like
 * "the generator didn't fire", which is miserable to debug. If an upstream spec
 * renames a flag, we want the build to say so.
 */
export const patchOptionArg = (spec: Fig.Subcommand, optionName: string, args: Fig.Arg): Fig.Subcommand => {
  const option = (spec.options ?? []).find((o) => optionNames(o).includes(optionName));
  if (!option) {
    throw new Error(`termauto: option '${optionName}' not found in spec '${String(spec.name)}' — did upstream rename it?`);
  }
  option.args = args;
  return spec;
};

/** Apply several option patches at once. */
export const patchOptionArgs = (spec: Fig.Subcommand, patches: Record<string, Fig.Arg>): Fig.Subcommand => {
  for (const [name, args] of Object.entries(patches)) patchOptionArg(spec, name, args);
  return spec;
};
