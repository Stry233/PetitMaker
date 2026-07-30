import { describe, it, expect } from 'vitest';
import {
  computeCellEdgeCoverage,
  hasPositiveEdgeContact,
  validateCut,
  isInnerCorner,
} from '../../core/edge-cut/cut-validator';
import { TerrainType, type Corners } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('computeCellEdgeCoverage', () => {
  it('undefined (full square) covers entire edge', () => {
    const intervals = computeCellEdgeCoverage(undefined, 'N');
    expect(intervals.length).toBe(1);
    expect(intervals[0]![0]).toBeCloseTo(0);
    expect(intervals[0]![1]).toBeCloseTo(1);
  });

  it('all-square covers entire edge', () => {
    const corners: Corners = ['square', 'square', 'square', 'square'];
    const intervals = computeCellEdgeCoverage(corners, 'E');
    expect(intervals[0]![0]).toBeCloseTo(0);
    expect(intervals[0]![1]).toBeCloseTo(1);
  });

  it('TL empty removes north coverage [0, 0.5]', () => {
    const corners: Corners = ['empty', 'square', 'square', 'square'];
    const n = computeCellEdgeCoverage(corners, 'N');
    expect(n).toEqual([[0.5, 1]]);
  });

  it('TL empty removes west coverage [0, 0.5]', () => {
    const corners: Corners = ['empty', 'square', 'square', 'square'];
    const w = computeCellEdgeCoverage(corners, 'W');
    expect(w).toEqual([[0.5, 1]]);
  });

  it('tri-NW at TL preserves N and W', () => {
    const corners: Corners = ['tri-NW', 'square', 'square', 'square'];
    const n = computeCellEdgeCoverage(corners, 'N');
    expect(n.some(([a, b]) => a <= 0.25 && b >= 0.25)).toBe(true);
    const w = computeCellEdgeCoverage(corners, 'W');
    expect(w.some(([a, b]) => a <= 0.25 && b >= 0.25)).toBe(true);
  });

  it('tri-SE at TL does not preserve N [0,0.5] or W [0,0.5]', () => {
    const corners: Corners = ['tri-SE', 'square', 'square', 'square'];
    const n = computeCellEdgeCoverage(corners, 'N');
    expect(n).toEqual([[0.5, 1]]);
    const w = computeCellEdgeCoverage(corners, 'W');
    expect(w).toEqual([[0.5, 1]]);
  });

  it('both right corners empty means no east coverage', () => {
    const corners: Corners = ['square', 'empty', 'square', 'empty'];
    const e = computeCellEdgeCoverage(corners, 'E');
    expect(e).toEqual([]);
  });

  it('fan at TL preserves N and W', () => {
    const corners: Corners = ['fan', 'square', 'square', 'square'];
    const n = computeCellEdgeCoverage(corners, 'N');
    expect(n.some(([a, b]) => a < 0.5 && b > 0)).toBe(true);
    const w = computeCellEdgeCoverage(corners, 'W');
    expect(w.some(([a, b]) => a < 0.5 && b > 0)).toBe(true);
  });
});

describe('hasPositiveEdgeContact', () => {
  it('two full squares have contact on any side', () => {
    expect(hasPositiveEdgeContact(undefined, 'E', undefined, 'W')).toBe(true);
  });

  it('candidate with empty east has no contact with full neighbor', () => {
    const candidate: Corners = ['square', 'empty', 'square', 'empty'];
    expect(hasPositiveEdgeContact(candidate, 'E', undefined, 'W')).toBe(false);
  });

  it('candidate with square TR has contact on east', () => {
    const candidate: Corners = ['empty', 'square', 'empty', 'empty'];
    expect(hasPositiveEdgeContact(candidate, 'E', undefined, 'W')).toBe(true);
  });

  it('bilateral: both sides trimmed but overlapping', () => {
    const a: Corners = ['square', 'square', 'square', 'empty'];
    const b: Corners = ['empty', 'square', 'square', 'square'];
    expect(hasPositiveEdgeContact(a, 'E', b, 'W')).toBe(true);
  });

  it('bilateral: both sides trimmed, no overlap', () => {
    const a: Corners = ['square', 'square', 'square', 'empty'];
    const b: Corners = ['square', 'square', 'empty', 'square'];
    expect(hasPositiveEdgeContact(a, 'E', b, 'W')).toBe(false);
  });
});

