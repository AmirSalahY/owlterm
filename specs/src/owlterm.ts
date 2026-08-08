// Custom spec: owlterm itself.
//
// Neither Fig nor upstream ships a spec for this CLI under any name — `is` and
// `inshellisense` are both absent from the corpus — so completing our own tool
// was the one thing the tool couldn't do.
//
// Kept in lockstep with vendor/inshellisense/src/index.ts and src/commands/*.
// `npm run refresh` diffs specs against real `--help` output and will flag this
// file when the two drift.

/** Shells that can host a session, from `supportedShells` in commands/root.ts. */
const sessionShells = [
  { name: "bash", description: "Bourne Again SHell" },
  { name: "zsh", description: "Z shell" },
  { name: "fish", description: "Friendly Interactive SHell" },
  { name: "pwsh", description: "PowerShell Core" },
  { name: "xonsh", description: "Python-powered shell" },
  { name: "nu", description: "Nushell" },
];

/**
 * `specs list --shell` is narrower than the session list: alias expansion is
 * only implemented for bash and zsh (see aliasSupportedShells in utils/shell.ts).
 */
const aliasShells = sessionShells.filter((s) => s.name === "bash" || s.name === "zsh");

const helpOption: Fig.Option = { name: ["-h", "--help"], description: "Display help for command" };

const spec: Fig.Spec = {
  name: "owlterm",
  description: "IDE style command line auto complete",
  subcommands: [
    {
      name: "init",
      description: "Generate a shell plugin and print the command that sources it",
      args: {
        name: "shell",
        description: "Shell to generate the plugin for",
        suggestions: sessionShells,
      },
      options: [helpOption],
    },
    {
      name: "reinit",
      description: "Regenerate the shell plugins under ~/.inshellisense/init",
      options: [helpOption],
    },
    {
      name: "doctor",
      description: "Check the health of this installation, including the icon style",
      options: [helpOption],
    },
    {
      name: "specs",
      description: "Manage completion specs",
      subcommands: [
        {
          name: "list",
          description: "List the names of all available specs",
          options: [
            {
              name: ["-s", "--shell"],
              description: "Shell whose aliases should also be listed",
              args: { name: "shell", suggestions: aliasShells },
            },
            helpOption,
          ],
        },
      ],
      options: [helpOption],
    },
    {
      name: "alias",
      description: "Manage parameterized command aliases",
      subcommands: [
        {
          name: "set",
          description: "Save a parameterized alias from a command or recent command",
          args: [
            { name: "name", description: "Alias command name" },
            {
              name: "command",
              description: "Command tokens; use -- before commands with flags",
              isCommand: true,
              isOptional: true,
              isVariadic: true,
            },
          ],
          options: [
            {
              name: ["-p", "--param"],
              description: "Mark a token number as a parameter, e.g. 3=first-url",
              args: { name: "token=name" },
              isRepeatable: true,
            },
            helpOption,
          ],
        },
        {
          name: "run",
          description: "Run a managed alias, prompting for missing parameter values",
          args: [
            { name: "name", description: "Alias command name" },
            { name: "values", description: "Parameter values", isOptional: true, isVariadic: true },
          ],
          options: [{ name: "--print", description: "Print the expanded command instead of running it" }, helpOption],
        },
        { name: "list", description: "List managed aliases", options: [helpOption] },
        { name: ["remove", "rm"], description: "Remove a managed alias", args: { name: "name" }, options: [helpOption] },
        {
          name: "init",
          description: "Print bash/zsh functions for all managed aliases",
          args: { name: "shell", suggestions: aliasShells, isOptional: true },
          options: [helpOption],
        },
      ],
      options: [helpOption],
    },
    {
      name: "complete",
      description: "Print the completion for a command line, as JSON",
      args: {
        name: "input",
        description: 'Command line to complete, e.g. "git ch"',
      },
      options: [helpOption],
    },
    {
      name: "update",
      description: "Update owlterm to the latest GitHub Release tag",
      options: [helpOption],
    },
    {
      name: "uninstall",
      description: "Remove all cached resources and configuration",
      options: [helpOption],
    },
  ],
  options: [
    {
      name: ["-s", "--shell"],
      description: "Shell to run the session in",
      args: { name: "shell", suggestions: sessionShells },
    },
    { name: ["-l", "--login"], description: "Start the shell as a login shell" },
    { name: ["-c", "--check"], description: "Check whether this shell is already inside a session" },
    { name: ["-V", "--verbose"], description: "Enable verbose logging" },
    { name: ["-v", "--version"], description: "Output the current version" },
    helpOption,
  ],
};

export default spec;
