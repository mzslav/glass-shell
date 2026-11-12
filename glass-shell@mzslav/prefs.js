import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {buildPreferences} from './preferences/pages.js';

export default class GlassShellPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    buildPreferences(window, this.getSettings());
  }
}
