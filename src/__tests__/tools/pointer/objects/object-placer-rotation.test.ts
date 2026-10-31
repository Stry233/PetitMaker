// The rotate shortcuts turn an armed item's pending placement: the ghost and its validity follow,
// placements land at that rotation and keep it until the armed item changes, and a selection wins.
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

// Rotatable, with the flat trait, and at least three cells wider than deep (the strip case needs it).
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
  it('[EDIT-31] the rotate shortcut turns the pending rotation, and the ghost footprint swaps with it', () => {
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
      expect([afterW, afterH]).toEqual([H, W]);
    } finally {
      reset();
    }
  });

  it('a rotation that makes a placement illegal shows invalid before the click', () => {
    arm(HOUSE);
    try {
      // The flat-trait sweep (V-PLACE-TRAIT) reaches y = 10 + H unrotated and y = 10 + W rotated 90.
      // A strip at y = 10 + H + 3 is outside the first, past the door's rise depth (V-PLACE-DOOR),
      // and inside the second.
      const stripY = 10 + H + 3;
      expect(stripY).toBeLessThanOrEqual(10 + W);
      const state = makeState(30, 30);
      for (let x = 10; x <= 10 + H; x++) setTerrain(state, x, stripY, TerrainType.Mountain, 1);
      const ctx = makeToolCtx(state, exec(state));

      // The pointer holds the footprint's centre cell (EDIT-51), so both footprints start at (10, 10).
      const held = (w: number, h: number) => m(10 + Math.floor((w - 1) / 2), 10 + Math.floor((h - 1) / 2));
      const flat = placementHover(HOUSE, held(W, H), ctx, 0)!;
      expect(flat.cells[0]).toEqual(m(10, 10));
      expect(flat.valid, 'unrotated: the raised strip is outside the flat-check sweep').toBe(true);

      const turned = placementHover(HOUSE, held(H, W), ctx, 90)!;
      expect(turned.cells[0]).toEqual(m(10, 10));
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

  it('[EDIT-31] the rotation persists across consecutive placements, and resets when the armed item changes', () => {
    // Unlike `HOUSE`, the stall has no `maxCount`, so it can land twice.
    const STALL = 'building-stall';
    arm(STALL);
    try {
      const state = makeState(40, 40);
      const ex = exec(state);
      useEditorStore.setState({ placementRotation: 90 });
      const ctx = makeToolCtx(state, ex, 1, 1, { armedItem: STALL, placementRotation: 90 });

      new ObjectPlacerTool().onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
      expect(useEditorStore.getState().placementRotation).toBe(90);
      new ObjectPlacerTool().onPointerDown(cell(m(25, 25)), point(m(25, 25)), ctx);

      const placed = objectsByCatalog(state, STALL);
      expect(placed).toHaveLength(2);
      expect(placed.every((o) => o.rotation === 90)).toBe(true);

      // Through `setEditMode`, the real re-pick path; `arm()` would set 0 regardless.
      useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: HOUSE } });
      expect(useEditorStore.getState().placementRotation).toBe(0);
    } finally {
      reset();
    }
  });

  it('a non-rotatable item ignores the shortcut entirely (no state change)', () => {
    arm('tree-apple'); // not rotatable
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
