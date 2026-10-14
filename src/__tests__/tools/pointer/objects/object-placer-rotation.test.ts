// Rotating an armed item's ghost before placement (the rotate shortcuts turn the pending
// placement, not the map): the ghost's footprint must swap extents with `getRotatedSize`, the
// validity preview must follow, the eventual placement must land at the pending rotation, and the
// rotation must survive across consecutive placements (fences at the same angle) while resetting
// the moment the armed item changes. A non-rotatable item must ignore the shortcut with no state
// change at all, and an existing selection always wins over the ghost.
import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectPlacerTool } from '../../../../tools/pointer/objects/object-placer';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { ToolType } from '../../../../state/editing/vocabulary';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, objectsByCatalog, placementHover } from '../../../_support/tool-ctx';
import { getCatalogItem } from '../../../../state/catalog';
import { useEditorStore } from '../../../../state/store';
import { COMMAND_BY_ID } from '../../../../editor/commands/commands';
import { cell, point } from '../../../_support/grid';
import { resetStore, armedEditMode } from '../../../_support/store';

beforeEach(resetStore);

const m = (x: number, y: number): MacroCoord => ({ x, y });
const exec = (s: any) => makeExecutor(s);
const noopCtx = { toggleMenu: () => {} };

// Rotatable, plain 'flat' trait only, and at least two cells wider than deep, so a 90/270
// rotation visibly swaps the footprint's width and height.
const HOUSE = 'building-myhouse';
const { width: W, height: H } = getCatalogItem(HOUSE)!;

function reset(): void {
  useEditorStore.setState({
    gridState: null, commandExecutor: null, placementRotation: 0, selection: [],
    ...armedEditMode({ item: null, tool: ToolType.ObjectPlacer }),
  });
}

function arm(id: string): void {
  useEditorStore.setState({ placementRotation: 0, selection: [], ...armedEditMode({ item: id, tool: ToolType.ObjectPlacer }) });
}

