import { describe, it, expect } from 'vitest';
import { cutBackingByCorner } from '../../core/edge-cut/cut-backing';
import { TerrainType } from '../../core/model/types';
import type { Corners, TerrainCell } from '../../core/model/types';

const SQUARE: Corners = ['square', 'square', 'square', 'square'];
const FAN_TL: Corners = ['fan', 'square', 'square', 'square'];
const cell = (type: TerrainType, elevation: number, corners?: Corners, patchOnly?: boolean, patchBase?: number): TerrainCell => ({ type, elevation, ...(corners ? { corners } : {}), ...(patchOnly ? { patchOnly } : {}), ...(patchBase !== undefined ? { patchBase } : {}) });

/** neighborAt over a sparse offset map, e.g. {'1,0': cell(...)} */
const at = (m: Record<string, TerrainCell>) => (dx: number, dy: number) => m[`${dx},${dy}`];

describe('cutBackingByCorner', () => {
  it('uncut cells (square / no corners) get no backing', () => {
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 3, SQUARE), 3, at({}))).toEqual([null, null, null, null]);
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 3), 3, at({}))).toEqual([null, null, null, null]);
  });

  it('Γ patch at tier N>=2: the base is a FULL block — EVERY quadrant backs with N-1, not just the fillet\'s', () => {
    const base = { type: TerrainType.Mountain, elevation: 1 };
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 2, FAN_TL, true), 2, at({}))).toEqual([base, base, base, base]);
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 4, FAN_TL, true), 4, at({}))[2]).toEqual({ type: TerrainType.Mountain, elevation: 3 });
  });

  it('Γ patch at tier 1 sits straight on the ground (no backing anywhere)', () => {
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 1, FAN_TL, true), 1, at({}))).toEqual([null, null, null, null]);
  });

  it('a from-empty gamma (patchBase 0) backs NOTHING — the notch stays open at every tier', () => {
    // The gamma the EdgeCutTool makes over an empty notch is cosmetic: patchBase 0 = no real support, so
    // no base block anywhere. Identical at N=2 and N=3 (consistency: every tier behaves like tier 1).
    const corners: Corners = ['fan', 'empty', 'empty', 'empty'];
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 2, corners, true, 0), 2, at({}))).toEqual([null, null, null, null]);
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 3, corners, true, 0), 3, at({}))).toEqual([null, null, null, null]);
  });

  it('a gamma rounding a genuinely REAL lower block (patchBase = N-1) backs that full base', () => {
    const corners: Corners = ['fan', 'empty', 'empty', 'empty'];
    const base = { type: TerrainType.Mountain, elevation: 1 };
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 2, corners, true, 1), 2, at({}))).toEqual([base, base, base, base]);
  });

  it('cut mountain corner reveals the highest same-type LOWER step meeting that corner', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Mountain, 3, FAN_TL), 3, at({
      '-1,0': cell(TerrainType.Mountain, 1), '0,-1': cell(TerrainType.Mountain, 2),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('a DIAGONAL mountain does NOT fill cut water — it touches at a point, so the bank is ground', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,-1': cell(TerrainType.Mountain, 2), // mountain only at the diagonal of the cut TL corner
    }));
    expect(backs[0], 'a disconnected diagonal hill is not the river bank').toBeNull();
  });

  it('a lone pillar (no mass meets the corner) cuts through to ground (null)', () => {
    expect(cutBackingByCorner(cell(TerrainType.Mountain, 3, FAN_TL), 3, at({}))[0]).toBeNull();
  });

  it('a cut MOUNTAIN island corner reveals the WATER it sits in (no lower mountain step)', () => {
    // a mountain@1 rock with water@0 on the cut corner's edges → the cut shows the lake, not a ground notch
    const backs = cutBackingByCorner(cell(TerrainType.Mountain, 1, FAN_TL), 1, at({
      '-1,0': cell(TerrainType.Water, 0), '0,-1': cell(TerrainType.Water, 0),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Water, elevation: 0 });
  });

  it('a lower mountain STEP still wins over adjacent water (reveal the step, not the lake)', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Mountain, 3, FAN_TL), 3, at({
      '-1,0': cell(TerrainType.Mountain, 2), '0,-1': cell(TerrainType.Water, 0),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('a ground-level river (water@0) shows its GROUND bank even when an EDGE cliff rises beside it', () => {
    // A river running ALONG a cliff: mountain on ONE edge of the cut corner. The cliff stands beside the
    // water, it does not turn a corner over it, so the rounded corner opens on the shore.
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,0': cell(TerrainType.Mountain, 2),
    }));
    expect(backs[0], "the cliff is solid only at layers 1+, never the water's layer 0").toBeNull();
  });

  it('an elevated pool is backed by its EDGE mountain rim at the water\'s own level', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Water, 2, FAN_TL), 2, at({
      '-1,0': cell(TerrainType.Mountain, 2), // rim solid at layer 2 → backs the rounded pool water
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('a TALLER cliff behind cut water still backs at the WATER\'s layer — the bank, not the cliff top', () => {
    // The fill behind a rounded water corner is the wall AT the waterline: a
    // tier-5 cliff beside a tier-2 pool banks it at tier 2 (the 2D fill takes
    // the bank layer's color; the 3D backing column stays at pool height).
    const backs = cutBackingByCorner(cell(TerrainType.Water, 2, FAN_TL), 2, at({
      '-1,0': cell(TerrainType.Mountain, 5),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('Γ notch: cut water flanked by mountain is filled by that mountain, not the ground under it', () => {
    // The reported dent (issue #2): a pond at the foot of a mountain. The TL corner of the water cell has
    // mountain on BOTH edges, so the mountain turns a corner over this cell — the rounded-away quadrant
    // opens onto the mountain, and the junction reads as one straight line down the steps of the notch.
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,0': cell(TerrainType.Mountain, 1), '0,-1': cell(TerrainType.Mountain, 1),
      '-1,-1': cell(TerrainType.Mountain, 1),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('the fill takes the tier the two flanks MEET at, not the tallest edge', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,0': cell(TerrainType.Mountain, 4), '0,-1': cell(TerrainType.Mountain, 2),
      '-1,-1': cell(TerrainType.Mountain, 2),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('a WATER diagonal (the checkerboard): the two point-touching mountains weld into one band', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,0': cell(TerrainType.Mountain, 1), '0,-1': cell(TerrainType.Mountain, 1),
      '-1,-1': cell(TerrainType.Water, 0),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('an OPEN diagonal welds too — the pinch rule governs adding MASS, and a backing adds none', () => {
    // Two mountains attached diagonally with water in the 2x2 and bare ground on the diagonal. A Γ fillet is
    // still refused there (it would bridge two blocks touching at a point, and you could walk between them);
    // the backing only says what shows behind a corner already cut, so it welds the two shores rather than
    // fabricating a grass wedge at the point where they meet.
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,0': cell(TerrainType.Mountain, 1), '0,-1': cell(TerrainType.Mountain, 1),
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('two cliffs of DIFFERENT height meeting at a cut corner weld at the LOWER one', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({
      '-1,0': cell(TerrainType.Mountain, 2), '0,-1': cell(TerrainType.Mountain, 4),
    }));
    expect(backs[0], 'the tier the two shores actually meet at').toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('cut water with no mountain at the corner rounds against ground (null shore)', () => {
    expect(cutBackingByCorner(cell(TerrainType.Water, 0, FAN_TL), 0, at({}))[0]).toBeNull();
  });

  it('a neighbouring Γ patch counts as its BASE (N-1), not its fillet tier', () => {
    const backs = cutBackingByCorner(cell(TerrainType.Mountain, 3, FAN_TL), 3, at({
      '-1,0': cell(TerrainType.Mountain, 3, undefined, true), // patch at 3 → base 2
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('only CUT corners get backing; each corner judges its own neighbours', () => {
    const corners: Corners = ['fan', 'square', 'square', 'fan']; // TL and BR cut
    const backs = cutBackingByCorner(cell(TerrainType.Mountain, 2, corners), 2, at({
      '0,-1': cell(TerrainType.Mountain, 1), // step meets TL (and TR) only
    }));
    expect(backs[0]).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(backs[1], 'TR is square — no backing').toBeNull();
    expect(backs[3], 'BR is cut but nothing meets it — ground').toBeNull();
  });
});
