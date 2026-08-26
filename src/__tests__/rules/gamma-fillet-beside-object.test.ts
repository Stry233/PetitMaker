/*
 * V-PLACE-BLOCK over a Γ fillet (#18): a tree standing on the ground beside a 1-layer mountain
 * refused the mountain's notch its fillet, because the rule judged the fillet by its whole CELL.
 *
 * The geometry is the reported map, minimised: mountain@1 at (11,3), (12,3), (12,4) wraps the
 * empty cell (11,4) at its TR corner; the tree stands at (10,4). Terrain sits half a tile up-left
 * of the object grid, so cell (11,4) spans [10.5, 11.5] x [3.5, 4.5] and the tree's [10, 11] x
 * [4, 5] does overlap it — but only in its BL quadrant, three quadrants away from the TR fillet.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { EdgeCutTool } from '../../tools/edge-cut/edge-cut-tool';
import { applyAutoEdgeCut } from '../../tools/edge-cut/auto-edge-cut';
import { getCell } from '../../core/model/grid-model';
import { roadLookup } from '../../state/object-index';
import { makeState, setTerrain, makeObject, paintCmd } from './_helpers';
import { makeToolCtx } from '../tools/_tool-ctx';
import {
  CommandType, TerrainType,
  type Corners, type EditorEvents, type GridState, type TrimCornersCommand, type ValidationError,
} from '../../core/model/types';

/** The reported notch: an L of mountain@1 wrapping the empty cell (11,4) at its TR corner. */
function notchState(): GridState {
  const state = makeState(20, 20);
  setTerrain(state, 11, 3, TerrainType.Mountain, 1);
  setTerrain(state, 12, 3, TerrainType.Mountain, 1);
  setTerrain(state, 12, 4, TerrainType.Mountain, 1);
  return state;
}

/** A standing cosmetic Γ patch: tier `elev` over a `base` support block, carrying `corners`. */
function setPatch(
  state: GridState, x: number, y: number, elev: number, corners: Corners, base = 0,
): void {
  const cell = state.cells[y]?.[x];
  if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: elev, patchOnly: true, corners, patchBase: base };
}

function addTree(state: GridState, x: number, y: number, id = 'tree-peach'): void {
  const obj = { ...makeObject('tree-peach', x, y), id };
  state.objects.set(obj.id, obj);
}

/** The patchOnly trim the edge-cut tool issues for a fillet at `cornerIdx` of (x,y). */
function filletCmd(x: number, y: number, cornerIdx: number): TrimCornersCommand {
  const after: Corners = ['empty', 'empty', 'empty', 'empty'];
  after[cornerIdx] = 'fan';
  return {
    type: CommandType.TrimCorners, timestamp: 0,
    x, y, layer: 'terrain', afterCorners: after,
    patchOnly: true, terrainType: TerrainType.Mountain, elevation: 1, patchBase: 0,
  } as TrimCornersCommand;
}

function blockErrors(state: GridState, cmd: TrimCornersCommand): ValidationError[] {
  return createDefaultRegistry().validatePreCommand(cmd, state)
    .filter((e) => e.ruleId === 'V-PLACE-BLOCK');
}

