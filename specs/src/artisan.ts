// Custom spec: artisan (Laravel). No upstream Fig spec exists for it — `laravel`
// (the installer), `php` and `composer` are all bundled, but the CLI you actually
// live in all day is not.
//
// Fully dynamic on purpose. A Laravel app's command list is not knowable
// statically: every package adds its own (`queue:*` from Horizon, `nova:*`,
// `livewire:*`), and apps define their own under App\Console\Commands. Hardcoding
// the framework's ~100 built-ins would be wrong for every real project. So the
// list comes from `artisan list --format=json`, which is exactly what the app
// itself reports.
import { artisanCommands, artisanCommandOptions } from "./lib/generators.js";

const spec: Fig.Spec = {
  name: "artisan",
  description: "Laravel's command-line interface",
  args: [
    {
      name: "command",
      description: "Artisan command to run",
      isOptional: true,
      generators: artisanCommands,
      // The list shells out to php, so don't re-run it on every keystroke of a
      // half-typed command name.
      debounce: true,
    },
    {
      name: "arguments",
      description: "Arguments and options for the command",
      isOptional: true,
      isVariadic: true,
      // Options for whichever command was chosen — --seed for migrate, --queue
      // for queue:work, and so on, straight from the app's own definitions.
      generators: artisanCommandOptions,
      debounce: true,
    },
  ],
  options: [
    { name: ["-h", "--help"], description: "Display help for the given command" },
    { name: ["-q", "--quiet"], description: "Do not output any message" },
    { name: ["-V", "--version"], description: "Display this application version" },
    { name: "--ansi", description: "Force ANSI output" },
    { name: "--no-ansi", description: "Disable ANSI output" },
    { name: ["-n", "--no-interaction"], description: "Do not ask any interactive question" },
    {
      name: "--env",
      description: "The environment the command should run under",
      args: { name: "env", suggestions: ["local", "testing", "staging", "production"] },
    },
    {
      name: ["-v", "-vv", "-vvv", "--verbose"],
      description: "Increase verbosity: 1 for normal, 2 for more verbose, 3 for debug",
    },
  ],
};

export default spec;
