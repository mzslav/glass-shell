// Glass Shell — the shell theme.
//
// Builds Glass Shell's own GNOME Shell theme and installs it as the shell's
// stylesheet, so no part of another theme is left anywhere:
//
//   GNOME's own theme for the current Light / Dark style
//   + styles/macos.css           (glass-friendly controls, when enable-macos-styles)
//   + styles/theme-overrides.css (transparent surfaces, Glass Shell's own rules)
//   + styles/macos-light.css     (Light style only, last so it wins)
//
// and scales the whole thing by "ui-scale": every pixel size is multiplied and
// rounded to whole pixels (fractional sizes are what made text look blurry),
// fonts follow the scale in half-point steps, and paddings / margins / gaps
// shrink faster than text so small sizes really are compact.
//
// The result is written to ~/.cache/glass-shell/ and rebuilt when the scale,
// the style or any of those files change. Edit the CSS files, not the cache.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {shellIsDark} from './shellStyle.js';

// [file, enabled(settings, performance), forStyle(dark)]
const PARTS = [
  ['styles/macos.css', s => s.get_boolean('enable-macos-styles'), () => true],
  ['styles/theme-overrides.css', () => true, () => true],
  // Last, so Light style wins over the rules above.
  ['styles/macos-light.css', s => s.get_boolean('enable-macos-styles'), dark => !dark],
  // Performance mode: solid surfaces, nothing relies on glass behind it.
  ['styles/solid.css', (s, perf) => perf, () => true],
  ['styles/solid-light.css', (s, perf) => perf, dark => !dark],
];

function readText(file) {
  const [, bytes] = file.load_contents(null);
  return new TextDecoder().decode(bytes);
}

/** Scales `css` by `s`. Exported for tools/preview-theme (and tests). */
export function scaleCss(css, s, basePt) {
  if (Math.abs(s - 1) < 0.001) return css;
  // Spacing shrinks faster than text when making things smaller.
  const spacing = s < 1 ? s ** 1.6 : s;
  const round = v => (v < 0 ? -1 : 1) * Math.max(1, Math.round(Math.abs(v)));
  return css
    .split('\n')
    .map(line => {
      const isIcon = /icon-size|-slider-handle-radius|-barlevel-height|width:|height:/.test(line);
      const k = isIcon ? s : spacing;
      return line
        .replace(/(-?\d*\.?\d+)px/g, (m, n) => {
          const v = parseFloat(n);
          if (Math.abs(v) <= 2) return m;           // hairlines and 2px borders stay crisp
          return `${round(v * k)}px`;
        })
        .replace(/(\d*\.?\d+)pt/g, (m, n) => `${Math.round(parseFloat(n) * s * 2) / 2}pt`);
    })
    .join('\n')
    // The base font: GNOME uses 1em of the system font; make it a whole half point.
    .replace(/stage\s*\{\s*font-size:\s*1em;/, `stage {\n  font-size: ${Math.round(basePt * s * 2) / 2}pt;`);
}

export class ThemeBuilder {
  constructor(path, settings) {
    this._path = path;
    this._settings = settings;
    this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'glass-shell']);
    this._ids = [];
    this._monitors = [];
    this._queued = 0;
    this._current = null;
    this._performance = false;
  }

  /** Performance mode on / off: rebuild with or without solid surfaces. */
  setPerformance(on) {
    if (on === this._performance) return;
    this._performance = on;
    this._apply();
  }

  setup() {
    for (const key of ['ui-scale', 'enable-macos-styles', 'own-theme', 'shell-style'])
      this._ids.push([this._settings, this._settings.connect(`changed::${key}`, () => this._queue())]);
    this._ids.push([this._interface, this._interface.connect('changed::font-name', () => this._queue())]);
    // The shell reloads its theme on these itself; rebuilding at once (no
    // timeout) keeps both reloads in the same frame instead of showing the
    // old style for a moment.
    const st = St.Settings.get();
    for (const prop of ['color-scheme', 'high-contrast'])
      this._ids.push([st, st.connect(`notify::${prop}`, () => this._apply())]);
    // Rebuild when one of the CSS files is edited.
    for (const [file] of PARTS) {
      try {
        const monitor = Gio.File.new_for_path(`${this._path}/${file}`).monitor_file(Gio.FileMonitorFlags.NONE, null);
        monitor.connect('changed', (_m, _f, _o, event) => {
          if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT) this._queue();
        });
        this._monitors.push(monitor);
      } catch (e) {
        // no monitor, no live reload
      }
    }
    this._apply();
  }

  get _dark() {
    return shellIsDark(this._settings);
  }

  _basePt() {
    const m = /(\d+(?:\.\d+)?)(?:\s*@.*)?$/.exec(this._interface.get_string('font-name'));
    return m ? parseFloat(m[1]) : 11;
  }

  _queue() {
    if (this._queued) return;
    this._queued = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
      this._queued = 0;
      this._apply();
      return GLib.SOURCE_REMOVE;
    });
  }

  _build() {
    const dark = this._dark;
    const variant = dark ? 'dark' : 'light';
    const base = readText(Gio.File.new_for_uri(`resource:///org/gnome/shell/theme/gnome-shell-${variant}.css`));
    const parts = [base];
    for (const [file, enabled, forStyle] of PARTS) {
      const f = Gio.File.new_for_path(`${this._path}/${file}`);
      if (enabled(this._settings, this._performance) && forStyle(dark) && f.query_exists(null))
        parts.push(`\n/* ===== ${file} ===== */\n${readText(f)}`);
    }
    const scale = this._settings.get_double('ui-scale');
    const css = `/* Glass Shell theme — generated, edit the files in styles/ instead */\n` +
      scaleCss(parts.join('\n'), scale, this._basePt());
    GLib.mkdir_with_parents(this._cacheDir, 0o755);
    // A new name per build: St caches stylesheets by file.
    const name = `theme-${variant}-${Date.now()}.css`;
    const out = Gio.File.new_for_path(GLib.build_filenamev([this._cacheDir, name]));
    out.replace_contents(new TextEncoder().encode(css), null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    return out.get_path();
  }

  _cleanCache(keep) {
    try {
      const dir = Gio.File.new_for_path(this._cacheDir);
      const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
      for (let info; (info = en.next_file(null));) {
        const n = info.get_name();
        if (n.startsWith('theme-') && dir.get_child(n).get_path() !== keep)
          dir.get_child(n).delete(null);
      }
    } catch (e) {
      // best effort
    }
  }

  _apply() {
    if (this._queued) GLib.Source.remove(this._queued);
    this._queued = 0;
    // High Contrast uses GNOME's own high-contrast theme untouched.
    if (!this._settings.get_boolean('own-theme') || St.Settings.get().high_contrast) {
      if (this._current) {
        Main.setThemeStylesheet(null);
        Main.loadTheme();
        this._current = null;
      }
      return;
    }
    let path;
    try {
      path = this._build();
    } catch (e) {
      console.error(`[Glass Shell] theme build failed: ${e}`);
      return;
    }
    Main.setThemeStylesheet(path);
    Main.loadTheme();
    this._current = path;
    this._cleanCache(path);
  }

  cleanup() {
    if (this._queued) GLib.Source.remove(this._queued);
    this._queued = 0;
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
    for (const m of this._monitors) m.cancel();
    this._monitors = [];
    if (this._current) {
      Main.setThemeStylesheet(null);
      Main.loadTheme();
      this._current = null;
    }
  }
}