describe('ObjectPlacerTool: rotating the ghost before placement', () => {
  it('the rotate shortcut turns the pending rotation, and the ghost footprint swaps with it', () => {
    arm(HOUSE);
    try {
      const state = makeState(30, 30);
      const ctx = makeToolCtx(state, exec(state));

      const before = placementHover(HOUSE, m(10, 10), ctx, useEditorStore.getState().placementRotation)!;
      expect(before.rotation).toBe(0);
      const beforeW = Math.max(...before.cells.map((c) => c.x)) - Math.min(...before.cells.map((c) => c.x)) + 1;
      const beforeH = Math.max(...before.cells.map((c) => c.y)) - Math.min(...before.cells.map((c) => c.y)) + 1;
      expect([beforeW, beforeH]).toEqual([W, H]);

      COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
      expect(useEditorStore.getState().placementRotation).toBe(90);

      const after = placementHover(HOUSE, m(10, 10), ctx, useEditorStore.getState().placementRotation)!;
      expect(after.rotation).toBe(90);
      const afterW = Math.max(...after.cells.map((c) => c.x)) - Math.min(...after.cells.map((c) => c.x)) + 1;
      const afterH = Math.max(...after.cells.map((c) => c.y)) - Math.min(...after.cells.map((c) => c.y)) + 1;
      // The extents swap: W wide x H tall becomes H wide x W tall.
      expect([afterW, afterH]).toEqual([H, W]);
    } finally {
      reset();
    }
  });

  it('a rotation that makes a placement illegal shows invalid before the click', () => {
    arm(HOUSE);
    try {
      // Anchored at (10,10), the house's flat-trait sweep is dx:0..w, dy:0..h off the anchor
      // (V-PLACE-TRAIT). Unrotated that sweep reaches y<=10+H; rotated 90 it reaches y<=10+W.
      // A raised strip at y=10+H+2 therefore sits outside the unrotated sweep but inside the
      // rotated one — so rotating alone must flip this placement from legal to illegal.
      const stripY = 10 + H + 2;
      expect(stripY).toBeLessThanOrEqual(10 + W);
      const state = makeState(30, 30);
      for (let x = 10; x <= 10 + H; x++) setTerrain(state, x, stripY, TerrainType.Mountain, 1);
      const ctx = makeToolCtx(state, exec(state));

      const flat = placementHover(HOUSE, m(10, 10), ctx, 0)!;
      expect(flat.valid, 'unrotated: the raised strip is outside the flat-check sweep').toBe(true);

      const turned = placementHover(HOUSE, m(10, 10), ctx, 90)!;
      expect(turned.valid, 'rotated 90: the sweep now reaches the raised strip').toBe(false);
    } finally {
      reset();
    }
  });

  it('a placement lands at the pending rotation', () => {
    arm(HOUSE);
    try {
      const state = makeState(30, 30);
      const ex = exec(state);
      const ctx = makeToolCtx(state, ex, 1, 1, { armedItem: HOUSE, placementRotation: 90 });

      new ObjectPlacerTool().onPointerDown(cell(m(10, 10)), point(m(10, 10)), ctx);

      const placed = objectsByCatalog(state, HOUSE);
      expect(placed).toHaveLength(1);
      expect(placed[0]!.rotation).toBe(90);
    } finally {
      reset();
    }
  });

  it('the rotation persists across consecutive placements, and resets when the armed item changes', () => {
    // building-stall (unlike `HOUSE`) has no maxCount, so it can actually land twice — the point of
    // the persistence check (placing several fences at the same angle).
    const STALL = 'building-stall';
    arm(STALL);
    try {
      const state = makeState(40, 40);
      const ex = exec(state);
      useEditorStore.setState({ placementRotation: 90 });
      const ctx = makeToolCtx(state, ex, 1, 1, { armedItem: STALL, placementRotation: 90 });

      new ObjectPlacerTool().onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
      // Rotation must still read 90 for the second placement — placing does not reset it.
      expect(useEditorStore.getState().placementRotation).toBe(90);
      new ObjectPlacerTool().onPointerDown(cell(m(25, 25)), point(m(25, 25)), ctx);

      const placed = objectsByCatalog(state, STALL);
      expect(placed).toHaveLength(2);
      expect(placed.every((o) => o.rotation === 90)).toBe(true);

      // Arming a different item starts fresh at its natural orientation. Through `setEditMode`
      // itself, not the `arm()` fixture helper (which hardcodes 0 regardless) — this is the actual
      // reset path a real re-pick exercises, keyed on the previous armed item (`STALL`) changing.
      useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: HOUSE } });
      expect(useEditorStore.getState().placementRotation).toBe(0);
    } finally {
      reset();
    }
  });

  it('a non-rotatable item ignores the shortcut entirely (no state change)', () => {
    arm('tree-apple'); // catalog: rotatable false
    try {
      COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
      expect(useEditorStore.getState().placementRotation).toBe(0);
      COMMAND_BY_ID.get('selection.rotate_ccw')!.run(noopCtx);
      expect(useEditorStore.getState().placementRotation).toBe(0);
    } finally {
      reset();
    }
  });

  it('precedence: a non-empty selection turns the SELECTED object, not the armed ghost', () => {
    const state = makeState(20, 20);
    const ex = exec(state);
    const obj = {
      id: 'sel-1', catalogId: HOUSE, position: { x: 5, y: 5 }, rotation: 0 as const,
      elevation: 0,
    };
    state.objects.set(obj.id, obj);
    useEditorStore.setState({ gridState: state, commandExecutor: ex, // an item is also armed
      placementRotation: 0, selection: [{ kind: 'object', id: obj.id }], ...armedEditMode({
        item: 'building-stall', tool: ToolType.ObjectPlacer,
      }) });
    try {
      COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
      expect(state.objects.get(obj.id)?.rotation, 'the selected object turned').toBe(90);
      expect(useEditorStore.getState().placementRotation, 'the ghost did not').toBe(0);
    } finally {
      reset();
    }
  });
});
