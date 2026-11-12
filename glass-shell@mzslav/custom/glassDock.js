// Glass Shell — its own dock.
//
// A bottom-centred dock built from GNOME Shell's own Dash (the one the
// overview uses), so favourites, running apps, drag-and-drop reordering,
// right-click menus and the "Show Apps" button all come from the shell.
// It needs no Dash to Dock. The glass engine's dock glass is drawn behind
// the dash's background.
//
// Settings: enable-own-dock, dock-icon-size, dock-margin-bottom,
// dock-show-apps-first, dock-autohide (custom/dockIntellihide.js).
// Look: styles/dock.css. Windows minimise into their dock icon.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {Dash} from 'resource:///org/gnome/shell/ui/dash.js';

import {DhruvaDock} from '../dist/dockManager.js';
import {DockIntellihide} from './dockIntellihide.js';
import {shellIsDark} from './shellStyle.js';
import {handleIconClick, WindowPreviews} from './dockPreviews.js';

/**
 * The engine's generic "glass behind an actor" dock adapter. It takes the
 * actor's on-screen rect every frame; here the actor is the dash background.
 * The glass must be painted before the dock, so it is kept just below it.
 */
class OwnDockGlass extends DhruvaDock {
  constructor(path, target, dockActor, settings, logger) {
    super(path, target, settings, logger);
    this._dockActor = dockActor;
  }

  _apply() {
    super._apply();
    const glass = this._glass;
    const uiGroup = Main.layoutManager.uiGroup;
    if (glass && glass.get_parent() === uiGroup && this._dockActor.get_parent() === uiGroup)
      uiGroup.set_child_below_sibling(glass, this._dockActor);
  }
}

export class GlassDock {
  constructor(path, settings, logger) {
    this._path = path;
    this._settings = settings;
    this._logger = logger;
    this._settingIds = [];
    this._signals = [];
    this._container = null;
    this._dash = null;
    this._glass = null;
    this._syncingApps = false;
    this._layoutId = 0;
  }

  setup() {
    this._settingIds.push(this._settings.connect('changed::enable-own-dock', () => this._sync()));
    // Struts are fixed when the dock is added, so switching to or from "off" rebuilds it.
    this._settingIds.push(this._settings.connect('changed::dock-autohide', () => {
      const struts = this._settings.get_string('dock-autohide') === 'off';
      if (this._container && struts !== this._struts) {
        this._teardown();
        this._sync();
      }
    }));
    for (const key of ['dock-icon-size', 'dock-margin-bottom'])
      this._settingIds.push(this._settings.connect(`changed::${key}`, () => this._queueLayout()));
    this._sync();
  }

  _sync() {
    const want = this._settings.get_boolean('enable-own-dock');
    if (want && !this._container) this._build();
    else if (!want && this._container) this._teardown();
  }

  _connect(obj, signal, fn) {
    this._signals.push([obj, obj.connect(signal, fn)]);
  }

  _build() {
    this._container = new St.Widget({
      name: 'glassShellDock',
      layout_manager: new Clutter.BinLayout(),
      reactive: false,
    });

    this._syncLight = () => {
      // The wallpaper follows the system style, so the running dots do too
      // (dark dots on a light wallpaper, white ones on a dark one).
      if (St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK)
        this._container.remove_style_class_name('system-light');
      else
        this._container.add_style_class_name('system-light');
      if (shellIsDark(this._settings)) this._container.remove_style_class_name('light');
      else this._container.add_style_class_name('light');
    };
    this._dash = new Dash();
    this._dash.x_align = Clutter.ActorAlign.CENTER;
    this._dash.y_align = Clutter.ActorAlign.START;
    this._dash.track_hover = true;
    this._container.add_child(this._dash);

    // Chrome sits above windows and the overview, below popups; the strut
    // keeps maximised windows clear of the dock.
    // With auto-hide the dock floats over windows instead (no strut).
    this._struts = this._settings.get_string('dock-autohide') === 'off';
    Main.layoutManager.addChrome(this._container, {
      affectsStruts: this._struts,
      trackFullscreen: true,
    });

    // The overview has its own dash at the bottom; ours replaces it.
    this._overviewDash = Main.overview.dash;
    this._overviewDash?.hide();

    this._wireShowApps();
    this._placeShowApps();
    this._connect(this._settings, 'changed::dock-show-apps-first', () => this._placeShowApps());


    this._connect(Main.layoutManager, 'monitors-changed', () => this._queueLayout());
    this._connect(this._dash, 'icon-size-changed', () => this._queueLayout());
    this._connect(this._dash, 'notify::height', () => this._queueLayout());
    this._connect(this._dash, 'notify::width', () => this._queueLayout());

    this._syncGlass();
    this._syncLight();
    this._connect(St.Settings.get(), 'notify::color-scheme', () => this._syncLight());
    this._connect(this._settings, 'changed::shell-style', () => this._syncLight());

    // An open icon menu or a drag takes a grab, which drops hover; the dock
    // must stay while either lasts (as in Dash to Dock).
    this._menuOpen = false;
    this._dragging = false;
    const origMenuState = this._dash._itemMenuStateChanged.bind(this._dash);
    this._dash._itemMenuStateChanged = (item, opened) => {
      origMenuState(item, opened);
      this._menuOpen = opened;
      if (!opened) this._dash.sync_hover();
      this._intellihide?.hoverChanged();
    };
    const dragDone = () => {
      this._dragging = false;
      this._dash?.sync_hover();
      this._intellihide?.hoverChanged();
    };
    this._connect(Main.overview, 'item-drag-begin', () => {
      this._dragging = true;
      this._intellihide?.hoverChanged();
    });
    this._connect(Main.overview, 'item-drag-end', dragDone);
    this._connect(Main.overview, 'item-drag-cancelled', dragDone);

    // Clicks on running apps: focus, minimise, or window previews (custom/dockPreviews.js).
    this._previewManager = new PopupMenu.PopupMenuManager(this._dash);
    for (const item of this._dash._box.get_children()) this._hookItem(item);
    this._connect(this._dash._box, 'child-added', (_box, item) => this._hookItem(item));

    this._intellihide = new DockIntellihide(this._settings, {
      rect: () => this._dashRect(),
      hovered: () => (this._dash?.hover ?? false) || this._menuOpen || this._dragging,
      setHidden: hidden => this._setHidden(hidden),
    });
    this._intellihide.setup();
    this._connect(this._dash, 'notify::hover', () => this._intellihide?.hoverChanged());
    this._connect(this._dash._box, 'notify::allocation', () => this._queueIconGeometry());
    this._connect(this._dash, 'notify::width', () => this._intellihide?.layoutChanged());

    // Minimise animation target: each window flies into its app's icon.
    this._connect(global.display, 'restacked', () => this._queueIconGeometry());
    this._connect(global.display, 'window-created', () => this._queueIconGeometry());
    this._connect(this._dash, 'icon-size-changed', () => this._queueIconGeometry());

    this._layout();
    this._queueLayout();
  }

