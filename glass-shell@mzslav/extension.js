import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {UIManager} from './dist/uiManager.js';
import {PanelMenuManager, ExtraDateMenuManager, DockMenuManager} from './dist/panelMenuManager.js';
import {BlurMyShellWatch} from './dist/blurMyShell.js';
import {DockWatcher} from './dist/dockManager.js';
import {NotificationManager} from './dist/notificationManager.js';
import {QuickSettingsManager} from './dist/quickSettingsManager.js';
import {OsdManager} from './dist/osdManager.js';
import {ApplicationManager} from './dist/applicationManager.js';
import {WindowListService} from './dist/windowListService.js';
import {TopBarManager, ExtraTopBarManager} from './dist/topBarManager.js';
import {HiddenClockGlass} from './dist/hiddenClockGlass.js';
import {DesktopLayer} from './dist/desktop/desktopLayer.js';
import {Launcher} from './dist/launcherManager.js';
import {IconStyler} from './dist/iconStyle/iconStyler.js';
import {Logger, setUtilsLogger} from './dist/logger.js';
import {adaptiveColorTweener} from './dist/animation.js';
import {installGlassDiagnostics, removeGlassDiagnostics, DumpShortcut} from './dist/diagnostics.js';
import {trackViewPaints, untrackViewPaints} from './dist/rendering/backdropGlass.js';
import {clearShaderSources} from './dist/rendering/pipelines.js';
import {ExtraStyles} from './custom/extraStyles.js';
import {GlassDock} from './custom/glassDock.js';
import {DevTools} from './custom/devTools.js';
import {ThemeBuilder} from './custom/themeBuilder.js';
import {ThemeMode} from './custom/themeMode.js';
import {Wallpapers} from './custom/wallpapers.js';
import {PanelTidy} from './custom/panelTidy.js';
import {OverviewBlur} from './custom/overviewBlur.js';
import {PerformanceMode} from './custom/performanceMode.js';
import {LockBlur} from './custom/lockBlur.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const QUICK_SETTINGS_DELAY_MS = 1500;

export default class GlassShellExtension extends Extension {
  // Glass Shell stays enabled on the lock screen ("session-modes" in
  // metadata.json) only to paint the lock screen wallpaper (custom/lockBlur.js);
  // everything else is stopped there, as if the extension were off.
  enable() {
    this._sessionId = Main.sessionMode.connect('updated', () => this._syncSession());
    this._syncSession();
  }

  _syncSession() {
    const locked = Main.sessionMode.isLocked;
    if (locked) {
      if (this._running) this._teardown();
      if (!this._lockBlur) {
        this._lockBlur = new LockBlur();
        this._lockBlur.setup();
      }
      return;
    }
    this._lockBlur?.cleanup();
    this._lockBlur = null;
    if (this._running) return;
    // A failed _setup() is taken down at once, so it never half-runs.
    this._running = true;
    try {
      this._setup();
    } catch (e) {
      this._teardown();
      console.error(`[Glass Shell] ${e}`);
    }
  }

  _setup() {
    this._settings = this.getSettings();
    this._logger = new Logger(this._settings);
    // Modules without settings of their own log through the same
    // `output-logs`-gated logger.
    setUtilsLogger(this._logger);
    const path = this.dir.get_path();
    this._path = path;

    // macOS-style controls and any other stylesheets listed in custom/extraStyles.js.
    this._extraStyles = new ExtraStyles(path, this._settings);
    this._extraStyles.setup();

    // Our own dock (replaces Dash to Dock) and the opt-in dev helpers.
    this._glassDock = new GlassDock(path, this._settings, this._logger);
    this._glassDock.setup();
    this._devTools = new DevTools(this._settings);
    this._devTools.setup();

    // Light/dark following, wallpaper pairs, panel alignment, and the
    // Glass Shell's own shell theme (scaled; see custom/themeBuilder.js).
    this._themeMode = new ThemeMode(path, this._settings);
    this._themeMode.setup();
    this._wallpapers = new Wallpapers(path, this._settings);
    this._wallpapers.setup();
    this._panelTidy = new PanelTidy(this._settings);
    this._panelTidy.setup();
    this._overviewBlur = new OverviewBlur(this._settings);
    this._overviewBlur.setup();
    this._themeBuilder = new ThemeBuilder(path, this._settings);
    this._themeBuilder.setup();

    // Performance mode decides whether the glass engine runs at all.
    this._performance = new PerformanceMode(this._settings, active => this._setPerformance(active));
    this._performance.setup();
    this._setPerformance(this._performance.active);
  }

  // Performance mode on: no glass anywhere, solid theme. Off: the glass engine runs.
  _setPerformance(active) {
    this._themeBuilder?.setPerformance(active);
    this._glassDock?.setGlassEnabled(!active);
    this._overviewBlur?.setEnabled(!active);
    if (active) this._stopGlass();
    else this._startGlass();
  }

