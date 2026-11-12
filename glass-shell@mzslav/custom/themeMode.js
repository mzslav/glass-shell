// Glass Shell — follows the system Light / Dark switch (Quick Settings
// "Dark Style", Settings → Appearance).
//
// GNOME's own shell theme already switches between light and dark; this
// matches the rest: the glass tint of menus, Quick Settings, notifications
// and OSDs. (Light-style CSS is part of the theme: custom/themeBuilder.js.)
//
// Setting "follow-color-scheme" turns this off (tints then stay as set).
// The colours are the *_TINT constants below.

import Gio from 'gi://Gio';

import {shellIsDark} from './shellStyle.js';

const DARK_TINT = '#1c1c20';
const LIGHT_TINT = '#f4f4f6';
const SURFACES = ['quick-settings', 'menu', 'panel-menu', 'notification', 'osd'];

export class ThemeMode {
  constructor(path, settings) {
    this._settings = settings;
    this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    this._ids = [];
    // A separate handle for batched writes: delay() keeps a Settings object
    // in delay-apply mode for good, which must not happen to the shared one.
    this._writer = new Gio.Settings({settings_schema: settings.settings_schema});
    this._writer.delay();
  }

  get isDark() {
    return shellIsDark(this._settings);
  }

  setup() {
    this._ids.push([this._interface, this._interface.connect('changed::color-scheme', () => this._apply())]);
    for (const key of ['follow-color-scheme', 'shell-style'])
      this._ids.push([this._settings, this._settings.connect(`changed::${key}`, () => this._apply())]);
    this._apply();
  }

  _apply() {
    if (this._settings.get_boolean('follow-color-scheme')) {
      const tint = this.isDark ? DARK_TINT : LIGHT_TINT;
      // One batch, so the glass changes once instead of surface by surface.
      for (const surface of SURFACES) {
        const key = `${surface}-tint-color`;
        if (this._settings.get_string(key) !== tint) this._writer.set_string(key, tint);
      }
      this._writer.apply();
    }
  }

  cleanup() {
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
  }
}
