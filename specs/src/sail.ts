// Custom spec: sail (Laravel Sail). Absent from Fig's corpus, like artisan.
//
// Sail is a Docker wrapper whose most-used path is `sail artisan …`, so the
// artisan spec is mounted as a subcommand rather than restated — one definition,
// one set of generators, no drift.
import { artisanCommands, artisanCommandOptions } from "./lib/generators.js";
import artisanSpec from "./artisan.js";

const artisanSubcommand: Fig.Subcommand = {
  ...(artisanSpec as Fig.Subcommand),
  name: "artisan",
  description: "Run an Artisan command inside the container",
};

const spec: Fig.Spec = {
  name: "sail",
  description: "Laravel Sail — Docker development environment",
  subcommands: [
    artisanSubcommand,
    { name: "up", description: "Start the containers", options: [{ name: ["-d", "--detach"], description: "Run in the background" }] },
    { name: "down", description: "Stop and remove the containers" },
    { name: "restart", description: "Restart the containers" },
    { name: "build", description: "Build the container images", options: [{ name: "--no-cache", description: "Build without using cache" }] },
    { name: "ps", description: "Show container status" },
    { name: "logs", description: "Tail container logs", options: [{ name: ["-f", "--follow"], description: "Follow log output" }] },
    { name: "shell", description: "Open a shell in the application container" },
    { name: "bash", description: "Open a bash shell in the application container" },
    { name: "root-shell", description: "Open a root shell in the application container" },
    { name: "tinker", description: "Start Tinker inside the container" },
    { name: "test", description: "Run the tests", args: { name: "filter", isOptional: true } },
    { name: "pest", description: "Run the Pest tests" },
    { name: "dusk", description: "Run the Dusk browser tests" },
    { name: "php", description: "Run a php command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "composer", description: "Run a composer command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "node", description: "Run a node command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "npm", description: "Run an npm command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "npx", description: "Run an npx command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "yarn", description: "Run a yarn command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "bun", description: "Run a bun command inside the container", args: { name: "args", isVariadic: true, isOptional: true } },
    { name: "mysql", description: "Open a MySQL shell" },
    { name: "psql", description: "Open a PostgreSQL shell" },
    { name: "redis", description: "Open a Redis shell" },
    { name: "share", description: "Share the site via a public URL" },
    { name: "open", description: "Open the site in a browser" },
  ],
  // Bare `sail <command>` also forwards straight to artisan, so keep the dynamic
  // list reachable without typing `artisan` first.
  args: {
    name: "command",
    isOptional: true,
    generators: [artisanCommands, artisanCommandOptions],
    debounce: true,
  },
};

export default spec;
