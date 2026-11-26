/** What belongs to the map that is open: replacing it ends every transient made on it and every
 *  edit still landing on it, whichever door replaces it. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { getMapTemplate } from '../../../config/maps';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType, type GridState } from '../../../core/model/types';
import type { ParkedEditor } from '../../../state/slices/planet-session';
import { regionOf } from '../../../state/editing/region';

const s = () => useEditorStore.getState();
const house = { kind: 'object', id: 'house' } as const;

/** A map with every map-owned transient standing on it: a painted region still being painted with
 *  its own lane, a selection with its menu and delete question, a picked block and both latches. */
function standEverything(): GridState {
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  const map = s().gridState!;
  s().setSelectingRegion(true, 'generator');
  s().commitRegion([{ x: 1, y: 1 }]);
  s().commitRegion([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  s().setSelectingRegion(false);
  useEditorStore.setState({
    selection: [house], pickedCell: { x: 3, y: 3 }, multiSelectLatched: true, moveLatched: true,
    contextMenu: { x: 4, y: 4, target: house, mode: 'pc' }, deletePopover: house,
  });
  s().setSelectingRegion(true, 'generator');
  s().commitRegion([{ x: 5, y: 5 }]);
  return map;
}

/** The map-owned fields as a map just opened holds them. */
function expectFresh(): void {
  const st = s();
  expect({
    selection: st.selection, pickedCell: st.pickedCell, multiSelectLatched: st.multiSelectLatched, moveLatched: st.moveLatched,
    contextMenu: st.contextMenu, deletePopover: st.deletePopover,
    selectingRegion: st.selectingRegion, regionSelectionOwner: st.regionSelectionOwner, regions: st.regions,
    regionUndoLane: st.regionUndoLane, regionRedoLane: st.regionRedoLane,
  }).toEqual({
    selection: [], pickedCell: null, multiSelectLatched: false, moveLatched: false,
    contextMenu: null, deletePopover: null,
    selectingRegion: false, regionSelectionOwner: null, regions: {},
    regionUndoLane: [], regionRedoLane: [],
  });
}

beforeEach(resetStore);

describe('opening another map', () => {
  it('[EDIT-25] ends the region, its painting and its lane, the selection with its menu and question, the pick and the latches', () => {
    standEverything();
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    expectFresh();
  });

  it('does the same for a new map from a template', () => {
    standEverything();
    s().initMap(getMapTemplate('hexia'), createDefaultRegistry());
    expectFresh();
  });

  it('[GEN-09] cancels every edit still landing on the map it replaces, before the new one opens', () => {
    standEverything();
    const seenMap: (GridState | null)[] = [];
    const build = vi.fn(() => { seenMap.push(s().gridState); });
    const hand = vi.fn();
    const releaseBuild = holdEditInFlight(build, 'build');
    const releaseHand = holdEditInFlight(hand, 'hand');
    const old = s().gridState;
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    releaseBuild(); releaseHand();
    expect(build).toHaveBeenCalledTimes(1);
    expect(hand).toHaveBeenCalledTimes(1);
    expect(seenMap).toEqual([old]);
  });
});

describe('a parked map coming back', () => {
  it('brings back its own selection and region and nothing the map it replaces left standing', () => {
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    const parkedMap = s().gridState!;
    const parked: ParkedEditor = {
      gridState: parkedMap, executor: s().commandExecutor!, selection: [house], regions: { generator: { cells: [{ x: 7, y: 7 }], map: parkedMap } },
      editMode: s().editMode, camera2d: null, camera3d: null, viewMode: '2d',
      layerVisibility: {}, annotationUndoLane: [], annotationRedoLane: [],
    };
    standEverything();
    const cancel = vi.fn();
    const release = holdEditInFlight(cancel, 'build');
    s().restoreParkedEditor(parked);
    release();
    expect(cancel).toHaveBeenCalledTimes(1);
    const st = s();
    expect(st.gridState).toBe(parkedMap);
    expect(st.selection).toEqual([house]);
    expect(regionOf(st, 'generator')).toEqual([{ x: 7, y: 7 }]);
    expect({
      selectingRegion: st.selectingRegion, regionUndoLane: st.regionUndoLane, contextMenu: st.contextMenu,
      deletePopover: st.deletePopover, pickedCell: st.pickedCell, moveLatched: st.moveLatched,
    }).toEqual({ selectingRegion: false, regionUndoLane: [], contextMenu: null, deletePopover: null, pickedCell: null, moveLatched: false });
  });
});

describe("Generate's applied card", () => {
  /** One map step, as a card's landing records one. */
  function landStep(): void {
    s().commandExecutor!.execute(paintTerrainCommand([{ x: 2, y: 2 }], TerrainType.Mountain, 1));
  }

  it('ends when the step its card landed is undone, and stands through later steps', () => {
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    landStep();
    s().setGenerateApplied(2);
    expect(s().generateApplied?.card).toBe(2);
    s().commandExecutor!.execute(paintTerrainCommand([{ x: 5, y: 5 }], TerrainType.Mountain, 1));
    s().commandExecutor!.undo();
    expect(s().generateApplied?.card, 'a later step undone leaves the run standing').toBe(2);
    s().commandExecutor!.undo();
    expect(s().generateApplied).toBeNull();
    s().commandExecutor!.redo();
    expect(s().generateApplied, 'redo brings the run back, not the card').toBeNull();
  });

  it('ends with the map it landed on', () => {
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    landStep();
    s().setGenerateApplied(0);
    s().loadMap(makeState(16, 16), createDefaultRegistry());
    expect(s().generateApplied).toBeNull();
  });
});
