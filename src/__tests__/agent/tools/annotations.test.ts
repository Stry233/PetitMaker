import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { makeTemplate } from '../../_support/map-state';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { makeToolDeps } from '../../../agent/exec/tool-deps';
import { buildMapContext, executeToolCall, TOOL_FACTS, wireSchemas } from '../../../agent/tools';
import { writesMap } from '../../../agent/core/tool-facts';
import type { AgentToolDeps } from '../../../agent/tools';

const s = () => useEditorStore.getState();
let deps: AgentToolDeps;
const run = (name: string, input: Record<string, unknown> = {}) => executeToolCall({ id: 'call', name, input }, deps);
const zone = { kind: 'zone', tag: null, cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }] };

beforeEach(() => {
  s().initMap(makeTemplate(20, 20), createDefaultRegistry());
  s().setRegion([]);
  deps = makeToolDeps({ vision: false, session: agentSessionPort });
});

describe('assistant annotation tools', () => {
  it('advertises read and gated write tools and explains the separate layer in map context', () => {
    expect(wireSchemas().map(t => t.name)).toEqual(expect.arrayContaining(['get_annotations', 'set_annotation', 'remove_annotation']));
    expect(writesMap(TOOL_FACTS, 'get_annotations')).toBe(false);
    expect(writesMap(TOOL_FACTS, 'set_annotation')).toBe(true);
    expect(writesMap(TOOL_FACTS, 'remove_annotation')).toBe(true);
    expect(buildMapContext(s().gridState!, [], deps)).toContain('Planning annotations: 0');
  });

  it('creates, reads, updates and removes notes through reversible editor history', async () => {
    const created = await run('set_annotation', zone);
    expect(created.isError).toBe(false);
    const note = s().gridState!.annotations!.items[0]!;
    expect(created.content).toContain(`id=${note.id}: 2 cells`);
    expect(JSON.parse((await run('get_annotations', { id: note.id })).content)).toEqual(note);
    expect((await run('set_annotation', { id: note.id, tag: 'garden' })).isError).toBe(false);
    expect(s().gridState!.annotations!.items[0]).toMatchObject({ id: note.id, tag: 'garden', cells: zone.cells });
    s().undoAnnotation(); expect(s().gridState!.annotations!.items[0]).toMatchObject({ tag: null });
    s().redoAnnotation(); expect(s().gridState!.annotations!.items[0]).toMatchObject({ tag: 'garden' });
    expect((await run('remove_annotation', { id: note.id })).isError).toBe(false);
    expect(s().gridState!.annotations!.items).toEqual([]);
    s().undoAnnotation(); expect(s().gridState!.annotations!.items).toHaveLength(1);
    expect(s().commandExecutor!.historyDepth()).toBe(0);
  });

  it.each([
    { kind: 'chip', tag: 'homes', x: 3.5, y: 4 },
    { kind: 'route', points: [{ x: 3.5, y: 4 }, { x: 6, y: 8 }], dashed: false },
    { kind: 'measure', points: [{ x: 3, y: 4 }, { x: 6, y: 4 }], flipped: true },
  ])('creates a $kind annotation', async (input) => {
    expect((await run('set_annotation', input)).isError).toBe(false);
    expect(s().gridState!.annotations!.items[0]).toMatchObject(input);
  });

  it.each([
    { kind: 'zone', cells: [] },
    { ...zone, cells: [{ x: 1.5, y: 2 }] },
    { ...zone, tag: 'arbitrary text' },
    { kind: 'chip', tag: null, x: 2, y: 2 },
    { kind: 'chip', tag: 'homes', x: Infinity, y: 2 },
    { kind: 'measure', points: [{ x: 2, y: 2 }, { x: 4, y: 4 }] },
    { kind: 'route', points: [{ x: 2, y: 2 }, { x: 25, y: 2 }] },
  ])('refuses invalid geometry or vocabulary without editing history', async (input) => {
    expect((await run('set_annotation', input)).isError).toBe(true);
    expect(s().annotationUndoLane).toEqual([]);
  });

  it('respects layer locks, visibility, map identity and the user draft', async () => {
    s().setAnnotationDraft({ ...zone, kind: 'zone', id: 'draft', color: '#FF8A7A', num: 1 });
    const draft = structuredClone(s().annotationDraft);
    s().setAnnotationsLocked(true);
    expect((await run('set_annotation', zone)).isError).toBe(true);
    s().setAnnotationsLocked(false); s().setAnnotationsVisible(false);
    expect((await run('set_annotation', zone)).isError).toBe(true);
    s().setAnnotationsVisible(true);
    expect((await run('set_annotation', zone)).isError).toBe(false);
    expect(s().annotationDraft).toEqual(draft);
    expect((await run('remove_annotation', { id: 'draft' })).isError).toBe(true);
    s().initMap(makeTemplate(10, 10), createDefaultRegistry());
    expect((await run('set_annotation', zone)).isError).toBe(true);
    expect(s().gridState!.annotations?.items ?? []).toEqual([]);
  });

  it('checks both existing and replacement footprints against a selected region', async () => {
    await run('set_annotation', zone);
    const created = s().gridState!.annotations!.items[0]!;
    s().setRegion([{ x: 2, y: 2 }]); deps = makeToolDeps({ vision: false, session: agentSessionPort });
    expect((await run('remove_annotation', { id: created.id })).isError).toBe(true);
    expect((await run('set_annotation', { id: created.id, cells: [{ x: 2, y: 2 }] })).isError).toBe(true);
    s().setRegion(zone.cells); deps = makeToolDeps({ vision: false, session: agentSessionPort });
    expect((await run('set_annotation', { id: created.id, cells: [{ x: 6, y: 2 }] })).isError).toBe(true);
    expect((await run('remove_annotation', { id: created.id })).isError).toBe(false);
  });

  it('accepts a route when its full path lies inside the selected region', async () => {
    s().setRegion(Array.from({ length: 5 }, (_, i) => ({ x: i + 2, y: 2 })));
    deps = makeToolDeps({ vision: false, session: agentSessionPort });
    expect((await run('set_annotation', { kind: 'route', points: [{ x: 2, y: 2 }, { x: 6, y: 2 }] })).isError).toBe(false);
  });

  it('checks the space between route endpoints instead of only the endpoints', async () => {
    s().setRegion([{ x: 2, y: 2 }, { x: 6, y: 2 }]); deps = makeToolDeps({ vision: false, session: agentSessionPort });
    expect((await run('set_annotation', { kind: 'route', points: [{ x: 2, y: 2 }, { x: 6, y: 2 }] })).isError).toBe(true);
  });

  const ids = () => s().gridState!.annotations!.items.map((n) => n.id);
  const zoneCells = (i: number) => {
    const n = s().gridState!.annotations!.items[i]!;
    return n.kind === 'zone' ? n.cells.map((c) => `${c.x},${c.y}`).sort() : [];
  };

  it('draws a zone from shapes, a cut shape subtracting, and summarizes it instead of echoing cells', async () => {
    const result = await run('set_annotation', { tag: 'homes', shapes: [
      { type: 'rect', x1: 2, y1: 2, x2: 9, y2: 7 },
      { type: 'band', points: [{ x: 2, y: 4 }, { x: 9, y: 4 }], width: 1, cut: true },
    ] });
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/#1 homes .*: 40 cells \(2,2\)-\(9,7\), 2 pieces/);
    expect(result.content).not.toContain('"x"');
    expect(zoneCells(0)).not.toContain('5,4');
  });

  it.each([
    [{ type: 'ellipse', x1: 2, y1: 2, x2: 10, y2: 6 }, (c: string[]) => c.includes('6,4') && !c.includes('2,2')],
    [{ type: 'ring', x1: 2, y1: 2, x2: 12, y2: 12, width: 2 }, (c: string[]) => c.includes('7,2') && !c.includes('7,7')],
    [{ type: 'polygon', points: [{ x: 2, y: 2 }, { x: 10, y: 2 }, { x: 2, y: 10 }] }, (c: string[]) => c.includes('3,3') && !c.includes('9,9')],
  ])('draws a %o shape', async (shape, holds) => {
    expect((await run('set_annotation', { tag: 'garden', shapes: [shape] })).isError).toBe(false);
    expect(holds(zoneCells(0))).toBe(true);
  });

  it('leaves cells other zones hold by default, overlaps them on clip ground, and fills only unclaimed ground', async () => {
    await run('set_annotation', { tag: 'entrance', shapes: [{ type: 'rect', x1: 0, y1: 9, x2: 19, y2: 10 }] });
    const blocks = await run('set_annotation', { tag: 'homes', shapes: [{ type: 'rect', x1: 0, y1: 0, x2: 19, y2: 19 }] });
    expect(blocks.content).toContain('Clipped 40 already in other zones');
    expect(zoneCells(1)).not.toContain('5,9');
    await run('set_annotation', { tag: 'water', clip: 'ground', shapes: [{ type: 'rect', x1: 4, y1: 8, x2: 6, y2: 11 }] });
    expect(zoneCells(2)).toContain('5,9');
    await run('remove_annotation', { id: ids()[1]! });
    expect((await run('set_annotation', { tag: 'forest', shapes: [{ type: 'fill', x: 1, y: 1 }] })).isError).toBe(false);
    const fill = zoneCells(2);
    expect(fill).toContain('19,0');
    expect(fill.some((c) => c.endsWith(',9') || c.endsWith(',15'))).toBe(false);
  });

  it('grows and carves an existing zone in place', async () => {
    await run('set_annotation', { tag: 'farm', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 4, y2: 4 }] });
    const id = ids()[0]!;
    await run('set_annotation', { id, mode: 'add', shapes: [{ type: 'rect', x1: 5, y1: 2, x2: 6, y2: 4 }] });
    expect(zoneCells(0)).toHaveLength(15);
    await run('set_annotation', { id, mode: 'cut', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 2, y2: 4 }] });
    expect(zoneCells(0)).toHaveLength(12);
  });

  it('creates a custom tag once and reuses it by its text', async () => {
    await run('set_annotation', { customTag: '咖啡馆', shapes: [{ type: 'rect', x1: 1, y1: 1, x2: 3, y2: 3 }] });
    await run('set_annotation', { kind: 'chip', customTag: '咖啡馆', x: 10, y: 10 });
    const notes = s().gridState!.annotations!;
    expect(notes.customTags).toEqual([{ id: expect.stringMatching(/^custom:/), text: '咖啡馆' }]);
    expect(notes.items.map((n) => (n as { tag?: string }).tag)).toEqual([notes.customTags![0]!.id, notes.customTags![0]!.id]);
    expect((await run('get_annotations')).content).toContain('#1 咖啡馆');
    s().undoAnnotation(); s().undoAnnotation();
    expect(s().gridState!.annotations!.customTags ?? []).toEqual([]);
  });

  it('refuses shapes that leave no open ground', async () => {
    await run('set_annotation', { tag: 'homes', shapes: [{ type: 'rect', x1: 0, y1: 0, x2: 19, y2: 19 }] });
    const refused = await run('set_annotation', { tag: 'garden', shapes: [{ type: 'rect', x1: 2, y1: 2, x2: 4, y2: 4 }] });
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain('leave no cells');
  });

  it('refuses a zone larger than a save keeps', async () => {
    s().initMap(makeTemplate(80, 80), createDefaultRegistry());
    deps = makeToolDeps({ vision: false, session: agentSessionPort });
    const refused = await run('set_annotation', { tag: 'farm', shapes: [{ type: 'rect', x1: 0, y1: 0, x2: 79, y2: 79 }] });
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain('at most 5000');
  });
});