describe('V-PLACE-BLOCK — a Γ fillet is judged by its corner quadrant, not its cell', () => {
  it('a 1x1 object blocks exactly the two-by-two of quadrants it covers', () => {
    // The tree at (10,4) covers the BR quadrant of cell (10,4), the BL of (11,4),
    // the TR of (10,5) and the TL of (11,5) — together exactly its own footprint.
    const blocked: Record<string, number> = { '10,4': 3, '11,4': 2, '10,5': 1, '11,5': 0 };
    for (const [key, blockedCorner] of Object.entries(blocked)) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      for (let corner = 0; corner < 4; corner++) {
        const state = makeState(20, 20);
        addTree(state, 10, 4);
        const errs = blockErrors(state, filletCmd(x, y, corner));
        expect(errs.length > 0, `cell (${x},${y}) corner ${corner}`).toBe(corner === blockedCorner);
      }
    }
  });

  it('a patch RAISING a hidden block is judged by the whole cell', () => {
    // Materialising a patch over a real lower block carries 'square' on the corners it does not
    // fillet, and those draw at the new tier too — the notch's whole silhouette rises. Every
    // quadrant is new mass there, so the tree in any one of them still refuses it.
    const state = notchState();
    setTerrain(state, 11, 4, TerrainType.Mountain, 1);   // the hidden lower block in the notch
    addTree(state, 10, 4);
    const raise = {
      ...filletCmd(11, 4, 1),
      afterCorners: ['square', 'fan', 'square', 'square'] as Corners,
      elevation: 2, patchBase: 1,
    } as TrimCornersCommand;
    expect(blockErrors(state, raise).length, 'the tree is under the raised BL quadrant').toBe(1);
  });

  it('re-shaping a corner already drawn adds nothing, so it is never blocked', () => {
    // The patch stands at tier 2 already; cycling one corner's shape moves no mass anywhere.
    const state = notchState();
    setPatch(state, 11, 4, 2, ['square', 'fan', 'square', 'square'], 1);
    addTree(state, 10, 4);
    const reshape = {
      ...filletCmd(11, 4, 1),
      beforeCorners: ['square', 'fan', 'square', 'square'] as Corners,
      afterCorners: ['square', 'tri-NE', 'square', 'square'] as Corners,
      elevation: 2, patchBase: 1,
    } as TrimCornersCommand;
    expect(blockErrors(state, reshape)).toEqual([]);
  });

  it('RE-SEATING a patch to a taller tier is judged by every quadrant it draws', () => {
    // The auto pass re-issues a standing patch at the wrapping tier when the walls stack past it.
    // No corner's shape changes, so nothing moves horizontally — but each drawn quadrant grows a
    // taller column, and a patch is cosmetic, so an object may have arrived in one meanwhile.
    const state = notchState();
    setPatch(state, 11, 4, 1, ['empty', 'fan', 'empty', 'empty']);
    addTree(state, 11, 3);   // stands in the TR quadrant, [11,11.5] x [3.5,4]
    const reseat = {
      ...filletCmd(11, 4, 1),
      beforeCorners: ['empty', 'fan', 'empty', 'empty'] as Corners,
      elevation: 2,
    } as TrimCornersCommand;
    expect(blockErrors(state, reseat).length, 'the column grows under the object').toBe(1);
  });

  it('a re-seat still spares a quadrant the patch does not draw', () => {
    // The rise widens WHICH corners are judged, never the rect each one covers.
    const state = notchState();
    setPatch(state, 11, 4, 1, ['empty', 'fan', 'empty', 'empty']);
    addTree(state, 10, 4);   // the BL quadrant, which this patch leaves empty
    const reseat = {
      ...filletCmd(11, 4, 1),
      beforeCorners: ['empty', 'fan', 'empty', 'empty'] as Corners,
      elevation: 2,
    } as TrimCornersCommand;
    expect(blockErrors(state, reseat)).toEqual([]);
  });

  it('re-issuing a patch at its OWN tier adds nothing, so it is never blocked', () => {
    const state = notchState();
    setPatch(state, 11, 4, 1, ['empty', 'fan', 'empty', 'empty']);
    addTree(state, 11, 3);
    const same = {
      ...filletCmd(11, 4, 1),
      beforeCorners: ['empty', 'fan', 'empty', 'empty'] as Corners,
      elevation: 1,
    } as TrimCornersCommand;
    expect(blockErrors(state, same)).toEqual([]);
  });

  it('a whole-cell PAINT over the same cell stays blocked', () => {
    // The quadrant precision is the fillet's alone: a paint fills the cell, so the tree's
    // quarter of it is enough to refuse.
    const state = notchState();
    addTree(state, 10, 4);
    const errs = createDefaultRegistry()
      .validatePreCommand(paintCmd([{ x: 11, y: 4 }], TerrainType.Mountain, 1), state);
    expect(errs.some((e) => e.ruleId === 'V-PLACE-BLOCK')).toBe(true);
  });
});