  // Slides down and fades out; the glass follows the dash's paint opacity,
  // so nothing of the dock is drawn (e.g. on a monitor below) while hidden.
  /** Performance mode turns the dock's glass off (styles/solid.css paints it). */
  setGlassEnabled(on) {
    this._glassEnabled = on;
    this._syncGlass();
  }

  _syncGlass() {
    const want = this._glassEnabled !== false && !!this._dash;
    // Without glass the dock paints its own background (styles/dock.css .solid).
    if (this._container) {
      if (want) this._container.remove_style_class_name('solid');
      else this._container.add_style_class_name('solid');
    }
    if (want && !this._glass) {
      this._glass = new OwnDockGlass(this._path, this._dash._background, this._container,
        this._settings, this._logger);
      this._glass.setup();
    } else if (!want && this._glass) {
      this._glass.cleanup();
      this._glass = null;
    }
  }

  // Where the dash is when shown (also while hidden), for intellihide and the edge strip.
  _dashRect() {
    if (!this._rect || !this._dash) return null;
    const w = Math.round(this._dash.width);
    if (!(w > 0)) return null;
    return {x: this._rect.x + Math.round((this._rect.w - w) / 2), y: this._rect.y, w, h: this._rect.h};
  }

  _hookItem(item) {
    const icon = item?.child;
    if (!icon?.app || icon._glassShellClick) return;
    icon._glassShellClick = true;
    const activate = icon.activate.bind(icon);
    icon.activate = button => {
      if (!handleIconClick(icon, button, (i, windows) => this._showPreviews(i, windows)))
        activate(button);
    };
  }

