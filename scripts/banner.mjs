import { fileURLToPath } from "node:url";

// Shown in front of every owlterm subcommand run by hand, and in the
// "update available" notice. See bin/owlterm for where it's printed.
export const BANNER = [
  "  ____          _ _______",
  " / __ \\        | |__   __|",
  "| |  | |_      _| | | | ___ _ __ _ __ ___",
  "| |  | \\ \\ /\\ / / | | |/ _ \\ '__| '_ ` _ \\",
  "| |__| |\\ V  V /| | | |  __/ |  | | | | | |",
  " \\____/  \\_/\\_/ |_| |_|\\___|_|  |_| |_| |_|",
].join("\n");

// Run directly, it prints itself; the launcher does this in front of subcommands.
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`${BANNER}\n`);
