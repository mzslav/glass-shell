#!/bin/bash
# Glass Shell — remove the link and turn the extension off.
# Settings stay in dconf; add --reset to clear them too.
set -euo pipefail

UUID="glass-shell@mzslav"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

gnome-extensions disable "$UUID" 2>/dev/null || true
current="$(gsettings get org.gnome.shell enabled-extensions)"
gsettings set org.gnome.shell enabled-extensions \
  "$(python3 -I -c "import ast,sys; l=ast.literal_eval(sys.argv[1].replace('@as ','')); print([x for x in l if x!=sys.argv[2]])" "$current" "$UUID")"

[ -L "$DEST" ] && rm "$DEST"
[ "${1:-}" = "--reset" ] && dconf reset -f /org/gnome/shell/extensions/glass-shell/

echo "Removed $UUID. Log out and back in."
