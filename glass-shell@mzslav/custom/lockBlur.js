// Glass Shell — the blurred wallpaper of the lock screen, on every monitor.
//
// GNOME's lock screen blurs a Meta.BackgroundActor per monitor
// (Shell.BlurEffect, BlurMode.ACTOR). With two monitors that draws nothing on
// one of them, so it stays black — the same fault overviewBlur.js works
// around. This puts the same kind of widget overviewBlur.js uses (the
// wallpaper as a background image, blurred once and cached) on top of each of
// GNOME's lock screen backgrounds, with GNOME's own blur and dimming.
//
// Runs only while the screen is locked (extension.js), when nothing else of
// Glass Shell is running.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {wallpaperStyle} from './overviewBlur.js';

// GNOME's values (ui/unlockDialog.js).
const BLUR_BRIGHTNESS = 0.65;
const BLUR_SIGMA = 45;
// The unlock dialog is made right after the session mode switches.
const FIND_DIALOG_TRIES = 20;
const FIND_DIALOG_INTERVAL_MS = 100;

export class LockBlur {
  constructor() {
    this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    this._widgets = [];
    this._ids = [];
    this._timerId = 0;
    this._idleId = 0;
    this._group = null;
    this._groupId = 0;
  }

  setup() {
    const on = (obj, sig, fn) => this._ids.push([obj, obj.connect(sig, fn)]);
    // Deferred, so GNOME has redone its own backgrounds first and ours land on top.
    on(Main.layoutManager, 'monitors-changed', () => {
      if (this._idleId) GLib.source_remove(this._idleId);
      this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        this._idleId = 0;
        this._rebuild();
        return GLib.SOURCE_REMOVE;
      });
    });
    for (const key of ['picture-uri', 'picture-uri-dark', 'primary-color'])
      on(this._background, `changed::${key}`, () => this._restyle());
    on(St.Settings.get(), 'notify::color-scheme', () => this._restyle());
    this._findDialog(FIND_DIALOG_TRIES);
  }

  _findDialog(tries) {
    if (this._attach()) return;
    if (tries <= 0) {
      console.warn('[Glass Shell] lock screen: no unlock dialog backgrounds found');
      return;
    }
    this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FIND_DIALOG_INTERVAL_MS, () => {
      this._timerId = 0;
      this._findDialog(tries - 1);
      return GLib.SOURCE_REMOVE;
    });
  }

  _attach() {
    const group = Main.screenShield?._dialog?._backgroundGroup;
    if (!group) return false;
    this._group = group;
    this._groupId = group.connect('destroy', () => {
      this._group = null;
      this._groupId = 0;
      this._widgets = [];
    });
    this._rebuild();
    return true;
  }

  _rebuild() {
    this._destroyWidgets();
    if (!this._group) return;
    for (const monitor of Main.layoutManager.monitors) {
      const widget = new St.Widget({name: 'glassShellLockBlur'});
      widget.set_position(monitor.x, monitor.y);
      widget.set_size(monitor.width, monitor.height);
      widget.add_effect_with_name('glass-shell-blur', new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR}));
      this._group.add_child(widget);
      this._widgets.push(widget);
    }
    this._restyle();
  }

  _restyle() {
    const style = wallpaperStyle(this._background);
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    for (const widget of this._widgets) {
      widget.set_style(style);
      const effect = widget.get_effect('glass-shell-blur');
      effect.radius = BLUR_SIGMA * 2 * scale;
      effect.brightness = BLUR_BRIGHTNESS;
    }
  }

  _destroyWidgets() {
    for (const widget of this._widgets) widget.destroy();
    this._widgets = [];
  }

  cleanup() {
    if (this._timerId) GLib.source_remove(this._timerId);
    if (this._idleId) GLib.source_remove(this._idleId);
    this._timerId = this._idleId = 0;
    if (this._groupId) this._group.disconnect(this._groupId);
    this._groupId = 0;
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
    this._destroyWidgets();
    this._group = null;
  }
}
