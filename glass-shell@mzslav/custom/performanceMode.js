// Glass Shell — Performance mode (setting "performance-mode").
//
//   auto  on while the system power mode is Power Saver (the default)
//   on    always
//   off   never
//
// While on, extension.js stops the whole glass engine (top bar, dock, menu,
// notification and window glass, overview blur) and the theme switches to
// solid surfaces (styles/solid.css). Nothing in your settings is changed, so
// turning it off brings everything back as it was.

import Gio from 'gi://Gio';

const PROFILES = [
  ['org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles'],
  ['net.hadess.PowerProfiles', '/net/hadess/PowerProfiles'],
];

export class PerformanceMode {
  constructor(settings, onChange) {
    this._settings = settings;
    this._onChange = onChange;
    this._profile = '';
    this._proxy = null;
    this._ids = [];
    this._active = null;
  }

  get active() {
    const mode = this._settings.get_string('performance-mode');
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return this._profile === 'power-saver';
  }

  setup() {
    this._ids.push([this._settings, this._settings.connect('changed::performance-mode', () => this._emit())]);
    this._connectProfiles(0);
    this._active = this.active;
  }

  // Listens to whichever power-profiles service this system has.
  _connectProfiles(i) {
    if (i >= PROFILES.length) return;
    const [name, path] = PROFILES[i];
    Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
      name, path, name, null, (_o, res) => {
        let proxy;
        try {
          proxy = Gio.DBusProxy.new_for_bus_finish(res);
        } catch (e) {
          this._connectProfiles(i + 1);
          return;
        }
        if (!proxy.get_name_owner()) {
          this._connectProfiles(i + 1);
          return;
        }
        if (this._ids === null) return; // cleaned up meanwhile
        this._proxy = proxy;
        const read = () => {
          this._profile = proxy.get_cached_property('ActiveProfile')?.unpack() ?? '';
          this._emit();
        };
        this._ids.push([proxy, proxy.connect('g-properties-changed', read)]);
        read();
      });
  }

  _emit() {
    const active = this.active;
    if (active === this._active) return;
    this._active = active;
    this._onChange(active);
  }

  cleanup() {
    for (const [obj, id] of this._ids ?? []) obj.disconnect(id);
    this._ids = null;
    this._proxy = null;
  }
}
