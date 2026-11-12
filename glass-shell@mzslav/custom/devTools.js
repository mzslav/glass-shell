// Glass Shell — development helpers, OFF by default (setting "dev-tools").
//
// While on, exports a small D-Bus object on the shell's own connection so a
// script can take a screenshot and open menus to check how they look:
//
//   gdbus call --session --dest org.gnome.Shell \
//     --object-path /org/gnome/Shell/Extensions/GlassShellDev \
//     --method org.gnome.Shell.Extensions.GlassShellDev.Show quick-settings
//   ... .Screenshot /tmp/shot.png
//
// Anything on the session bus can then take screenshots, so keep it off in
// everyday use. tools/preview.sh uses it in a throwaway headless shell.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OBJECT_PATH = '/org/gnome/Shell/Extensions/GlassShellDev';
const IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.GlassShellDev">
    <method name="Screenshot">
      <arg type="s" direction="in" name="path"/>
    </method>
    <method name="Show">
      <arg type="s" direction="in" name="what"/>
    </method>
    <method name="Inspect">
      <arg type="s" direction="in" name="what"/>
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

export class DevTools {
  constructor(settings) {
    this._settings = settings;
    this._settingId = 0;
    this._impl = null;
  }

  setup() {
    this._settingId = this._settings.connect('changed::dev-tools', () => this._sync());
    this._sync();
  }

  _sync() {
    const want = this._settings.get_boolean('dev-tools');
    if (want && !this._impl) {
      try {
        this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._impl.export(Gio.DBus.session, OBJECT_PATH);
      } catch (e) {
        console.warn(`[Glass Shell] dev-tools: ${e}`);
        this._impl = null;
      }
    } else if (!want && this._impl) {
      this._impl.unexport();
      this._impl = null;
    }
  }

  ScreenshotAsync([path], invocation) {
    try {
      // Only new .png files: create() fails on an existing file, so a caller
      // can never overwrite anything with a screenshot.
      if (!path.endsWith('.png')) throw new Error('path must end in .png');
      const stream = Gio.File.new_for_path(path).create(Gio.FileCreateFlags.NONE, null);
      const shooter = new Shell.Screenshot();
      shooter.screenshot(false, stream, (obj, res) => {
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

  Show(what) {
    const area = Main.panel.statusArea;
    const closeAll = () => {
      for (const item of Object.values(area)) item?.menu?.close?.();
    };
    switch (what) {
    case 'quick-settings': closeAll(); area.quickSettings?.menu.open(); break;
    case 'calendar': closeAll(); area.dateMenu?.menu.open(); break;
    case 'overview': closeAll(); Main.overview.show(); break;
    case 'apps':
      closeAll();
      // show() is a no-op while the overview is already open.
      if (Main.overview.visible) Main.overview.dash.showAppsButton.checked = true;
      else Main.overview.showApps();
      break;
    case 'notify': Main.notify('Glass Shell', 'A test notification to check the glass'); break;
    case 'close': closeAll(); Main.overview.hide(); break;
    default:
      if (what.startsWith('dock-click:')) {
        // Clicks the n-th app icon of the Glass Shell dock (0 = first app).
        const dock = Main.layoutManager.uiGroup.get_children().find(a => a.get_name() === 'glassShellDock');
        const dash = dock?.get_first_child();
        const items = dash?._box.get_children().filter(i => i.child?.app) ?? [];
        items[Number(what.slice(11))]?.child.activate(Clutter.BUTTON_PRIMARY);
        break;
      }
      throw new Error(`unknown target ${what}`);
    }
  }

  // A read-only look at shell actors, for debugging: "overview", "quick-settings",
  // "theme", or "menu:<status area name>" (also opens that menu).
  Inspect(what) {
    const describe = (actor, depth) => {
      const out = {
        type: actor.constructor?.name ?? '?',
        name: actor.get_name?.() ?? null,
        style: actor.get_style_class_name?.() ?? null,
        visible: actor.visible,
        mapped: actor.mapped,
        opacity: actor.opacity,
        box: [actor.x, actor.y, actor.width, actor.height].map(Math.round),
        scale: [actor.scale_x, actor.scale_y],
        effects: actor.get_effects().map(e => e.constructor?.name),
        inline: actor.get_style?.() ?? null,
        pseudo: actor.get_style_pseudo_class?.() ?? null,
      };
      if (depth > 0) out.children = actor.get_children().map(c => describe(c, depth - 1));
      return out;
    };
    let result;
    if (what === 'overview') {
      result = describe(Main.layoutManager.overviewGroup, 2);
    } else if (what === 'quick-settings') {
      result = describe(Main.panel.statusArea.quickSettings.menu.actor, 9);
    } else if (what === 'theme') {
      const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
      result = {
        application: theme.application_stylesheet?.get_path() ?? null,
        default: theme.default_stylesheet?.get_path() ?? theme.default_stylesheet?.get_uri() ?? null,
        custom: theme.get_custom_stylesheets().map(f => f.get_path()),
      };
    } else if (what.startsWith('menu:')) {
      const item = Main.panel.statusArea[what.slice(5)];
      item?.menu?.open?.();
      result = item ? describe(item.menu.actor, 3) : {error: 'no such status area item',
        items: Object.keys(Main.panel.statusArea)};
    } else {
      result = {error: 'unknown'};
    }
    return JSON.stringify(result);
  }

  cleanup() {
    if (this._settingId) this._settings.disconnect(this._settingId);
    this._settingId = 0;
    this._impl?.unexport();
    this._impl = null;
  }
}
