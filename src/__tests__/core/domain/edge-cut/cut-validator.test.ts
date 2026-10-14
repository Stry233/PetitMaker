import { validateCut, isInnerCorner } from '../../../../core/domain/edge-cut/cut-validator';
import { TerrainType, type Corners } from '../../../../core/model/types';
import { cornersOnSide } from '../../../../core/model/corners';
import { OPPOSITE_SIDE, SIDE_DELTA, type Side } from '../../../../core/grid/directions';
import { makeState, setTerrain } from '../../../_support/map-state';
import { roadLookup } from '../../../../state/object-index';

const SQUARE: Corners = ['square', 'square', 'square', 'square'];

/** Whether a terrain cut at (5,5) keeps contact across `side` with a same-tier neighbour trimmed to
 *  `neighbour` (a whole cell when absent). */
function keepsContact(candidate: Corners, side: Side, neighbour?: Corners): boolean {
  const state = makeState(10, 10);
  const [dx, dy] = SIDE_DELTA[side];
  setTerrain(state, 5, 5, TerrainType.Mountain, 1);
  setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
  if (neighbour) state.cells[5 + dy]![5 + dx]!.terrain!.corners = neighbour;
  return validateCut(state, roadLookup(state), { x: 5, y: 5 }, 'terrain', candidate);
}

/** Which halves of `side` a cut covers, probed against neighbours that each keep one half of the seam.
 *  The seam reads the neighbour's side reversed, so its second half meets the candidate's first. */
function coveredHalves(candidate: Corners, side: Side): [boolean, boolean] {
  const keepOnly = (drop: number): Corners => SQUARE.map((c, i) => (i === drop ? 'empty' : c)) as Corners;
  const [first, second] = cornersOnSide(OPPOSITE_SIDE[side]);
  return [keepsContact(candidate, side, keepOnly(first)), keepsContact(candidate, side, keepOnly(second))];
}

describe('edge coverage', () => {
  it('a whole neighbour covers its entire edge', () => {
    expect(keepsContact(['empty', 'square', 'square', 'square'], 'N')).toBe(true);
    expect(keepsContact(['square', 'empty', 'square', 'square'], 'N')).toBe(true);
    expect(coveredHalves(SQUARE, 'N')).toEqual([true, true]);
  });

  it('all-square covers entire edge', () => {
    expect(coveredHalves(SQUARE, 'E')).toEqual([true, true]);
  });

  it('TL empty removes north coverage [0, 0.5]', () => {
    expect(coveredHalves(['empty', 'square', 'square', 'square'], 'N')).toEqual([false, true]);
  });

  it('TL empty removes west coverage [0, 0.5]', () => {
    expect(coveredHalves(['empty', 'square', 'square', 'square'], 'W')).toEqual([false, true]);
  });

  it('tri-NW at TL preserves N and W', () => {
    expect(coveredHalves(['tri-NW', 'square', 'square', 'square'], 'N')).toEqual([true, true]);
    expect(coveredHalves(['tri-NW', 'square', 'square', 'square'], 'W')).toEqual([true, true]);
  });

  it('tri-SE at TL does not preserve N [0,0.5] or W [0,0.5]', () => {
    expect(coveredHalves(['tri-SE', 'square', 'square', 'square'], 'N')).toEqual([false, true]);
    expect(coveredHalves(['tri-SE', 'square', 'square', 'square'], 'W')).toEqual([false, true]);
  });

  it('both right corners empty means no east coverage', () => {
    expect(coveredHalves(['square', 'empty', 'square', 'empty'], 'E')).toEqual([false, false]);
  });

  it('fan at TL preserves N and W', () => {
    expect(coveredHalves(['fan', 'square', 'square', 'square'], 'N')).toEqual([true, true]);
    expect(coveredHalves(['fan', 'square', 'square', 'square'], 'W')).toEqual([true, true]);
  });
});

describe('edge contact', () => {
  it('two full squares have contact on any side', () => {
    expect(keepsContact(SQUARE, 'E')).toBe(true);
  });

  it('candidate with empty east has no contact with full neighbor', () => {
    expect(keepsContact(['square', 'empty', 'square', 'empty'], 'E')).toBe(false);
  });

  it('candidate with square TR has contact on east', () => {
    expect(keepsContact(['empty', 'square', 'empty', 'empty'], 'E')).toBe(true);
  });

  it('bilateral: both sides trimmed but overlapping', () => {
    expect(keepsContact(['square', 'square', 'square', 'empty'], 'E', ['empty', 'square', 'square', 'square'])).toBe(true);
  });

  it('bilateral: both sides trimmed, no overlap', () => {
    expect(keepsContact(['square', 'square', 'square', 'empty'], 'E', ['square', 'square', 'empty', 'square'])).toBe(false);
  });
});

