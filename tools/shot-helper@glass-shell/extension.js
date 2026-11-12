// Test-only: a Screenshot(path) D-Bus method that keeps working on the lock
// screen. tools/preview.sh enables it only in its throwaway headless shell.
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `<node><interface name="org.gnome.Shell.Extensions.GlassShellShot">
  <method name="Screenshot"><arg type="s" direction="in" name="path"/></method>
  <method name="Lock"/>
  <method name="Unlock"/>
  <method name="LockState"><arg type="s" direction="out" name="json"/></method>
</interface></node>`;

export default class ShotHelper extends Extension {
  enable() {
    this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
    this._impl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/GlassShellShot');
  }

  disable() {
    this._impl?.unexport();
    this._impl = null;
  }

  // What Super+L does (ScreenSaver.SetActive only blanks the screen).
  Lock() {
    Main.screenShield.lock(true);
  }

  Unlock() {
    Main.screenShield.deactivate(false);
  }

  // Where the lock screen put its wallpapers, for debugging.
  LockState() {
    const shield = Main.screenShield;
    const dialog = shield._dialog;
    const group = dialog?._backgroundGroup;
    return JSON.stringify({
      locked: shield.locked,
      monitors: Main.layoutManager.monitors.map(m => [m.x, m.y, m.width, m.height]),
      dialogVisible: dialog?.visible, dialogMapped: dialog?.mapped,
      dialogBox: dialog ? [dialog.x, dialog.y, dialog.width, dialog.height] : null,
      shieldGroup: shield._lockDialogGroup ? [shield._lockDialogGroup.visible, shield._lockDialogGroup.opacity,
        shield._lockDialogGroup.width, shield._lockDialogGroup.height] : null,
      glassShell: Main.extensionManager.lookup('glass-shell@mzslav')?.state,
      backgrounds: group?.get_children().map(w => ({
        box: [w.x, w.y, w.width, w.height], visible: w.visible, opacity: w.opacity, mapped: w.mapped,
        style: w.get_style_class_name?.(), effects: w.get_effects().map(e => e.constructor.name),
        name: w.get_name(), style2: w.get_style(), children: w.get_children().map(c => [c.constructor.name, c.width, c.height, c.visible, c.opacity]),
      })) ?? null,
    });
  }

  ScreenshotAsync([path], invocation) {
    try {
      const stream = Gio.File.new_for_path(path).create(Gio.FileCreateFlags.NONE, null);
      new Shell.Screenshot().screenshot(false, stream, (obj, res) => {
        try {
          obj.screenshot_finish(res);
          stream.close(null);
          invocation.return_value(null);
        } catch (e) {
          invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, String(e));
        }
      });
    } catch (e) {
      invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, String(e));
    }
  }
}
