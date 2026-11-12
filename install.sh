#!/bin/bash
# Glass Shell — install for the current user.
#
# Links the extension folder into GNOME's extension directory, so every edit
# you make in this repository is what the shell loads (after a re-login on
# Wayland). Run again after changing the settings schema.
set -euo pipefail

UUID="glass-shell@mzslav"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

glib-compile-schemas --strict "$SRC/schemas"

mkdir -p "$(dirname "$DEST")"
if [ -L "$DEST" ]; then
  rm "$DEST"
elif [ -e "$DEST" ]; then
  echo "$DEST exists and is not a link; move it away first." >&2
  exit 1
fi
ln -s "$SRC" "$DEST"

# Add to the enabled list (works before the shell has seen the extension).
current="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$current" != *"'$UUID'"* ]]; then
  if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
    gsettings set org.gnome.shell enabled-extensions "['$UUID']"
  else
    gsettings set org.gnome.shell enabled-extensions "${current%]}, '$UUID']"
  fi
fi

echo "Installed $UUID -> $SRC"
echo "Log out and back in to load it (Wayland cannot reload extensions live)."
