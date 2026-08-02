#!/usr/bin/env bash
# Prints each icon set raw, so you can see which ones this terminal can draw.
# Run it in the terminal that looks wrong — this is about the font, not the code.
printf '\n  terminal : %s\n' "${TERM_PROGRAM:-unknown}"
printf '  codicon  : \Uea7b \Uea83 \Uea8c \Ueb65 \Uea92 \Ueb15 \Uea86 \Ueb59 \Uea71\n'
printf '  unicode  : ▪ ▸ ◆ · ◇ § ↯ ★ ○\n'
printf '  emoji    : 📄 📁 📦 🔗 💲 🏝️ 🔥 ⭐ 📀\n'
printf '\n  Blank or boxes on the codicon row => this terminal is not using a Nerd Font.\n'
printf '  Fix its font, or set theme.icons = "unicode" in ~/.config/inshellisense/rc.toml\n\n'
