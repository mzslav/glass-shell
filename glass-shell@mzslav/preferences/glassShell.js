// Glass Shell — the preferences group for the parts in custom/.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { findWallpapers } from '../custom/wallpapers.js';

const EXTENSION_DIR = GLib.path_get_dirname(
  GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const WALLPAPER_DIR = `${EXTENSION_DIR}/wallpapers`;

export function addGlassShell(page, controls) {
  const settings = controls.settings;
  const group = controls.group(page, 'Glass Shell', 'Size, dock, light / dark style and wallpapers');

  controls.choice(group, 'Performance mode', [
    { title: 'Automatic (with Power Saver)', patch: { 'performance-mode': 'auto' } },
    { title: 'Always on (no glass)', patch: { 'performance-mode': 'on' } },
    { title: 'Off (always glass)', patch: { 'performance-mode': 'off' } },
  ], 'Turns all glass and blur off so the desktop runs lighter', false);

  controls.choice(group, 'Interface size', [
    ['Tiny', 0.7], ['Extra compact', 0.75], ['Compact', 0.8], ['Small', 0.85],
    ['Medium', 0.9], ['Comfortable', 0.95], ['GNOME default', 1.0], ['Large', 1.1], ['Extra large', 1.2],
  ].map(([title, value]) => ({ title, patch: { 'ui-scale': value } })),
  'Top bar, menus, Quick Settings, calendar; paddings shrink too');
  controls.number(group, 'Exact scale', ['ui-scale'], 0.6, 1.4, 0.01, '', { slider: true });

  controls.toggle(group, 'Glass Shell dock', 'enable-own-dock', 'Bottom dock; keep Dash to Dock off');
  controls.choice(group, 'Dock icon size', [
    { title: 'Small (32 px)', patch: { 'dock-icon-size': 32 } },
    { title: 'Large (48 px)', patch: { 'dock-icon-size': 48 } },
    { title: 'Huge (64 px)', patch: { 'dock-icon-size': 64 } },
  ], '', false);
  controls.toggle(group, 'Show Apps button first', 'dock-show-apps-first');
  controls.choice(group, 'Dock hiding', [
    { title: 'Smart (when a window covers it)', patch: { 'dock-autohide': 'intellihide' } },
    { title: 'Always hide', patch: { 'dock-autohide': 'autohide' } },
    { title: 'Never hide', patch: { 'dock-autohide': 'off' } },
  ], 'Push the pointer to the bottom edge to show it', false);
  controls.toggle(group, 'Glass Shell theme', 'own-theme', 'Glass Shell\'s own scaled shell theme instead of GNOME\'s');

  controls.choice(group, 'Shell in Light style', [
    { title: 'Dark (white text and icons)', patch: { 'shell-style': 'dark' } },
    { title: 'Light (follows the system)', patch: { 'shell-style': 'follow' } },
  ], 'Top bar, menus, Quick Settings, dock, overview. Apps and wallpaper always follow the system', false);
  controls.toggle(group, 'Follow Light / Dark style', 'follow-color-scheme',
    'Glass and controls change with the Dark Style switch');
  controls.toggle(group, 'macOS-style controls', 'enable-macos-styles',
    'Capsule sliders, rounded menus and notification cards (styles/macos.css)');
  controls.toggle(group, 'Blur behind overview', 'overview-blur', 'Like Blur my Shell');
  controls.number(group, 'Overview blur', ['overview-blur-radius'], 0, 200, 5, '', { slider: true });
  controls.number(group, 'Overview brightness', ['overview-blur-brightness'], 0, 1, 0.05, '', { slider: true });
  controls.toggle(group, 'Centre top bar text', 'tidy-panel', 'E.g. the Docker container counter');

  // Wallpaper pairs from wallpapers/, rebuilt when the folder changes.
  const pairs = [...findWallpapers(WALLPAPER_DIR).keys()].sort();
  const names = ['', ...pairs];
  const row = new Adw.ComboRow({
    title: 'Wallpaper',
    subtitle: 'NAME-light / NAME-dark pictures in the wallpapers folder',
    model: Gtk.StringList.new(['Leave as it is', ...pairs]),
  });
  group.add(row);
  let syncing = false;
  const refresh = () => {
    syncing = true;
    const index = names.indexOf(settings.get_string('wallpaper'));
    row.selected = index < 0 ? 0 : index;
    syncing = false;
  };
  row.connect('notify::selected', () => {
    if (!syncing) settings.set_string('wallpaper', names[row.selected] ?? '');
  });
  controls.watch(['wallpaper'], refresh);
  refresh();

  const open = new Gtk.Button({ label: 'Open folder', valign: Gtk.Align.CENTER });
  open.connect('clicked', () => {
    Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(WALLPAPER_DIR).get_uri(), null);
  });
  const folderRow = new Adw.ActionRow({ title: 'Wallpapers folder', subtitle: WALLPAPER_DIR });
  folderRow.add_suffix(open);
  group.add(folderRow);
}
