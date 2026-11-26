// @vitest-environment jsdom
/**
 * A session's frame has no place for a Show me: the transition that opens it ends the Show me first,
 * with no tour surface mounted, so the map is set aside as it was lent and nothing tried comes back
 * with it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { TerrainType } from '../../../core/model/types';
import { newMap } from '../../../editor/operations';
import { enterPlanetSession, leavePlanetSession } from '../../../editor/operations/planet-session';
import { editorPort } from '../../../editor/session/context';
import { commitImport } from '../../../editor/session/import-flow';
import { cancelRepair, repairByHand } from '../../../editor/session/landmark-repair';
import { startTour } from '../../../editor/session/tour';
import { inspectImportFile } from '../../../io/import/file';
import { serialize } from '../../../io/save/json-codec';
import { PREFS } from '../../../platform/storage/prefs';
import { tourOpenable } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { paintCmd } from '../../_support/map-state';

const s = () => useEditorStore.getState();

/** A Show me standing on the live map with a mode posed and a mountain cell tried. */
function tryInShowMe(): void {
  s().setEditMode({ mode: null });
  s().startTour(2);
  s().setTourPhase({ kind: 'show', card: 1, step: 0 });
  s().poseTour({ mode: 'mountain' });
  const plaza = templateAnchor(s().gridState!.template)!;
  s().commandExecutor!.execute(paintCmd([{ x: Math.floor(plaza.x) - 6, y: Math.floor(plaza.y) + 3 }], TerrainType.Mountain, 1));
  expect(s().commandExecutor!.historyDepth(), 'the try is a step on the lent map').toBe(1);
  expect(s().tourBorrow).not.toBeNull();
}

/** Opens a save with a tree under the plaza, which asks its repair. */
async function askRepair(): Promise<void> {
  const state = createGridState(getMapTemplate('hexia'));
  const plaza = templateAnchor(state.template)!;
  state.objects.set('tree', { id: 'tree', catalogId: 'tree-apple', position: { x: Math.floor(plaza.x) + 3, y: Math.floor(plaza.y) + 3 }, rotation: 0, elevation: 0 });
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'save.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'save.json', file: blob });
}

beforeEach(() => {
  localStorage.removeItem(PREFS.tourSeen.key);
  newMap(editorPort, 'hexia');
});
afterEach(() => {
  if (s().repairSession) cancelRepair();
  if (s().planetSession) leavePlanetSession(editorPort);
  s().finishTour();
});

describe('a session frame opening over a Show me', () => {
  it('[UI-47] a hand repair ends the Show me for its card and parks the map as it was lent', async () => {
    const lent = s().gridState;
    tryInShowMe();
    await askRepair();
    expect(repairByHand()).toBe(true);
    expect(s().tourPhase).toEqual({ kind: 'deck', card: 1 });
    expect(s().tourBorrow).toBeNull();

    cancelRepair();
    expect(s().gridState).toBe(lent);
    expect(s().commandExecutor!.historyDepth(), 'nothing tried came back with the map').toBe(0);
    expect(s().editMode.mode).toBeNull();
  });

  it('[UI-47] a planet canvas ends the Show me for its card and parks the map as it was lent', () => {
    const lent = s().gridState;
    tryInShowMe();
    enterPlanetSession(editorPort, null);
    expect(s().planetSession).not.toBeNull();
    expect(s().tourPhase).toEqual({ kind: 'deck', card: 1 });
    expect(s().tourBorrow).toBeNull();
    expect(s().planetSession!.parked.editMode.mode).toBeNull();

    leavePlanetSession(editorPort);
    expect(s().gridState).toBe(lent);
    expect(s().commandExecutor!.historyDepth()).toBe(0);
  });

  it('[UI-74] the welcome tips do not start while a session holds the map', async () => {
    await askRepair();
    expect(repairByHand()).toBe(true);
    expect(tourOpenable(s())).toBe(false);
    expect(startTour()).toBe(false);
    expect(s().tourRunning).toBe(false);
    cancelRepair();
    expect(tourOpenable(s())).toBe(true);
  });
});
