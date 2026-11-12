// Glass Shell — when the dock hides (setting "dock-autohide"):
//
//   intellihide  hides while a window of the focused app (or the app on top)
//                covers the dock's area, like Dash to Dock's default
//   autohide     hides whenever the pointer is not on it
//   off          always shown, and maximised windows stop above it
//
// Pushing the pointer against the bottom edge brings it back. The overlap
// test follows Dash to Dock's intellihide.js (GPL-2.0-or-later, the
// dash-to-dock authors), reimplemented here.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CHECK_INTERVAL_MS = 100;
const HIDE_DELAY_MS = 350;
const SHOW_DELAY_MS = 120;
const HANDLED_TYPES = [
  Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG,
  Meta.WindowType.TOOLBAR, Meta.WindowType.UTILITY, Meta.WindowType.SPLASHSCREEN,
];

export class DockIntellihide {
  /**
   * @param {object} dock
   * @param {() => {x:number,y:number,w:number,h:number}|null} dock.rect where the dock sits when shown
   * @param {(hidden:boolean) => void} dock.setHidden
   * @param {() => boolean} dock.hovered
   */
  constructor(settings, dock) {
    this._settings = settings;
    this._dock = dock;
    this._tracker = Shell.WindowTracker.get_default();
    this._ids = [];
    this._windowIds = new Map();
    this._edge = null;
    this._checkId = 0;
    this._checkAgain = false;
    this._timer = 0;
    this._overlap = false;
    this._hidden = false;
    this._revealed = false;
    this._revealTimer = 0;
  }

  get mode() {
    return this._settings.get_string('dock-autohide');
  }

  setup() {
    const on = (obj, sig, fn) => this._ids.push([obj, obj.connect(sig, fn)]);
    on(global.display, 'window-created', (_d, w) => {
      this._track(w.get_compositor_private());
      this._check();
    });
    on(global.display, 'restacked', () => this._check());
    on(this._tracker, 'notify::focus-app', () => this._check());
    on(global.workspace_manager, 'active-workspace-changed', () => this._check());
    on(Main.layoutManager, 'monitors-changed', () => {
      this._placeEdge();
      this._check();
    });
    on(Main.overview, 'showing', () => this._update());
    on(Main.overview, 'hidden', () => this._update());
    on(this._settings, 'changed::dock-autohide', () => {
      this._placeEdge();
      this._overlap = false;
      this._check();
      this._update();
    });
    for (const wa of global.get_window_actors()) this._track(wa);

    // A thin strip on the bottom edge that brings the dock back.
    this._edge = new St.Widget({name: 'glassShellDockEdge', reactive: true, track_hover: true, opacity: 0});
    Main.layoutManager.addChrome(this._edge, {affectsStruts: false, trackFullscreen: true});
    this._edge.connect('enter-event', () => this._reveal());
    this._placeEdge();

    this._check();
    this._update();
  }

  // A 2px strip under the dock's own width, there only while the dock is
  // hidden, so it never takes clicks meant for windows otherwise.
  _placeEdge() {
    const m = Main.layoutManager.primaryMonitor;
    const box = this._dock.rect();
    if (!m || !this._edge) return;
    const x = box ? box.x : m.x;
    const w = box ? box.w : m.width;
    this._edge.set_position(x, m.y + m.height - 2);
    this._edge.set_size(w, 2);
    this._edge.visible = this.mode !== 'off' && (this._hidden || this._revealed);
  }

  _hovered() {
    return this._dock.hovered() || (this._edge?.hover ?? false);
  }

  _track(wa) {
    if (!wa || this._windowIds.has(wa)) return;
    this._windowIds.set(wa, [
      wa.connect('notify::allocation', () => this._check()),
      wa.connect('destroy', () => {
        this._windowIds.delete(wa);
        this._check();
      }),
    ]);
  }

  /** Called by the dock when the pointer enters or leaves it. */
  hoverChanged() {
    this._update();
  }

