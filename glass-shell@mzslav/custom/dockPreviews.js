// Glass Shell — what a click on a running app's dock icon does
// (like Dash to Dock's "focus, minimize or show previews"):
//
//   app not focused            → bring its last used window to the front
//   focused, one window        → minimise it
//   focused, several windows   → a menu above the icon with a live preview of
//                                each window; click one to switch to it
//
// Middle click and Ctrl+click still open a new window, and in the overview
// the shell's own behaviour is kept. Look: styles/dock.css (.glass-shell-previews).

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const PREVIEW_W = 220;
const PREVIEW_H = 140;

/** The app's windows on the current workspace (all of them if none is here), most recent first. */
export function appWindows(app) {
  const all = app.get_windows().filter(w => !w.skip_taskbar);
  const ws = global.workspace_manager.get_active_workspace();
  const here = all.filter(w => w.located_on_workspace(ws));
  return here.length ? here : all;
}

/**
 * Handles a click on `icon` (a Dash icon). Returns true when it did
 * something, false to let the shell's own activate() run.
 */
export function handleIconClick(icon, button, showPreviews) {
  const app = icon.app;
  if (!app || app.state !== Shell.AppState.RUNNING || Main.overview.visible) return false;
  const event = Clutter.get_current_event();
  const mods = event ? event.get_state() : 0;
  if (button === Clutter.BUTTON_MIDDLE || (mods & Clutter.ModifierType.CONTROL_MASK)) return false;

  const windows = appWindows(app);
  if (!windows.length) return false;
  const focused = Shell.WindowTracker.get_default().focus_app === app;
  if (!focused) {
    Main.activateWindow(windows[0]);
  } else if (windows.length > 1) {
    showPreviews(icon, windows);
  } else {
    windows[0].minimize();
  }
  return true;
}

export class WindowPreviews extends PopupMenu.PopupMenu {
  constructor(source) {
    super(source, 0.5, St.Side.BOTTOM);
    this.actor.add_style_class_name('glass-shell-previews');
    Main.uiGroup.add_child(this.actor);
    this.actor.hide();
    this._row = new St.BoxLayout({style_class: 'glass-shell-previews-row'});
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    item.add_child(this._row);
    this.addMenuItem(item);
  }

  fill(windows) {
    this._row.destroy_all_children();
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    for (const win of windows) {
      const actor = win.get_compositor_private();
      if (!actor) continue;
      const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'glass-shell-preview-box'});
      const bin = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: PREVIEW_W * scale,
        height: PREVIEW_H * scale,
      });
      const [aw, ah] = actor.get_size();
      if (aw > 0 && ah > 0) {
        const s = Math.min(PREVIEW_W * scale / aw, PREVIEW_H * scale / ah);
        const clone = new Clutter.Clone({
          source: actor,
          width: Math.round(aw * s),
          height: Math.round(ah * s),
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.CENTER,
        });
        bin.add_child(clone);
      }
      box.add_child(bin);
      box.add_child(new St.Label({
        text: win.get_title() ?? '',
        style_class: 'glass-shell-preview-title',
        x_align: Clutter.ActorAlign.CENTER,
      }));
      const button = new St.Button({style_class: 'glass-shell-preview', child: box, can_focus: true});
      button.connect('clicked', () => {
        this.close(BoxPointer.PopupAnimation.NONE);
        Main.activateWindow(win);
      });
      // A window that closes while the menu is open drops out of it.
      const unmanagedId = win.connect('unmanaged', () => button.destroy());
      button.connect('destroy', () => win.disconnect(unmanagedId));
      this._row.add_child(button);
    }
  }
}