describe('EdgeCutTool — the notch beside a tree (#18)', () => {
  it('rounds the mountain Γ corner the tree does not stand under', () => {
    const state = notchState();
    addTree(state, 10, 4);
    const bus = new EventBus<EditorEvents>();
    const refusals: unknown[] = [];
    bus.on('validation-failed', (e) => refusals.push(e));
    const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));

    // The intersection shared by (11,3), (12,3), (11,4), (12,4) — the L's concave corner.
    new EdgeCutTool().onPointerDown({ x: 11, y: 3 }, { x: 11, y: 3 }, makeToolCtx(state, exec));

    const patch = getCell(state.cells, 11, 4)!.terrain!;
    expect(patch.patchOnly, 'the notch took a cosmetic fillet').toBe(true);
    expect(patch.corners?.[1], 'TR corner rounded').toBe('fan');
    expect(refusals, 'nothing was refused').toEqual([]);
  });

  it('the hover ghost and the click agree — green, and the click acts', () => {
    const state = notchState();
    addTree(state, 10, 4);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    let paint: unknown = null;
    const ctx = makeToolCtx(state, exec, 1, 1, {
      overlay: { showGhost: (_c: unknown, p: unknown) => { paint = p; }, clearGhost() {} } as never,
    });
    const tool = new EdgeCutTool();

    tool.onPointerMove({ x: 11, y: 3 }, { x: 11, y: 3 }, ctx);
    expect(paint, 'ghost reads cuttable').toEqual({ icon: 'trim', valid: true });
    tool.onPointerDown({ x: 11, y: 3 }, { x: 11, y: 3 }, ctx);
    expect(getCell(state.cells, 11, 4)!.terrain!.corners?.[1]).toBe('fan');
  });

  it('still refuses a fillet whose OWN quadrant an object stands on', () => {
    // The genuinely illegal sub-case: an object on the mountain at (11,3) covers [11,12] x [3,4],
    // which is the TR quadrant of (11,4) — the very quarter the fillet's column would fill, and
    // the same quarter that already refuses a mountain paint there.
    const state = notchState();
    addTree(state, 11, 3);
    const bus = new EventBus<EditorEvents>();
    const refusals: unknown[] = [];
    bus.on('validation-failed', (e) => refusals.push(e));
    const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));

    new EdgeCutTool().onPointerDown({ x: 11, y: 3 }, { x: 11, y: 3 }, makeToolCtx(state, exec));

    expect(getCell(state.cells, 11, 4)?.terrain ?? null, 'the notch stayed open').toBe(null);
    expect(refusals.length, 'the fillet was refused').toBe(1);
  });
});

describe('auto-trim — the same notch, the same answer', () => {
  it('fills the Γ notch beside the tree', () => {
    const state = notchState();
    addTree(state, 10, 4);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    applyAutoEdgeCut(makeToolCtx(state, exec), 'round', [{ x: 11, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 4 }], []);

    const patch = getCell(state.cells, 11, 4)?.terrain;
    expect(patch?.patchOnly, 'the notch took a cosmetic fillet').toBe(true);
    expect(patch?.corners?.[1], 'TR corner rounded').toBe('fan');
  });

  it('refuses to re-seat a standing fillet taller under an object', () => {
    // The walls stack to tier 2 over a fillet already seated at tier 1, with something standing in
    // the fillet's own quadrant. The auto pass tries to re-seat; the rule refuses, so the column
    // stays where it was rather than growing through the object.
    const state = makeState(20, 20);
    for (const [x, y] of [[11, 3], [12, 3], [12, 4]] as const) setTerrain(state, x, y, TerrainType.Mountain, 2);
    setPatch(state, 11, 4, 1, ['empty', 'fan', 'empty', 'empty']);
    addTree(state, 11, 3);   // on the raised wall, over the fillet's TR quadrant
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    applyAutoEdgeCut(makeToolCtx(state, exec), 'round', [{ x: 11, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 4 }], []);

    expect(getCell(state.cells, 11, 4)?.terrain?.elevation, 'the fillet stayed at its own tier').toBe(1);
  });

  it('re-seats that same fillet when nothing stands in its quadrant', () => {
    const state = makeState(20, 20);
    for (const [x, y] of [[11, 3], [12, 3], [12, 4]] as const) setTerrain(state, x, y, TerrainType.Mountain, 2);
    setPatch(state, 11, 4, 1, ['empty', 'fan', 'empty', 'empty']);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    applyAutoEdgeCut(makeToolCtx(state, exec), 'round', [{ x: 11, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 4 }], []);

    expect(getCell(state.cells, 11, 4)?.terrain?.elevation, 'the fillet followed the walls up').toBe(2);
  });
});
