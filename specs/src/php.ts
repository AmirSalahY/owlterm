// Augments the bundled `php` spec so that `php artisan <TAB>` completes.
//
// The bundled spec treats php's first argument as a script path, so `php artisan`
// resolved to a file and stopped there — no subcommand, no completions. Adding
// `artisan` as a subcommand makes the parser hand the rest of the line to the
// artisan spec, which is where anyone using Laravel actually spends their time.
//
// Augmented rather than copied: php's spec is large and tracks upstream, and this
// touches one subcommand.
import { loadBundledSpec } from "./lib/augment.js";
import artisanSpec from "./artisan.js";

const php = await loadBundledSpec("php");

// Reuse the artisan spec wholesale — same args, same generators, same options —
// so `php artisan migrate --` and `./artisan migrate --` cannot drift apart.
php.subcommands = [
  ...(php.subcommands ?? []),
  {
    ...(artisanSpec as Fig.Subcommand),
    name: "artisan",
    description: "Laravel's command-line interface",
  },
];

export default php;
