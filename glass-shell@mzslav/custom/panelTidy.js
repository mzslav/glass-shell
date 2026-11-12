// Glass Shell — keeps text in the top bar vertically centred.
//
// Some indicators (e.g. the Docker container counter) add a label with a
// hard-coded top margin and no vertical alignment, so the number sits high.
// This centres every label in the bar's three boxes and drops such margins,
// also for indicators added later. Setting "tidy-panel".

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MARGIN = /margin-(top|bottom)\s*:\s*[^;]*;?/g;

export class PanelTidy {
  constructor(settings) {
    this._settings = settings;
    this._ids = [];
    this._boxIds = [];
    this._touched = new Map();
  }

  setup() {
    this._ids.push(this._settings.connect('changed::tidy-panel', () => this._sync()));
    this._sync();
  }

  _boxes() {
    return [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox].filter(Boolean);
  }

  _sync() {
    this._restore();
    if (!this._settings.get_boolean('tidy-panel')) return;
    for (const box of this._boxes()) {
      this._boxIds.push([box, box.connect('child-added', (_b, child) => this._walk(child))]);
      this._walk(box);
    }
  }

  _walk(actor) {
    if (actor instanceof St.Label && !this._touched.has(actor)) {
      // Forget labels that go away, so cleanup never touches a disposed one.
      const destroyId = actor.connect('destroy', () => this._touched.delete(actor));
      this._touched.set(actor, [actor.y_align, actor.style, destroyId]);
      actor.y_align = Clutter.ActorAlign.CENTER;
      if (actor.style && MARGIN.test(actor.style)) actor.style = actor.style.replace(MARGIN, '');
      MARGIN.lastIndex = 0;
    }
    for (const child of actor.get_children()) this._walk(child);
  }

  _restore() {
    for (const [box, id] of this._boxIds) box.disconnect(id);
    this._boxIds = [];
    for (const [label, [align, style, destroyId]] of this._touched) {
      label.disconnect(destroyId);
      label.y_align = align;
      label.style = style;
    }
    this._touched.clear();
  }

  cleanup() {
    for (const id of this._ids) this._settings.disconnect(id);
    this._ids = [];
    this._restore();
  }
}
