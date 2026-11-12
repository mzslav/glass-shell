// Glass Shell — blurred wallpaper behind the overview and the app grid,
// like Blur my Shell's overview blur.
//
// GNOME paints the overview over a plain grey. This puts one plain St.Widget
// per monitor at the bottom of the overview group, with the current wallpaper
// (light or dark one, by the system style) as its background image, and blurs
// that widget (BlurMode.ACTOR). The blur is computed once and cached, so it
// costs nothing per frame and is not affected by partial redraws:
//
//  - BlurMode.BACKGROUND (blur what is behind) re-blurred every frame and,
//    when only part of the screen was redrawn (hovering a window), blurred an
//    incomplete picture: flickering "shadows" that a screenshot never shows.
//  - BlurMode.ACTOR on GNOME's own Meta.BackgroundActor drew nothing on the
//    primary monitor with two monitors.
//
// Settings: overview-blur, overview-blur-radius, overview-blur-brightness
// (dark style; light style keeps more of the wallpaper's brightness).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {shellIsDark} from './shellStyle.js';

/**
 * CSS that paints the current wallpaper (light or dark one, by the system
 * style) over a whole widget. Also used for the lock screen (lockBlur.js).
 */
export function wallpaperStyle(background) {
  const dark = St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
  const uri = background.get_string(dark ? 'picture-uri-dark' : 'picture-uri') ||
    background.get_string('picture-uri');
  let path = null;
  try {
    path = uri ? GLib.filename_from_uri(uri)[0] : null;
  } catch (e) {
    path = null;
  }
  const color = background.get_string('primary-color') || '#222226';
  return path
    ? `background-image: url("${path.replace(/"/g, '\\"')}"); background-size: cover; background-position: center; background-color: ${color};`
    : `background-color: ${color};`;
}

export class OverviewBlur {
  constructor(settings) {
    this._settings = settings;
    this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    this._ids = [];
    this._entries = [];
    this._disabled = false;
  }

  setup() {
    const on = (obj, sig, fn) => this._ids.push([obj, obj.connect(sig, fn)]);
    on(this._settings, 'changed::overview-blur', () => this._rebuild());
    for (const key of ['overview-blur-radius', 'overview-blur-brightness'])
      on(this._settings, `changed::${key}`, () => this._restyle());
    for (const key of ['picture-uri', 'picture-uri-dark', 'picture-options', 'primary-color'])
      on(this._background, `changed::${key}`, () => this._restyle());
    on(St.Settings.get(), 'notify::color-scheme', () => this._restyle());
    on(this._settings, 'changed::shell-style', () => this._restyle());
    on(Main.layoutManager, 'monitors-changed', () => this._rebuild());
    this._rebuild();
  }

  /** Performance mode turns the blur off without touching the setting. */
  setEnabled(on) {
    this._disabled = !on;
    this._rebuild();
  }

  _rebuild() {
    this._destroyEntries();
    if (this._disabled || !this._settings.get_boolean('overview-blur')) return;
    const overviewGroup = Main.layoutManager.overviewGroup;
    for (const monitor of Main.layoutManager.monitors) {
      const widget = new St.Widget({name: 'glassShellOverviewBlur'});
      widget.set_position(monitor.x, monitor.y);
      widget.set_size(monitor.width, monitor.height);
      overviewGroup.insert_child_at_index(widget, 0);
      const effect = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR});
      widget.add_effect_with_name('glass-shell-blur', effect);
      this._entries.push({widget, effect});
    }
    this._restyle();
  }

  _restyle() {
    if (!this._entries.length) return;
    const style = wallpaperStyle(this._background);
    const radius = this._settings.get_int('overview-blur-radius');
    const dimDark = this._settings.get_double('overview-blur-brightness');
    // In Light style the overview text is dark, so the picture stays brighter.
    const brightness = shellIsDark(this._settings) ? dimDark : Math.min(1, 1 - (1 - dimDark) / 3);
    for (const {widget, effect} of this._entries) {
      widget.set_style(style);
      effect.radius = radius;
      effect.brightness = brightness;
    }
  }

  _destroyEntries() {
    for (const {widget} of this._entries) widget.destroy();
    this._entries = [];
  }

  cleanup() {
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
    this._destroyEntries();
  }
}