describe('validateCut', () => {
  it('isolated terrain: any cut valid', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const corners: Corners = ['fan', 'square', 'square', 'square'];
    expect(validateCut(state, roadLookup(state), { x: 5, y: 5 }, 'terrain', corners)).toBe(true);
  });

  it('terrain with right neighbor: must preserve east', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    const cutTR: Corners = ['square', 'empty', 'square', 'square'];
    expect(validateCut(state, roadLookup(state), { x: 5, y: 5 }, 'terrain', cutTR)).toBe(true);
    const cutBothRight: Corners = ['square', 'empty', 'square', 'empty'];
    expect(validateCut(state, roadLookup(state), { x: 5, y: 5 }, 'terrain', cutBothRight)).toBe(false);
  });

  it('straight-line road: no valid cuts', () => {
    const state = makeState(10, 10);
    function addRoad(x: number, y: number) {
      state.objects.set(`r-${x}-${y}`, {
        id: `r-${x}-${y}`, catalogId: 'path-overgrown-dirt',
        position: { x, y }, rotation: 0 as const, elevation: 0,
      });
    }
    addRoad(4, 5); addRoad(5, 5); addRoad(6, 5);
    const anycut: Corners = ['square', 'square', 'square', 'fan'];
    expect(validateCut(state, roadLookup(state), { x: 5, y: 5 }, 'road', anycut)).toBe(false);
  });

  it('endpoint road: valid if connected side preserved', () => {
    const state = makeState(10, 10);
    state.objects.set('r1', {
      id: 'r1', catalogId: 'path-overgrown-dirt',
      position: { x: 5, y: 5 }, rotation: 0 as const, elevation: 0,
    });
    state.objects.set('r2', {
      id: 'r2', catalogId: 'path-overgrown-dirt',
      position: { x: 4, y: 5 }, rotation: 0 as const, elevation: 0,
    });
    const cutRight: Corners = ['square', 'fan', 'square', 'fan'];
    expect(validateCut(state, roadLookup(state), { x: 5, y: 5 }, 'road', cutRight)).toBe(true);
  });
});

describe('isInnerCorner', () => {
  it('detects TL inner corner in Gamma shape', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    // Cell (6,6) is empty. Its TL corner (idx 0) faces the Gamma center.
    expect(isInnerCorner(state, 6, 6, 0, { type: TerrainType.Mountain, elevation: 1 })).toBe(true);
  });

  it('no inner corner without diagonal cell (an EMPTY diagonal is an open gap, not a notch)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    // Missing diagonal (5,5) — an open gap between two diagonal mountains, not an enclosed Γ notch.
    expect(isInnerCorner(state, 6, 6, 0, { type: TerrainType.Mountain, elevation: 1 })).toBe(false);
  });

  it('a WATER diagonal still encloses the notch — two mountains gamma the corner across the pond', () => {
    // The user's water/mountain junction: (6,6).TL has mountains on both edges (N, W) and water on the
    // diagonal (NW). A Γ cut only adds a fillet, so it can never break the pond's bank — the corner is an
    // enclosed notch and the two mountains gamma it like any other inner corner.
    const state = makeState(10, 10);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1); // N edge
    setTerrain(state, 5, 6, TerrainType.Mountain, 1); // W edge
    setTerrain(state, 5, 5, TerrainType.Water, 0);    // NW diagonal — water encloses the corner
    expect(isInnerCorner(state, 6, 6, 0, { type: TerrainType.Mountain, elevation: 1 })).toBe(true);
  });

  it('no inner corner if target cell already has terrain', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    expect(isInnerCorner(state, 6, 6, 0, { type: TerrainType.Mountain, elevation: 1 })).toBe(false);
  });

  it('wrong corner index not inner', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    // cornerIdx 3 (BR) is not the inner corner for this Gamma shape
    expect(isInnerCorner(state, 6, 6, 3, { type: TerrainType.Mountain, elevation: 1 })).toBe(false);
  });
});
