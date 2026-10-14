/**
 * The keymap declares what commands exist and `RUN` what they do; `RUN` is keyed by `RunCommandId`, so
 * the compiler holds the two halves to each other and these pin how `COMMANDS` zips them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { COMMAND_META } from '../../../state/keymap/registry';
import { COMMANDS, hasRunBody, RUN } from '../../../editor/commands/commands';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { makeTemplate } from '../../_support/map-state';

describe('command registry', () => {
  it('runs each discrete command through its RUN body', () => {
    for (const cmd of COMMANDS) {
      if (hasRunBody(cmd.id)) expect(cmd.run, cmd.id).toBe(RUN[cmd.id]);
    }
  });

  it('gives held and listener commands no body, so the discrete engine leaves their keys alone', () => {
    const elsewhere = COMMAND_META.filter((c) => c.continuous || c.listener).map((c) => c.id);
    expect(elsewhere).toContain('camera.pan_up');
    expect(elsewhere).toContain('app.ui_zoom_in');
    for (const id of elsewhere) expect(hasRunBody(id), id).toBe(false);
  });
});

describe('the numbered tool keys inside annotate mode', () => {
  const s = () => useEditorStore.getState();
  const ctx = { toggleMenu: () => {} };

  beforeEach(() => {
    s().setEditMode({ mode: 'annotate' });
    s().setAnnotationTool('none');
    s().setAnnotationZoneShape('free');
  });

  it('arms the matching annotation tool, keeping each key its cross-mode meaning', () => {
    RUN['tool.brush'](ctx);
    RUN['tool.line'](ctx);
    expect(s().editMode.mode, 'a number key in annotate mode does not switch modes').toBe('annotate');
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationZoneShape).toBe('line');
    RUN['tool.curve'](ctx);
    expect(s().annotationZoneShape).toBe('curve');
    RUN['tool.erase'](ctx);
    expect(s().annotationTool).toBe('erase');
  });

  it('the two keys with no annotate twin carry the chip and the route', () => {
    RUN['tool.trim'](ctx);
    expect(s().annotationTool).toBe('chip');
    RUN['tool.smart'](ctx);
    expect(s().annotationTool).toBe('route');
    RUN['tool.smart'](ctx);
    expect(s().annotationTool).toBe('none');
  });

  it('select-all means the NOTES: the drawing tool goes away and every note joins', () => {
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setEditMode({ mode: 'annotate' });
    s().addAnnotation({ kind: 'chip', id: 't1', x: 5.5, y: 5.5, tag: 'plaza', size: 'm', color: '#FFB347' });
    s().addAnnotation({ kind: 'chip', id: 't2', x: 8.5, y: 8.5, tag: 'farm', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('zone');
    RUN['selection.all'](ctx);
    expect(s().annotationTool).toBe('none');
    expect(s().annotationSelection).toEqual(['t1', 't2']);
  });

  it('puts Brush down and restores its selected shape', () => {
    RUN['tool.brush'](ctx);
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationZoneShape).toBe('free');
    RUN['tool.brush'](ctx);
    expect(s().annotationTool).toBe('none');
    RUN['tool.brush'](ctx);
    RUN['tool.rect'](ctx);
    RUN['tool.circle'](ctx);
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationZoneShape).toBe('circle');
    RUN['tool.erase'](ctx);
    RUN['tool.brush'](ctx);
    expect(s().annotationZoneShape).toBe('circle');
  });
});
