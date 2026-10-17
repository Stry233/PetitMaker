// @vitest-environment jsdom
/**
 * A visitor's save written before the plaza moved, opened through the import path: the repair is
 * asked before anything opens, repairs automatically in one undo step, or by hand, where only
 * the beds under the plaza take presses and each one counts as repaired once the placement rules
 * accept it where it stands; Cancel brings back the map that was open before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectImportFile } from '../../../io/import/file';
import { commitImport } from '../../../editor/session/import-flow';
import {
  cancelRepair, finishRepair, installRepairWatch, repairAutomatically, repairByHand, repairTheRest,
} from '../../../editor/session/landmark-repair';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { moveGroup } from '../../../tools/objects';
import { createDefaultRegistry } from '../../../rules';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { readRestorableAutosave } from '../../../io/storage/autosave';
import { restoreSession } from '../../../editor/session/restore';
import { pointerTarget } from '../../../view/interaction/selection-hover';
import { mapPoint } from '../../../core/grid/grids';
import { objectRect } from '../../../state/object-geometry';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { TerrainType } from '../../../core/model/types';
import { serialize } from '../../../io/save/json-codec';
import { getMapTemplate } from '../../../config/maps';

// Each case reads and plans a whole visitor's map, which outlasts the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const FILE = join(__dirname, '..', '..', 'fixtures', 'saves', 'hexia-plaza-frame-1.5.557.json.gz');
const store = () => useEditorStore.getState();
const ruleIds = () => createDefaultRegistry().validatePostStroke(store().gridState!).map((v) => v.ruleId);

let toasts: string[] = [];
let stops: (() => void)[] = [];
beforeEach(() => {
  newMap(editorPort, 'hexia');
  toasts = [];
  stops = [setToastPresenter((text) => { toasts.push(text); }), installRepairWatch()];
});
afterEach(() => {
  if (store().repairSession) cancelRepair();
  for (const stop of stops) stop();
});

/** The hand repair under way. */
const hand = () => {
  const session = store().repairSession;
  if (session?.phase !== 'hand') throw new Error('no hand repair');
  return session;
};

/** The hand repair's count re-reads once a frame after an edit, so the test waits for it. */
async function leftBecomes(n: number): Promise<void> {
  for (let i = 0; i < 100 && hand().left.length !== n; i++) await new Promise((r) => setTimeout(r, 20));
  expect(hand().left).toHaveLength(n);
}

async function importSave(): Promise<void> {
  await importText(gunzipSync(readFileSync(FILE)).toString('utf8'));
}

async function importText(text: string): Promise<void> {
  const blob = new Blob([text], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'hexia.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'hexia.json', file: blob });
}

describe('importing a save written before the plaza moved', () => {
  it('asks how to repair it over the open map, the beds taken off the decoded one', async () => {
    const before = store().gridState;
    await importSave();
    const session = store().repairSession!;
    if (session.phase !== 'choose') throw new Error(session.phase);
    expect(store().gridState).toBe(before);
    expect(store().modals.landmarkRepair).toBe(true);
    expect(session.pending.objects.size).toBe(1271 - 89 + 2);
    expect(toasts.some((t) => t.includes('fixed buildings'))).toBe(false);
  });

  it('repairs automatically in one undo step, with no notice after it', async () => {
    await importSave();
    const objects = 1271 - 89 + 2;
    expect(repairAutomatically()).toEqual({ moved: 89, removed: 0, unplanned: 0 });
    expect(store().repairSession).toBeNull();
    expect(store().gridState!.objects.size).toBe(objects + 89);
    expect(ruleIds()).toEqual([]);
    expect(toasts.filter((t) => t.includes('Neighbor Center'))).toEqual([]);
    store().commandExecutor!.undo();
    expect(store().gridState!.objects.size).toBe(objects);
  });

  it('repairs by hand: only the objects against the rules take presses, each is repaired once it stands legally, and Finish ends it', async () => {
    await importSave();
    repairByHand();
    const state = store().gridState!;
    expect(hand().phase).toBe('hand');
    expect(hand().left).toHaveLength(89);
    // A press on the plaza over a bed lands on the bed; one on the plaza alone lands on nothing.
    const bed = state.objects.get(hand().left[0]!)!;
    const r = objectRect(bed);
    expect(pointerTarget(state, mapPoint({ x: r.x + 0.5, y: r.y + 0.5 })).hit?.id).toBe(bed.id);
    const plaza = templateAnchor(state.template)!;
    expect(pointerTarget(state, mapPoint({ x: plaza.x + plaza.width / 2, y: plaza.y + plaza.height / 2 })).hit).toBeNull();
    store().setEditMode({ mode: 'mountain' });
    expect(store().editMode.mode).toBeNull();

    // A bed moved to where its plan puts it is repaired; undo makes it a problem again.
    const plan = hand().report.plan.moves.find((m) => m.id === bed.id)!;
    const to = plan.proposal.kind === 'group-shift' ? plan.proposal.to.position : null;
    expect(moveGroup(store().commandExecutor!, state, [bed.id], { dx: to!.x - bed.position.x, dy: to!.y - bed.position.y }).moved).toBe(1);
    await leftBecomes(88);
    expect(finishRepair()).toBe(false);
    store().commandExecutor!.undo();
    await leftBecomes(89);

    expect(repairTheRest()).toEqual({ moved: 89, removed: 0, unplanned: 0 });
    await leftBecomes(0);
    expect(finishRepair()).toBe(true);
    expect(store().repairSession).toBeNull();
    expect(store().gridState!.unsettled).toBeUndefined();
    expect(ruleIds()).toEqual([]);
  });

  it('asks the same on a resumed session', async () => {
    localStorage.setItem(PREFS.autosave.key, gunzipSync(readFileSync(FILE)).toString('utf8'));
    const offer = readRestorableAutosave()!;
    const before = store().gridState;
    restoreSession(offer);
    expect(store().repairSession?.phase).toBe('choose');
    expect(store().gridState).toBe(before);
    cancelRepair();
    expect(store().gridState).toBe(before);
  });

  it('asks too when the only change is terrain of the map under the plaza, and not for a map with none', async () => {
    const state = createGridState(getMapTemplate('hexia'));
    const a = templateAnchor(state.template)!;
    const cell = state.cells[Math.floor(a.y) + 3]![Math.floor(a.x) + 3]!;
    cell.terrain = { type: TerrainType.Mountain, elevation: 3 };
    await importText(serialize(state));
    expect(store().repairSession?.phase).toBe('choose');
    expect(store().repairSession!.report.objects).toEqual([]);
    expect(store().repairSession!.report.terrain.some((t) => t.before !== null)).toBe(true);
    cancelRepair();
    await importText(serialize(createGridState(getMapTemplate('hexia'))));
    expect(store().repairSession).toBeNull();
    expect(store().modals.landmarkRepair).toBe(false);
  });

  it('cancels back to the map that was open before', async () => {
    const before = store().gridState;
    await importSave();
    repairByHand();
    cancelRepair();
    expect(store().repairSession).toBeNull();
    expect(store().gridState).toBe(before);
  });
});
