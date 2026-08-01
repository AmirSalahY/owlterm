// Custom spec: rtk (Rust Token Killer) — a private CLI with no upstream Fig spec.
// This is the "our own tooling" case: nothing to augment, authored from scratch.
const spec: Fig.Spec = {
  name: "rtk",
  description: "Token-optimized CLI proxy",
  subcommands: [
    {
      name: "gain",
      description: "Show token savings analytics",
      options: [
        {
          name: "--history",
          description: "Show command usage history with savings",
        },
      ],
    },
    {
      name: "discover",
      description: "Analyze Claude Code history for missed opportunities",
    },
    {
      name: "proxy",
      description: "Execute a raw command without filtering (for debugging)",
      args: {
        name: "command",
        description: "Command to run unfiltered",
        isCommand: true, // hands off to the completion spec of the wrapped command
      },
    },
  ],
  options: [
    { name: ["-h", "--help"], description: "Print help" },
    { name: ["-V", "--version"], description: "Print version" },
  ],
};

export default spec;
