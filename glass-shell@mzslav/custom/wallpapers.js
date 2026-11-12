// Glass Shell — light/dark wallpaper pairs from the extension's wallpapers/ folder.
//
// Put two pictures in wallpapers/ named NAME-light.EXT and NAME-dark.EXT
// (jpg, jpeg, png, webp, jxl). Pick NAME in the preferences (setting
// "wallpaper"); GNOME then shows the light one in Light style and the dark one
// in Dark style. A single NAME.EXT is used for both. An empty setting leaves
// the wallpaper alone.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PICTURE = /^(.+?)(?:-(light|dark))?\.(jpe?g|png|webp|jxl)$/i;

/** Map of NAME → {light, dark} file paths found in `dirPath`. Shared with prefs. */
export function findWallpapers(dirPath) {
  const pairs = new Map();
  const dir = Gio.File.new_for_path(dirPath);
  let enumerator;
  try {
    enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
  } catch (e) {
    return pairs;
  }
  for (let info; (info = enumerator.next_file(null));) {
    if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
    const m = PICTURE.exec(info.get_name());
    if (!m) continue;
    const [, name, variant] = m;
    const path = dir.get_child(info.get_name()).get_path();
    const entry = pairs.get(name) ?? {};
    if (variant) entry[variant.toLowerCase()] = path;
    else entry.both = path;
    pairs.set(name, entry);
  }
  enumerator.close(null);
  for (const [name, e] of pairs) {
    const light = e.light ?? e.both ?? e.dark;
    const dark = e.dark ?? e.both ?? e.light;
    pairs.set(name, {light, dark});
  }
  return pairs;
}

export class Wallpapers {
  constructor(path, settings) {
    this._dir = `${path}/wallpapers`;
    this._settings = settings;
    this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    this._ids = [];
    this._monitor = null;
  }

  setup() {
    this._ids.push(this._settings.connect('changed::wallpaper', () => this._apply(true)));
    try {
      this._monitor = Gio.File.new_for_path(this._dir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
      this._monitor.connect('changed', (_m, _f, _o, event) => {
        if (event !== Gio.FileMonitorEvent.CHANGES_DONE_HINT && event !== Gio.FileMonitorEvent.DELETED) return;
        if (this._debounce) GLib.Source.remove(this._debounce);
        this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
          this._debounce = 0;
          this._apply(false);
          return GLib.SOURCE_REMOVE;
        });
      });
    } catch (e) {
      this._monitor = null;
    }
    // At login / unlock: only if the wallpaper is still the one we set, so a
    // picture chosen in Settings → Appearance is not overwritten.
    this._apply(false);
  }

  _ours() {
    const last = this._settings.get_string('wallpaper-applied');
    return last === '' || last === `${this._background.get_string('picture-uri')}|${this._background.get_string('picture-uri-dark')}`;
  }

  _apply(force) {
    if (!force && !this._ours()) return;
    const name = this._settings.get_string('wallpaper');
    if (!name) return;
    const pair = findWallpapers(this._dir).get(name);
    if (!pair) return;
    const light = Gio.File.new_for_path(pair.light).get_uri();
    const dark = Gio.File.new_for_path(pair.dark).get_uri();
    if (this._background.get_string('picture-uri') !== light)
      this._background.set_string('picture-uri', light);
    if (this._background.get_string('picture-uri-dark') !== dark)
      this._background.set_string('picture-uri-dark', dark);
    this._settings.set_string('wallpaper-applied', `${light}|${dark}`);
  }

  cleanup() {
    for (const id of this._ids) this._settings.disconnect(id);
    this._ids = [];
    if (this._debounce) GLib.Source.remove(this._debounce);
    this._debounce = 0;
    this._monitor?.cancel();
    this._monitor = null;
  }
}