  /** Called by the dock when its size or place changes. */
  layoutChanged() {
    this._placeEdge();
    this._check();
  }

  _reveal() {
    this._revealed = true;
    this._update();
  }

  // Rate-limited like Dash to Dock: at most one check per interval.
  _check() {
    if (this._checkId) {
      this._checkAgain = true;
      return;
    }
    this._doCheck();
    this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_INTERVAL_MS, () => {
      if (this._checkAgain) {
        this._checkAgain = false;
        this._doCheck();
        return GLib.SOURCE_CONTINUE;
      }
      this._checkId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  _interesting(wa) {
    const w = wa.get_meta_window?.();
    if (!w || w.minimized || !HANDLED_TYPES.includes(w.get_window_type())) return false;
    if (!w.showing_on_its_workspace()) return false;
    const ws = global.workspace_manager.get_active_workspace();
    return w.is_on_all_workspaces() || w.get_workspace() === ws;
  }

  _doCheck() {
    const box = this._dock.rect();
    if (!box || this.mode !== 'intellihide') {
      this._setOverlap(false);
      return;
    }
    const monitorIndex = Main.layoutManager.primaryIndex;
    let windows = global.get_window_actors().filter(wa => this._interesting(wa));
    const top = [...windows].reverse().find(wa => wa.get_meta_window().get_monitor() === monitorIndex);
    if (!top) {
      this._setOverlap(false);
      return;
    }
    const topApp = this._tracker.get_window_app(top.get_meta_window());
    const focusApp = this._tracker.focus_app || topApp;
    windows = windows.filter(wa => {
      const w = wa.get_meta_window();
      if (w.is_above()) return true;
      const app = this._tracker.get_window_app(w);
      return app === focusApp || app === topApp;
    });
    const overlap = windows.some(wa => {
      const r = wa.get_meta_window().get_frame_rect();
      return r.x < box.x + box.w && r.x + r.width > box.x && r.y < box.y + box.h && r.y + r.height > box.y;
    });
    this._setOverlap(overlap);
  }

  _setOverlap(overlap) {
    if (overlap === this._overlap) return;
    this._overlap = overlap;
    this._update();
  }

  // Decides shown / hidden, with a short delay so it does not flicker.
  _update() {
    const hovered = this._hovered();
    if (hovered) this._revealed = false; // the pointer now holds it open
    const mode = this.mode;
    const hide = mode !== 'off' && !Main.overview.visible && !hovered && !this._revealed &&
      (mode === 'autohide' || this._overlap);

    if (hide === this._hidden) {
      this._clearTimer();
    } else {
      this._clearTimer();
      this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hide ? HIDE_DELAY_MS : SHOW_DELAY_MS, () => {
        this._timer = 0;
        this._hidden = hide;
        this._dock.setHidden(hide);
        this._placeEdge();
        return GLib.SOURCE_REMOVE;
      });
    }

    this._placeEdge();

    // Shown from the bottom edge: if the pointer never reaches the dock,
    // let it hide again.
    if (this._revealTimer) GLib.Source.remove(this._revealTimer);
    this._revealTimer = 0;
    if (this._revealed && !hovered) {
      this._revealTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        this._revealTimer = 0;
        this._revealed = false;
        this._update();
        return GLib.SOURCE_REMOVE;
      });
    }
  }

  _clearTimer() {
    if (this._timer) GLib.Source.remove(this._timer);
    this._timer = 0;
  }

  cleanup() {
    this._clearTimer();
    if (this._revealTimer) GLib.Source.remove(this._revealTimer);
    this._revealTimer = 0;
    if (this._checkId) GLib.Source.remove(this._checkId);
    this._checkId = 0;
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
    for (const [wa, ids] of this._windowIds) {
      for (const id of ids) {
        try {
          wa.disconnect(id);
        } catch (e) {
          // window already gone
        }
      }
    }
    this._windowIds.clear();
    if (this._edge) {
      Main.layoutManager.removeChrome(this._edge);
      this._edge.destroy();
    }
    this._edge = null;
  }
}