  _showPreviews(icon, windows) {
    this._closePreviews();
    const menu = new WindowPreviews(icon);
    this._previews = menu;
    this._previewManager.addMenu(menu);
    menu.fill(windows);
    menu.connect('open-state-changed', (_m, open) => {
      this._menuOpen = open;
      if (!open) {
        this._dash?.sync_hover();
        // Destroyed after the close animation has started.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (this._previews === menu) this._previews = null;
          if (!menu._glassShellDestroyed) {
            menu._glassShellDestroyed = true;
            menu.destroy();
          }
          return GLib.SOURCE_REMOVE;
        });
      }
      this._intellihide?.hoverChanged();
    });
    menu.open(BoxPointer.PopupAnimation.FULL);
  }

  _closePreviews() {
    const menu = this._previews;
    this._previews = null;
    if (menu && !menu._glassShellDestroyed) {
      menu._glassShellDestroyed = true;
      menu.close(BoxPointer.PopupAnimation.NONE);
      menu.destroy();
    }
  }

  _setHidden(hidden) {
    if (!this._container) return;
    this._hidden = hidden;
    this._dash.reactive = !hidden;
    this._container.remove_all_transitions();
    this._container.ease({
      translation_y: hidden ? (this._rect?.h ?? 80) : 0,
      opacity: hidden ? 0 : 255,
      duration: 220,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
  }

  _queueIconGeometry() {
    if (this._geometryId) return;
    this._geometryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      this._geometryId = 0;
      this._updateIconGeometry();
      return GLib.SOURCE_REMOVE;
    });
  }

  _updateIconGeometry() {
    if (!this._dash || !this._container?.get_stage()) return;
    // Where the icons are when the dock is shown, also while it is hidden.
    const dy = this._container.translation_y;
    for (const item of this._dash._box.get_children()) {
      const app = item.child?._delegate?.app;
      if (!app || !item.get_stage()) continue;
      const [x, y] = item.get_transformed_position();
      const [w, h] = item.get_transformed_size();
      if (![x, y, w, h].every(Number.isFinite)) continue;
      const rect = new Mtk.Rectangle({x: Math.round(x), y: Math.round(y - dy), width: Math.round(w), height: Math.round(h)});
      for (const win of app.get_windows()) win.set_icon_geometry(rect);
    }
  }

  // The dock's "Show Apps" button opens and closes the app grid, and follows
  // the overview's own button while the overview is open.
  _wireShowApps() {
    const own = this._dash.showAppsButton;
    const overviewButton = this._overviewDash?.showAppsButton;
    this._connect(own, 'notify::checked', () => {
      if (this._syncingApps) return;
      if (own.checked) {
        if (!Main.overview.visible) Main.overview.showApps();
        else if (overviewButton) overviewButton.checked = true;
      } else if (Main.overview.visible) {
        Main.overview.hide();
      }
    });
    const follow = checked => {
      this._syncingApps = true;
      own.checked = checked;
      this._syncingApps = false;
    };
    if (overviewButton)
      this._connect(overviewButton, 'notify::checked', () => follow(overviewButton.checked));
    this._connect(Main.overview, 'hidden', () => follow(false));
  }

  _queueLayout() {
    if (this._layoutId || !this._container) return;
    this._layoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._layoutId = 0;
      this._layout();
      return GLib.SOURCE_REMOVE;
    });
  }

  _layout() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor || !this._container) return;
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const iconSize = this._settings.get_int('dock-icon-size') * scale;
    const margin = this._settings.get_int('dock-margin-bottom') * scale;

    // Dash picks the largest stock icon size (16 22 24 32 48 64) that fits
    // its max height after taking off the same paddings it measures here,
    // so asking for icon size + those paddings gets exactly that size.
    this._dash.setMaxSize(monitor.width - 64 * scale, iconSize + this._iconExtra());

    const [, height] = this._dash.get_preferred_height(-1);
    const total = Math.ceil(height + margin);
    // The container spans the monitor's width so the dash can grow when
    // apps start (a container sized to the dash once clipped the running,
    // non-favourite apps). It is not reactive, so the space beside the dock
    // still reaches the windows; only the dash takes input. Touching the
    // bottom edge, it gives a bottom strut when hiding is off.
    const y = monitor.y + monitor.height - total;
    this._container.set_position(monitor.x, y);
    this._container.set_size(monitor.width, total);
    this._rect = {x: monitor.x, y, w: monitor.width, h: total};
    if (this._hidden) this._container.translation_y = total;
    // The overview keeps room at the bottom for its own (hidden) dash; make
    // that room exactly our dock's height.
    this._overviewDash?.set_height(total);
    this._intellihide?.layoutChanged();
    this._queueIconGeometry();
  }

  // The height Dash._adjustIconSize subtracts before choosing an icon size.
  _iconExtra() {
    const dash = this._dash;
    const showApps = dash._showAppsIcon;
    dash.ensure_style();
    const bgPad = dash._background.get_theme_node().get_vertical_padding();
    const ownPad = dash.get_theme_node().get_vertical_padding();
    const [, buttonH] = showApps.toggleButton.get_preferred_height(-1);
    const [, iconH] = showApps.icon.icon.get_preferred_height(-1);
    return Math.ceil(dash.margin_top + dash.margin_bottom + bgPad + ownPad + (buttonH - iconH)) + 1;
  }

  // "Show Apps" first, where the launcher sits on macOS.
  _placeShowApps() {
    const box = this._dash._dashContainer;
    const icon = this._dash._showAppsIcon;
    const first = this._settings.get_boolean('dock-show-apps-first');
    box.set_child_at_index(icon, first ? 0 : box.get_n_children() - 1);
  }

  _teardown() {
    this._closePreviews();
    this._previewManager = null;
    if (this._layoutId) GLib.Source.remove(this._layoutId);
    this._layoutId = 0;
    if (this._geometryId) GLib.Source.remove(this._geometryId);
    this._geometryId = 0;
    this._intellihide?.cleanup();
    this._intellihide = null;
    this._rect = null;
    this._hidden = false;
    for (const wa of global.get_window_actors())
      wa.get_meta_window?.()?.set_icon_geometry(null);
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    this._glass?.cleanup();
    this._glass = null;
    this._overviewDash?.set_height(-1);
    this._overviewDash?.show();
    this._overviewDash = null;
    if (this._container) {
      Main.layoutManager.removeChrome(this._container);
      this._container.destroy();
    }
    this._container = null;
    this._dash = null;
  }

  cleanup() {
    for (const id of this._settingIds) this._settings.disconnect(id);
    this._settingIds = [];
    this._teardown();
  }
}
