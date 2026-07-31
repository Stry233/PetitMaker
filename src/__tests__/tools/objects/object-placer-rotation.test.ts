// Rotating an armed item's ghost BEFORE placement (the rotate shortcuts turn the pending
// placement, not the map): the ghost's footprint must swap extents with `getRotatedSize`, the
// validity preview must follow, the eventual placement must land at the pending rotation, and the
// rotation must survive across consecutive placements (fences at the same angle) while resetting
// the moment the armed item changes. A non-rotatable item must ignore the shortcut with no state
// change at all, and an existing SELECTION always wins over the ghost.
import { describe, it, expect } from 'vitest';
import { ObjectPlacerTool, planPlacementGhost } from '../../../tools/objects/object-placer';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { TerrainType, type EditorEvents, type MacroCoord } from '../../../core/model/types';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from '../_tool-ctx';
import { useEditorStore } from '../../../state/store';
import { COMMAND_BY_ID } from '../../../ui/keybindings/commands';

const m = (x: number, y: number): MacroCoord => ({ x, y });
const exec = (s: any) => new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry());
const noopCtx = { openBuild: () => {}, handleTileAction: () => {}, onHelp: () => {} };

// 7x4, rotatable, plain 'flat' trait only — big enough that a 90/270 rotation visibly swaps
// the footprint's width and height.
const HOUSE = 'building-myhouse';

function reset(): void {
  useEditorStore.setState({
    gridState: null, commandExecutor: null, selectedItemId: null, placementRotation: 0, selection: [],
  });
}

function arm(id: string): void {
  useEditorStore.setState({ selectedItemId: id, placementRotation: 0, selection: [] });
}

describe('ObjectPlacerTool: rotating the ghost before placement', () => {
  it('the rotate shortcut turns the pending rotation, and the ghost footprint swaps with it', () => {
    arm(HOUSE);
    try {
      const state = makeState(30, 30);
      const ctx = makeToolCtx(state, exec(state));

      const before = planPlacementGhost(HOUSE, m(10, 10), ctx, useEditorStore.getState().placementRotation)!;
      expect(before.rotation).toBe(0);
      const beforeW = Math.max(...before.cells.map((c) => c.x)) - Math.min(...before.cells.map((c) => c.x)) + 1;
      const beforeH = Math.max(...before.cells.map((c) => c.y)) - Math.min(...before.cells.map((c) => c.y)) + 1;
      expect([beforeW, beforeH]).toEqual([7, 4]);

      COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
      expect(useEditorStore.getState().placementRotation).toBe(90);

      const after = planPlacementGhost(HOUSE, m(10, 10), ctx, useEditorStore.getState().placementRotation)!;
      expect(after.rotation).toBe(90);
      const afterW = Math.max(...after.cells.map((c) => c.x)) - Math.min(...after.cells.map((c) => c.x)) + 1;
      const afterH = Math.max(...after.cells.map((c) => c.y)) - Math.min(...after.cells.map((c) => c.y)) + 1;
      // The extents SWAP: 7 wide x 4 tall becomes 4 wide x 7 tall.
      expect([afterW, afterH]).toEqual([4, 7]);
    } finally {
      reset();
    }
  });

  it('a rotation that makes a placement illegal shows invalid before the click', () => {
    arm(HOUSE);
    try {
      // Anchored at (10,10), the house's flat-trait sweep is dx:0..w, dy:0..h off the anchor
      // (V-PLACE-TRAIT). Unrotated (7x4) that sweep reaches y<=14; rotated 90 (4x7) it reaches
      // y<=17. A raised strip at y=16 therefore sits outside the unrotated sweep but inside the
      // rotated one — so rotating alone must flip this placement from legal to illegal.
      const state = makeState(30, 30);
      for (let x = 10; x <= 14; x++) setTerrain(state, x, 16, TerrainType.Mountain, 1);
      const ctx = makeToolCtx(state, exec(state));

      const flat = planPlacementGhost(HOUSE, m(10, 10), ctx, 0)!;
      expect(flat.valid, 'unrotated: the raised strip is outside the flat-check sweep').toBe(true);

      const turned = planPlacementGhost(HOUSE, m(10, 10), ctx, 90)!;
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
      useEditorStore.setState({ placementRotation: 90 });
      const ctx = makeToolCtx(state, ex);

      new ObjectPlacerTool().onPointerDown(m(10, 10), m(10, 10), ctx);

      const placed = objectsByCatalog(state, HOUSE);
      expect(placed).toHaveLength(1);
      expect(placed[0]!.rotation).toBe(90);
    } finally {
      reset();
    }
  });

  it('the rotation persists across consecutive placements, and resets when the armed item changes', () => {
    // building-stall (unlike HOUSE) has no maxCount, so it can actually land twice — the point of
    // the persistence check (placing several fences at the same angle).
    const STALL = 'building-stall';
    arm(STALL);
    try {
      const state = makeState(40, 40);
      const ex = exec(state);
      useEditorStore.setState({ placementRotation: 90 });
      const ctx = makeToolCtx(state, ex);

      new ObjectPlacerTool().onPointerDown(m(5, 5), m(5, 5), ctx);
      // Rotation must still read 90 for the SECOND placement — placing does not reset it.
      expect(useEditorStore.getState().placementRotation).toBe(90);
      new ObjectPlacerTool().onPointerDown(m(25, 25), m(25, 25), ctx);

      const placed = objectsByCatalog(state, STALL);
      expect(placed).toHaveLength(2);
      expect(placed.every((o) => o.rotation === 90)).toBe(true);

      // Arming a different item starts fresh at its natural orientation.
      useEditorStore.getState().setSelectedItemId(HOUSE);
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
    useEditorStore.setState({
      gridState: state,
      commandExecutor: ex,
      selectedItemId: 'building-stall', // an item is ALSO armed
      placementRotation: 0,
      selection: [{ kind: 'object', id: obj.id }],
    });
    try {
      COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
      expect(state.objects.get(obj.id)?.rotation, 'the selected object turned').toBe(90);
      expect(useEditorStore.getState().placementRotation, 'the ghost did not').toBe(0);
    } finally {
      reset();
    }
  });
});
