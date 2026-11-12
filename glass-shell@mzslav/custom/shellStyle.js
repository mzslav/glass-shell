// Glass Shell — is the shell (top bar, menus, Quick Settings, dock, overview)
// drawn in its dark style right now? Setting "shell-style":
//   dark    always, also when apps are Light (GNOME's own default) — white text and icons
//   follow  follows the system Light / Dark style
// Apps and the wallpaper pair always follow the system style.

import St from 'gi://St';

export function shellIsDark(settings) {
  return settings.get_string('shell-style') === 'dark' ||
    St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
}
