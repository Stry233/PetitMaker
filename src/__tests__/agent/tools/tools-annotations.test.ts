import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { makeTemplate } from '../../rules/_helpers';
import { makePanelToolDeps } from '../../../ui/agent/panel-runner';
import { buildMapContext, executeToolCall, TOOL_SCHEMAS, WRITE_TOOLS } from '../../../agent/tools';
import type { AgentToolDeps } from '../../../agent/tools';

const s = () => useEditorStore.getState();
let deps: AgentToolDeps;
const run = (name: string, input: Record<string, unknown> = {}) => executeToolCall({ id: 'call', name, input }, deps);
const zone = { kind: 'zone', tag: null, cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }] };

beforeEach(() => {
  s().initMap(makeTemplate(20, 20), createDefaultRegistry());
  s().setRegion([]);
  deps = makePanelToolDeps({ vision: false });
});

describe('assistant annotation tools', () => {
  it('advertises read and gated write tools and explains the separate layer in map context', () => {
    expect(TOOL_SCHEMAS.map(t => t.name)).toEqual(expect.arrayContaining(['get_annotations', 'set_annotation', 'remove_annotation']));
    expect(WRITE_TOOLS.has('get_annotations')).toBe(false);
    expect(WRITE_TOOLS.has('set_annotation')).toBe(true);
    expect(WRITE_TOOLS.has('remove_annotation')).toBe(true);
    expect(buildMapContext(s().gridState!, [], deps)).toContain('Planning annotations: 0');
  });

  it('creates, reads, updates and removes notes through reversible editor history', async () => {
    const created = await run('set_annotation', zone);
    expect(created.isError).toBe(false);
    const note = JSON.parse(created.content);
    expect(JSON.parse((await run('get_annotations')).content).items).toEqual([note]);
    expect((await run('set_annotation', { id: note.id, tag: 'garden' })).isError).toBe(false);
    expect(s().gridState!.annotations!.items[0]).toMatchObject({ id: note.id, tag: 'garden', cells: zone.cells });
    s().undoAnnotation(); expect(s().gridState!.annotations!.items[0]).toMatchObject({ tag: null });
    s().redoAnnotation(); expect(s().gridState!.annotations!.items[0]).toMatchObject({ tag: 'garden' });
    expect((await run('remove_annotation', { id: note.id })).isError).toBe(false);
    expect(s().gridState!.annotations!.items).toEqual([]);
    s().undoAnnotation(); expect(s().gridState!.annotations!.items).toHaveLength(1);
    expect(s().commandExecutor!.getUndoStackSize()).toBe(0);
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
    const created = JSON.parse((await run('set_annotation', zone)).content);
    s().setRegion([{ x: 2, y: 2 }]); deps = makePanelToolDeps({ vision: false });
    expect((await run('remove_annotation', { id: created.id })).isError).toBe(true);
    expect((await run('set_annotation', { id: created.id, cells: [{ x: 2, y: 2 }] })).isError).toBe(true);
    s().setRegion(zone.cells); deps = makePanelToolDeps({ vision: false });
    expect((await run('set_annotation', { id: created.id, cells: [{ x: 6, y: 2 }] })).isError).toBe(true);
    expect((await run('remove_annotation', { id: created.id })).isError).toBe(false);
  });

  it('accepts a route when its full path lies inside the selected region', async () => {
    s().setRegion(Array.from({ length: 5 }, (_, i) => ({ x: i + 2, y: 2 })));
    deps = makePanelToolDeps({ vision: false });
    expect((await run('set_annotation', { kind: 'route', points: [{ x: 2, y: 2 }, { x: 6, y: 2 }] })).isError).toBe(false);
  });

  it('checks the space between route endpoints instead of only the endpoints', async () => {
    s().setRegion([{ x: 2, y: 2 }, { x: 6, y: 2 }]); deps = makePanelToolDeps({ vision: false });
    expect((await run('set_annotation', { kind: 'route', points: [{ x: 2, y: 2 }, { x: 6, y: 2 }] })).isError).toBe(true);
  });
});