  // The glass engine (the Liquid Glass part): top bar, menus, Quick Settings,
  // notifications, OSDs, window glass, Dash to Dock / Dhruva glass.
  _startGlass() {
    if (this._glassRunning) return;
    this._glassRunning = true;
    const path = this._path;
    installGlassDiagnostics();
    trackViewPaints();

    this._uiManager = new UIManager(path, this._settings, this._logger);
    this._uiManager.setup();

    this._extraDateMenuManager = new ExtraDateMenuManager(path, this._settings, this._logger);
    this._extraDateMenuManager.setup();

    this._panelMenuManager = new PanelMenuManager(path, this._settings, this._logger);
    this._panelMenuManager.setup();

    this._dockMenuManager = new DockMenuManager(path, this._settings, this._logger);
    this._dockMenuManager.setup();

    this._topBarManager = new TopBarManager(path, this._settings, this._logger);
    this._topBarManager.setup();

    this._extraTopBarManager = new ExtraTopBarManager(path, this._settings, this._logger);
    this._extraTopBarManager.setup();

    this._hiddenClockGlass = new HiddenClockGlass(path, this._settings, this._logger);
    this._hiddenClockGlass.setup();

    this._desktopLayer = new DesktopLayer(path, this._settings, this._logger, () => this.openPreferences());
    this._desktopLayer.setup();

    this._iconStyler = new IconStyler(path, this._settings, this._logger);
    this._iconStyler.setup();

    this._launcher = new Launcher(path, this._settings, this._logger, this._iconStyler);
    this._launcher.setup();

    this._blurMyShellWatch = new BlurMyShellWatch(this._settings, this._logger);
    this._blurMyShellWatch.setup();

    this._notificationManager = new NotificationManager(path, this._settings, this._logger);
    this._notificationManager.setup();

    this._osdManager = new OsdManager(path, this._settings, this._logger);
    this._osdManager.setup();

    this._applicationManager = new ApplicationManager(path, this._settings, this._logger);
    this._applicationManager.setup();

    // Lets the preferences window, which cannot use Meta or Shell, offer a
    // picker of the open windows.
    this._windowListService = new WindowListService(this._logger);
    this._windowListService.setup();

    // The shell adds some Quick Settings items asynchronously at startup, so
    // the menu is styled once they are in place.
    this._quickSettingsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, QUICK_SETTINGS_DELAY_MS, () => {
      this._quickSettingsTimeoutId = 0;
      this._quickSettingsManager = new QuickSettingsManager(path, this._settings, this._logger);
      this._quickSettingsManager.setup();
      return GLib.SOURCE_REMOVE;
    });

    this._dockWatcher = new DockWatcher(path, this._settings, this._logger, this._iconStyler);
    this._dockWatcher.setup();

    this._dumpShortcut = new DumpShortcut(this._settings);
    this._dumpShortcut.setup();

  }


  _stopGlass() {
    if (!this._glassRunning) return;
    this._glassRunning = false;
    this._dumpShortcut?.cleanup();
    this._dumpShortcut = null;

    // Shared state that no single manager owns.
    adaptiveColorTweener.stopAll();

    if (this._quickSettingsTimeoutId) {
      GLib.Source.remove(this._quickSettingsTimeoutId);
      this._quickSettingsTimeoutId = 0;
    }

    this._panelMenuManager?.cleanup();
    this._panelMenuManager = null;
    this._dockMenuManager?.cleanup();
    this._dockMenuManager = null;

    this._topBarManager?.cleanup();
    this._topBarManager = null;

    this._extraTopBarManager?.cleanup();
    this._extraTopBarManager = null;

    this._hiddenClockGlass?.cleanup();
    this._hiddenClockGlass = null;

    this._desktopLayer?.cleanup();
    this._desktopLayer = null;

    this._launcher?.cleanup();
    this._launcher = null;

    this._blurMyShellWatch?.cleanup();
    this._blurMyShellWatch = null;

    this._uiManager?.cleanup();
    this._uiManager = null;

    this._extraDateMenuManager?.cleanup();
    this._extraDateMenuManager = null;

    this._quickSettingsManager?.cleanup();
    this._quickSettingsManager = null;

    // Before the icon styler, which the docks' icons are watched by.
    this._dockWatcher?.cleanup();
    this._dockWatcher = null;

    this._iconStyler?.cleanup();
    this._iconStyler = null;

    this._notificationManager?.cleanup();
    this._notificationManager = null;

    this._osdManager?.cleanup();
    this._osdManager = null;

    this._applicationManager?.cleanup();
    this._applicationManager = null;

    this._windowListService?.cleanup();
    this._windowListService = null;

    untrackViewPaints();
    clearShaderSources();
    removeGlassDiagnostics();
  }

  disable() {
    if (this._sessionId) Main.sessionMode.disconnect(this._sessionId);
    this._sessionId = 0;
    this._lockBlur?.cleanup();
    this._lockBlur = null;
    this._teardown();
  }

  // Also runs after a failed _setup(), when only some of these exist.
  _teardown() {
    this._running = false;
    this._performance?.cleanup();
    this._performance = null;
    for (const name of ['_themeBuilder', '_overviewBlur', '_panelTidy', '_wallpapers', '_themeMode']) {
      this[name]?.cleanup();
      this[name] = null;
    }
    this._devTools?.cleanup();
    this._devTools = null;
    this._glassDock?.cleanup();
    this._glassDock = null;

    this._extraStyles?.cleanup();
    this._extraStyles = null;

    this._stopGlass();
    setUtilsLogger(null);
    this._logger?.cleanup();
    this._logger = null;
    this._settings = null;
  }
}
