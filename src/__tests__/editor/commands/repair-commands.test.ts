// @vitest-environment jsdom
/**
 * The repair's choice, a hand repair's ways out and the note's discard question, answered by
 * command: each does what its button does and refuses where no such question stands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import type { MapAnnotation } from '../../../core/model/annotations';
import { TerrainType, type GridState } from '../../../core/model/types';
import { runCommand } from '../../../editor/commands/run';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { commitImport } from '../../../editor/session/import-flow';
import { cancelRepair, repairByHand } from '../../../editor/session/landmark-repair';
import { inspectImportFile } from '../../../io/import/file';
import { serialize } from '../../../io/save/json-codec';
import { createDefaultRegistry } from '../../../rules';
import { useEditorStore } from '../../../state/store';

const s = () => useEditorStore.getState();
const liveMap = () => s().gridState;
const violations = () => createDefaultRegistry().validatePostStroke(liveMap()!).length;

async function run(id: string, args: Record<string, unknown> = {}): Promise<string> {
  const outcome = await runCommand(id, args);
  if (!outcome.ok) throw new Error(`${id} refused: ${outcome.reason}`);
  return outcome.result;
}
const refused = async (id: string, args: Record<string, unknown> = {}) => expect(await runCommand(id, args), id).toMatchObject({ ok: false });

/** A save on Hexia changed by `change`, opened through the import path. */
async function open(change: (state: GridState, plaza: { x: number; y: number }) => void): Promise<void> {
  const state = createGridState(getMapTemplate('hexia'));
  const anchor = templateAnchor(state.template)!;
  change(state, { x: Math.floor(anchor.x) + 3, y: Math.floor(anchor.y) + 3 });
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'save.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'save.json', file: blob });
}

/** A save with a tree where the plaza stands: its repair moves an object. */
const openTreeUnderPlaza = () => open((state, at) => {
  state.objects.set('tree', { id: 'tree', catalogId: 'tree-apple', position: at, rotation: 0, elevation: 0 });
});

/** A save with a mountain where the plaza stands: its repair changes terrain alone. */
const openMountainUnderPlaza = () => open((state, at) => {
  state.cells[at.y]![at.x]!.terrain = { type: TerrainType.Mountain, elevation: 3 };
});

beforeEach(() => { newMap(editorPort, 'hexia'); });
afterEach(() => {
  if (s().repairSession) cancelRepair();
  s().cancelAnnotationDiscard();
  s().setAnnotationDraft(null);
});

describe('repair.apply', () => {
  it('[PLAN-29] opens the asked map repaired automatically, as one undo step', async () => {
    const before = liveMap();
    await refused('repair.apply', { how: 'automatic' });
    await openTreeUnderPlaza();
    expect(await run('repair.apply', { how: 'automatic' })).toContain('1 moved');
    expect(s().repairSession).toBeNull();
    expect(s().modals.landmarkRepair).toBe(false);
    expect(liveMap()).not.toBe(before);
    expect(violations()).toBe(0);
    expect(s().commandExecutor!.historyDepth()).toBe(1);
  });

  it('[PLAN-30] opens the asked map under a hand repair, and offers none where the repair moves no objects', async () => {
    await openMountainUnderPlaza();
    const before = liveMap();
    await refused('repair.apply', { how: 'by_hand' });
    expect(repairByHand(), 'the verb refuses it for every caller').toBe(false);
    expect(s().repairSession?.phase).toBe('choose');
    expect(liveMap()).toBe(before);
    cancelRepair();

    await openTreeUnderPlaza();
    await run('repair.apply', { how: 'by_hand' });
    expect(s().repairSession).toMatchObject({ phase: 'hand', left: ['tree'] });
    await refused('repair.apply', { how: 'automatic' });
  });
});

describe('repair.cancel', () => {
  it('[PLAN-31] leaves the open map at the choice, and brings it back from a hand repair', async () => {
    const before = liveMap();
    await refused('repair.cancel');
    await openTreeUnderPlaza();
    await run('repair.cancel');
    expect(s().repairSession).toBeNull();
    expect(s().modals.landmarkRepair).toBe(false);
    expect(liveMap()).toBe(before);

    await openTreeUnderPlaza();
    await run('repair.apply', { how: 'by_hand' });
    expect(liveMap()).not.toBe(before);
    await run('repair.cancel');
    expect(s().repairSession).toBeNull();
    expect(liveMap()).toBe(before);
  });
});

describe('repair.rest and repair.finish', () => {
  it('[PLAN-30] finish is refused while an object is left, the rest is repaired as one step, and finish then opens the map', async () => {
    await refused('repair.rest');
    await refused('repair.finish');
    await openTreeUnderPlaza();
    await run('repair.apply', { how: 'by_hand' });
    const under = liveMap();
    expect(await runCommand('repair.finish')).toEqual({ ok: false, reason: 'One object still stands against the rules.' });
    expect(s().repairSession?.phase).toBe('hand');

    expect(await run('repair.rest')).toContain('1 moved');
    expect(s().repairSession).toMatchObject({ phase: 'hand', left: [] });
    s().commandExecutor!.undo();
    expect(liveMap()!.objects.get('tree')!.position).toEqual(under!.objects.get('tree')!.position);
    s().commandExecutor!.redo();

    await run('repair.finish');
    expect(s().repairSession).toBeNull();
    expect(liveMap()).toBe(under);
    expect(violations()).toBe(0);
  });
});

describe('notes.discard_answer', () => {
  const draft = { id: 'draft', kind: 'chip', x: 4, y: 4, tag: 'homes' } as unknown as MapAnnotation;
  const ask = () => {
    const went = vi.fn();
    s().setAnnotationDraft(draft);
    s().requestAnnotationDiscard(went);
    expect(s().annotationDiscardAction).not.toBeNull();
    return went;
  };
  const notes = () => liveMap()!.annotations?.items.map((note) => note.id) ?? [];

  it('refuses while no unfinished note waits for an answer', async () => {
    await refused('notes.discard_answer', { answer: 'discard' });
    await refused('notes.discard_answer', { answer: 'keep' });
  });

  it('cancel keeps the note being written and drops what asked', async () => {
    const went = ask();
    await run('notes.discard_answer', { answer: 'cancel' });
    expect(went).not.toHaveBeenCalled();
    expect(s().annotationDraft).toEqual(draft);
    expect(s().annotationDiscardAction).toBeNull();
  });

  it('save puts the note on the map and goes on', async () => {
    const went = ask();
    await run('notes.discard_answer', { answer: 'save' });
    expect(went).toHaveBeenCalledTimes(1);
    expect(s().annotationDraft).toBeNull();
    expect(notes()).toEqual(['draft']);
  });

  it('discard drops the note and goes on', async () => {
    const went = ask();
    await run('notes.discard_answer', { answer: 'discard' });
    expect(went).toHaveBeenCalledTimes(1);
    expect(s().annotationDraft).toBeNull();
    expect(notes()).toEqual([]);
    expect(s().annotationDiscardAction).toBeNull();
  });
});
