#!/bin/bash
# Glass Shell — screenshots from a throwaway headless GNOME Shell.
#
#   tools/preview.sh OUT_DIR [state ...]
#
# States: desktop quick-settings calendar notify overview apps files
# (default: all). PREVIEW_SCHEME=light|dark forces the style.
# PREVIEW_WALLPAPER=NAME uses /usr/share/backgrounds/gnome/NAME-{l,d}.jxl.
# Runs with its own dconf, runtime dir and session bus, so the
# real session is not touched; copies your wallpaper, appearance and pinned
# apps into it and enables only Glass Shell (with dev-tools on).
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
UUID="glass-shell@mzslav"
OUT="$(mkdir -p "${1:?out dir}" && cd "$1" && pwd)"; shift
STATES=("$@"); [ ${#STATES[@]} -eq 0 ] && STATES=(desktop quick-settings calendar notify overview apps files)
SIZE="${PREVIEW_SIZE:-1920x1080}"

T="$(mktemp -d "${TMPDIR:-/tmp}/glass-preview.XXXXXX")"
# The Wayland socket path must stay under 108 bytes, so the runtime dir is short.
RT="$(mktemp -d "/run/user/$(id -u)/gp.XXXXXX")"
mkdir -p "$T/config" "$T/data/gnome-shell/extensions" "$T/cache"
chmod 700 "$RT"
ln -s "$HERE/$UUID" "$T/data/gnome-shell/extensions/$UUID"
ln -s "$HERE/tools/shot-helper@glass-shell" "$T/data/gnome-shell/extensions/shot-helper@glass-shell"
dconf dump /org/gnome/desktop/ > "$T/desktop.dconf"
gsettings get org.gnome.shell favorite-apps > "$T/favorites"

DATA_DIRS="$HOME/.local/share:$HOME/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share"

env -i HOME="$HOME" PATH=/usr/bin:/bin LANG="${LANG:-C.UTF-8}" \
  XDG_CONFIG_HOME="$T/config" XDG_DATA_HOME="$T/data" XDG_DATA_DIRS="$DATA_DIRS" \
  XDG_CACHE_HOME="$T/cache" XDG_RUNTIME_DIR="$RT" \
  OUT="$OUT" HERE="$HERE" T="$T" UUID="$UUID" SIZE="$SIZE" SIZE2="${PREVIEW_SIZE2:-}" STATES="${STATES[*]}" SCHEME="${PREVIEW_SCHEME:-}" PERF="${PREVIEW_PERF:-}" WALL="${PREVIEW_WALLPAPER:-}" \
  dbus-run-session -- bash -c '
    wait_s() { python3 -I -c "import time,sys; time.sleep(float(sys.argv[1]))" "$1"; }
    dconf load /org/gnome/desktop/ < "$T/desktop.dconf"
    gsettings set org.gnome.shell favorite-apps "$(cat "$T/favorites")"
    if [ -n "$WALL" ]; then
      gsettings set org.gnome.desktop.background picture-uri "file:///usr/share/backgrounds/gnome/$WALL-l.jxl"
      gsettings set org.gnome.desktop.background picture-uri-dark "file:///usr/share/backgrounds/gnome/$WALL-d.jxl"
    fi
    case "$SCHEME" in
      light) gsettings set org.gnome.desktop.interface color-scheme default ;;
      dark) gsettings set org.gnome.desktop.interface color-scheme prefer-dark ;;
    esac
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\", \"shot-helper@glass-shell\"]"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
    dconf write /org/gnome/shell/extensions/glass-shell/dev-tools true
    [ -n "$PERF" ] && dconf write /org/gnome/shell/extensions/glass-shell/performance-mode "\"$PERF\""
    gnome-shell --headless --wayland --no-x11 --virtual-monitor "$SIZE" ${SIZE2:+--virtual-monitor "$SIZE2"} > "$OUT/shell.log" 2>&1 &
    shell=$!
    dev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/GlassShellDev \
              --method org.gnome.Shell.Extensions.GlassShellDev.$1 "$2" >/dev/null; }
    for i in $(seq 1 40); do dev Show close 2>/dev/null && break; wait_s 0.5; done
    wait_s 3
    for s in $STATES; do
      case $s in
        desktop) dev Show close ;;
        files) dev Show close
               WAYLAND_DISPLAY=wayland-0 GDK_BACKEND=wayland nautilus --new-window "$HOME" >/dev/null 2>&1 &
               wait_s 5 ;;
        launch:*) WAYLAND_DISPLAY=wayland-0 GDK_BACKEND=wayland "${s#launch:}" >/dev/null 2>&1 &
                  wait_s 4; echo "launched ${s#launch:}"; continue ;;
        lock) # The extension is off on the lock screen, so the dev-tools screenshot
              # is gone too: tools/shot-helper@glass-shell stays on there.
              gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/GlassShellShot \
                --method org.gnome.Shell.Extensions.GlassShellShot.Lock >/dev/null
              wait_s 4
              gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/GlassShellShot \
                --method org.gnome.Shell.Extensions.GlassShellShot.Screenshot "$OUT/lock.png" >/dev/null \
                && echo "shot lock" || echo "FAILED lock"
              gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/GlassShellShot \
                --method org.gnome.Shell.Extensions.GlassShellShot.LockState > "$OUT/lock.json"
              continue ;;
        unlock) gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/GlassShellShot \
                  --method org.gnome.Shell.Extensions.GlassShellShot.Unlock >/dev/null
                wait_s 3; echo "unlocked"; continue ;;
        inspect:*) gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/GlassShellDev \
                     --method org.gnome.Shell.Extensions.GlassShellDev.Inspect "${s#inspect:}" > "$OUT/${s//[:\/]/_}.json"
                   echo "inspected ${s#inspect:}"; continue ;;
        *) dev Show "$s" ;;
      esac
      wait_s 1.5
      dev Screenshot "$OUT/$s.png" && echo "shot $s" || echo "FAILED $s"
    done
    kill $(jobs -p) 2>/dev/null; wait 2>/dev/null
  '
grep -E "JS ERROR|JS WARNING|Glass Shell|glass-shell@" "$OUT/shell.log" | grep -v "^\s*#" | head -30
rm -rf "$T" "$RT"
