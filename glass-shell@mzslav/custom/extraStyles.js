// Glass Shell — extra stylesheets that are not part of the glass engine.
//
// Each entry maps a boolean setting to a CSS file under styles/. While the
// setting is on, the file is loaded into the shell theme on top of everything
// else; turning it off unloads it again. Add your own entries here.
//
// This folder (custom/) is never touched by `npm run build`, which only
// regenerates dist/ from src/.

import Gio from 'gi://Gio';
import St from 'gi://St';

const STYLESHEETS = [
  ['enable-own-dock', 'styles/dock.css'],
];

export class ExtraStyles {
  constructor(dirPath, settings) {
    this._settings = settings;
    this._entries = STYLESHEETS.map(([key, file]) => ({
      key,
      file: Gio.File.new_for_path(`${dirPath}/${file}`),
      loaded: false,
      theme: null,
    }));
    this._signals = [];
    this._themeSignal = 0;
  }

  setup() {
    for (const entry of this._entries) {
      this._signals.push(this._settings.connect(`changed::${entry.key}`, () => this._sync(entry)));
      this._sync(entry);
    }
    // A theme change (user theme, accent, light/dark) builds a new St.Theme,
    // which drops stylesheets loaded into the old one.
    const context = St.ThemeContext.get_for_stage(global.stage);
    this._themeSignal = context.connect('changed', () => {
      if (this._busy) return;
      const theme = this._theme();
      // Main.loadTheme() copies loaded stylesheets into the new theme.
      const carried = new Set((theme?.get_custom_stylesheets() ?? []).map(f => f.get_path()));
      for (const entry of this._entries) {
        if (entry.theme !== theme) {
          entry.loaded = carried.has(entry.file.get_path());
          entry.theme = entry.loaded ? theme : null;
        }
        this._sync(entry);
      }
    });
  }

  _theme() {
    return St.ThemeContext.get_for_stage(global.stage).get_theme();
  }

  _sync(entry) {
    const want = this._settings.get_boolean(entry.key);
    const theme = this._theme();
    if (!theme) return;
    if (want && !entry.loaded) {
      if (!entry.file.query_exists(null)) {
        console.warn(`[Glass Shell] missing stylesheet ${entry.file.get_path()}`);
        return;
      }
      entry.loaded = true;
      entry.theme = theme;
      this._busy = true;
      try {
        theme.load_stylesheet(entry.file);
      } finally {
        this._busy = false;
      }
    } else if (!want && entry.loaded) {
      const old = entry.theme;
      entry.loaded = false;
      entry.theme = null;
      this._busy = true;
      try {
        old?.unload_stylesheet(entry.file);
      } finally {
        this._busy = false;
      }
    }
  }

  cleanup() {
    for (const id of this._signals) this._settings.disconnect(id);
    this._signals = [];
    if (this._themeSignal) {
      St.ThemeContext.get_for_stage(global.stage).disconnect(this._themeSignal);
      this._themeSignal = 0;
    }
    for (const entry of this._entries) {
      if (entry.loaded && entry.theme === this._theme()) entry.theme.unload_stylesheet(entry.file);
      entry.loaded = false;
      entry.theme = null;
    }
  }
}