describe('validateCut', () => {
  it('isolated terrain: any cut valid', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const corners: Corners = ['fan', 'square', 'square', 'square'];
    expect(validateCut(state, 5, 5, 'terrain', corners)).toBe(true);
  });

  it('terrain with right neighbor: must preserve east', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    const cutTR: Corners = ['square', 'empty', 'square', 'square'];
    expect(validateCut(state, 5, 5, 'terrain', cutTR)).toBe(true);
    const cutBothRight: Corners = ['square', 'empty', 'square', 'empty'];
    expect(validateCut(state, 5, 5, 'terrain', cutBothRight)).toBe(false);
  });

  it('straight-line road: no valid cuts', () => {
    const state = makeState(10, 10);
    function addRoad(x: number, y: number) {
      state.objects.set(`r-${x}-${y}`, {
        id: `r-${x}-${y}`, catalogId: 'road-dirt',
        position: { x, y }, rotation: 0 as const, category: 1 as any, elevation: 0,
      });
    }
    addRoad(4, 5); addRoad(5, 5); addRoad(6, 5);
    const anycut: Corners = ['square', 'square', 'square', 'fan'];
    expect(validateCut(state, 5, 5, 'road', anycut)).toBe(false);
  });

  it('endpoint road: valid if connected side preserved', () => {
    const state = makeState(10, 10);
    state.objects.set('r1', {
      id: 'r1', catalogId: 'road-dirt',
      position: { x: 5, y: 5 }, rotation: 0 as const, category: 1 as any, elevation: 0,
    });
    state.objects.set('r2', {
      id: 'r2', catalogId: 'road-dirt',
      position: { x: 4, y: 5 }, rotation: 0 as const, category: 1 as any, elevation: 0,
    });
    const cutRight: Corners = ['square', 'fan', 'square', 'fan'];
    expect(validateCut(state, 5, 5, 'road', cutRight)).toBe(true);
  });
});

describe('isInnerCorner', () => {
  it('detects TL inner corner in Gamma shape', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    // Cell (6,6) is empty. Its TL corner (idx 0) faces the Gamma center.
    expect(isInnerCorner(state, 6, 6, 0, TerrainType.Mountain, 1)).toBe(true);
  });

  it('no inner corner without diagonal cell (an EMPTY diagonal is an open gap, not a notch)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    // Missing diagonal (5,5) — an open gap between two diagonal mountains, not an enclosed Γ notch.
    expect(isInnerCorner(state, 6, 6, 0, TerrainType.Mountain, 1)).toBe(false);
  });

  it('a WATER diagonal still encloses the notch — two mountains gamma the corner across the pond', () => {
    // The user's water/mountain junction: (6,6).TL has mountains on both edges (N, W) and WATER on the
    // diagonal (NW). A Γ cut only ADDS a fillet, so it can never break the pond's bank — the corner is an
    // enclosed notch and the two mountains gamma it like any other inner corner.
    const state = makeState(10, 10);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1); // N edge
    setTerrain(state, 5, 6, TerrainType.Mountain, 1); // W edge
    setTerrain(state, 5, 5, TerrainType.Water, 0);    // NW diagonal — water encloses the corner
    expect(isInnerCorner(state, 6, 6, 0, TerrainType.Mountain, 1)).toBe(true);
  });

  it('no inner corner if target cell already has terrain', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    expect(isInnerCorner(state, 6, 6, 0, TerrainType.Mountain, 1)).toBe(false);
  });

  it('wrong corner index not inner', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    // cornerIdx 3 (BR) is not the inner corner for this Gamma shape
    expect(isInnerCorner(state, 6, 6, 3, TerrainType.Mountain, 1)).toBe(false);
  });
});
