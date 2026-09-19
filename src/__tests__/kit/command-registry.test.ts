/**
 * The keymap declares what commands exist; this declares what they do. The two halves have to
 * cover each other exactly, or an id is either unreachable or unlisted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { COMMAND_META } from '../../core/runtime/keybindings';
import { COMMANDS, COMMAND_BY_ID, RUN } from '../../kit/commands';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeTemplate } from '../rules/_helpers';

describe('command registry', () => {
  it('implements exactly the declared ids', () => {
    expect(COMMANDS.map((c) => c.id).sort()).toEqual(COMMAND_META.map((c) => c.id).sort());
  });

  it('indexes every command by id', () => {
    expect(COMMAND_BY_ID.size).toBe(COMMANDS.length);
  });

  it('gives every discrete command something to run', () => {
    for (const cmd of COMMANDS.filter((c) => !c.continuous)) {
      expect(typeof cmd.run).toBe('function');
    }
  });

  it('leaves held keys to the rAF loop', () => {
    for (const cmd of COMMANDS.filter((c) => c.continuous)) {
      expect(() => cmd.run({} as never)).not.toThrow();
    }
  });
});

/**
 * `COMMANDS` zips the data half (`COMMAND_META`) with the behaviour half (`RUN`) by id, defaulting
 * a missing key to a no-op (`RUN[meta.id] ?? (() => {})`). That default is silent: a typo'd or
 * forgotten `RUN` entry compiles clean and the command simply does nothing when pressed — which is
 * why the checks above (built from `COMMANDS`) can't catch it. These check `RUN` itself instead.
 */
// UI zoom and context help use always-live listeners so they remain available inside dialogs.
// useUiZoomShortcut and useContextHelp own these bindings outside the discrete command engine.
const NO_RUN_IDS = new Set(['app.ui_zoom_in', 'app.ui_zoom_out', 'app.whats_this']);

describe('COMMAND_META <-> RUN bijection', () => {
  it('every non-continuous command has a RUN body', () => {
    const missing = COMMAND_META
      .filter((c) => !c.continuous && !NO_RUN_IDS.has(c.id) && !(c.id in RUN))
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('every RUN key names a declared command id', () => {
    const ids = new Set(COMMAND_META.map((c) => c.id));
    const stale = Object.keys(RUN).filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });
});

describe('the numbered tool keys inside annotate mode', () => {
  const s = () => useEditorStore.getState();
  const ctx = { openBuild: () => { throw new Error('a number key in annotate mode must not switch modes'); } } as never;

  beforeEach(() => {
    s().setEditMode({ mode: 'annotate' });
    s().setAnnotationTool('none');
    s().setAnnotationZoneShape('free');
  });

  it('arms the matching annotation tool, keeping each key its cross-mode meaning', () => {
    RUN['tool.brush']!(ctx);
    RUN['tool.line']!(ctx);
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationZoneShape).toBe('line');
    RUN['tool.curve']!(ctx);
    expect(s().annotationZoneShape).toBe('curve');
    RUN['tool.eraser']!(ctx);
    expect(s().annotationTool).toBe('erase');
  });

  it('the two keys with no annotate twin carry the chip and the route', () => {
    RUN['tool.edgecut']!(ctx);
    expect(s().annotationTool).toBe('chip');
    RUN['tool.smart']!(ctx);
    expect(s().annotationTool).toBe('route');
    RUN['tool.smart']!(ctx);
    expect(s().annotationTool).toBe('none');
  });

  it('select-all means the NOTES: the drawing tool goes away and every note joins', () => {
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setEditMode({ mode: 'annotate' });
    s().addAnnotation({ kind: 'chip', id: 't1', x: 5.5, y: 5.5, tag: 'plaza', size: 'm', color: '#FFB347' });
    s().addAnnotation({ kind: 'chip', id: 't2', x: 8.5, y: 8.5, tag: 'farm', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('zone');
    RUN['selection.all']!(ctx);
    expect(s().annotationTool).toBe('none');
    expect(s().annotationSelection).toEqual(['t1', 't2']);
  });

  it('puts Brush down and restores its selected shape', () => {
    RUN['tool.brush']!(ctx);
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationZoneShape).toBe('free');
    RUN['tool.brush']!(ctx);
    expect(s().annotationTool).toBe('none');
    RUN['tool.brush']!(ctx);
    RUN['tool.rect']!(ctx);
    RUN['tool.circle']!(ctx);
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationZoneShape).toBe('circle');
    RUN['tool.eraser']!(ctx);
    RUN['tool.brush']!(ctx);
    expect(s().annotationZoneShape).toBe('circle');
  });
});
