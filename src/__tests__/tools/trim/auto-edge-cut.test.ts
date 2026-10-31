import { describe, it, expect } from 'vitest';
import { applyAutoEdgeCut, edgeCutGeneratedTerrain, edgeCutTerrainWith } from '../../../tools/trim/auto-edge-cut';
import { EdgeCutTool } from '../../../tools/pointer/edge-cut/edge-cut-tool';
import { cutBackingByCorner } from '../../../view/shared/terrain/cut-backing';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { TerrainType, type PlacedObject } from '../../../core/model/types';
import { classifyRoadKind } from '../../../core/domain/edge-cut/road-cut-states';
import { getCell } from '../../../core/model/grid-model';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { makeToolCtx } from '../../_support/tool-ctx';
import { cell, point } from '../../_support/grid';

function exec(state: any): CommandExecutor {
  return makeExecutor(state);
}

describe('applyAutoEdgeCut — terrain', () => {
  it('rounds every convex corner of an isolated cell (round mode)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [{ x: 5, y: 5 }], []);
    expect(getCell(state.cells, 5, 5)!.terrain!.corners).toEqual(['fan', 'fan', 'fan', 'fan']);
  });

  it('bevels every convex corner of an isolated cell (rect mode)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'rect', [{ x: 5, y: 5 }], []);
    expect(getCell(state.cells, 5, 5)!.terrain!.corners).toEqual(['tri-SE', 'tri-SW', 'tri-NE', 'tri-NW']);
  });

  it('elevation-independent: rounds a TALL isolated tip (elev 3..6) — no height gate', () => {
    // Cuttability is a property of the 2D silhouette, as with the manual tool, so height does not matter.
    for (const e of [3, 4, 6]) {
      const state = makeState(10, 10);
      setTerrain(state, 5, 5, TerrainType.Mountain, e);
      applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [{ x: 5, y: 5 }], []);
      expect(getCell(state.cells, 5, 5)!.terrain!.corners, `elev ${e}`).toEqual(['fan', 'fan', 'fan', 'fan']);
    }
  });

  it('only cuts the one outer corner of each cell in a 2x2 block (interior corners stay square)', () => {
    const state = makeState(10, 10);
    const block: [number, number][] = [[4, 4], [5, 4], [4, 5], [5, 5]];
    for (const [x, y] of block) setTerrain(state, x, y, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', block.map(([x, y]) => ({ x, y })), []);
    expect(getCell(state.cells, 4, 4)!.terrain!.corners).toEqual(['fan', 'square', 'square', 'square']); // TL
    expect(getCell(state.cells, 5, 4)!.terrain!.corners).toEqual(['square', 'fan', 'square', 'square']); // TR
    expect(getCell(state.cells, 4, 5)!.terrain!.corners).toEqual(['square', 'square', 'fan', 'square']); // BL
    expect(getCell(state.cells, 5, 5)!.terrain!.corners).toEqual(['square', 'square', 'square', 'fan']); // BR
  });

  it('fills a concave (Γ) inner corner with a rounded patch', () => {
    const state = makeState(10, 10);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // notch at (4,4)
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    const patch = getCell(state.cells, 4, 4)!.terrain!;
    expect(patch.patchOnly).toBe(true);
    expect(patch.type).toBe(TerrainType.Mountain);
    expect(patch.corners![0]).toBe('fan'); // TL faces the notch
  });

  it('fills the Γ inner corner with a triangle in rect mode', () => {
    const state = makeState(10, 10);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]];
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'rect', L.map(([x, y]) => ({ x, y })), []);
    expect(getCell(state.cells, 4, 4)!.terrain!.corners![0]).toBe('tri-NW'); // INNER_TRI[0]
  });

  it('STROKE path fills an EMPTY Γ notch COSMETICALLY (patchBase 0, no base block) — matches the manual tool', () => {
    // Auto-trim produces only states the manual EdgeCutTool can: over an empty notch, a cosmetic
    // fillet with patchBase 0 and open ground behind its rounded corner.
    const state = makeState(10, 10);
    // Tier 1: a fillet has no mass, so over an empty notch it rests on the ground or is not offered.
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // tier-1 L; notch (4,4) empty
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    const patch = getCell(state.cells, 4, 4)!.terrain!;
    expect(patch.elevation, 'fillet sits at the wrapping tier').toBe(1);
    expect(patch.patchOnly).toBe(true);
    expect(patch.corners![0]).toBe('fan');
    expect(patch.patchBase, 'cosmetic — no base column added (AUTO-TRIM-IS-COSMETIC)').toBe(0);
    // With patchBase undefined, `cutBacking` would fall back to a phantom mountain one tier lower.
    const back = cutBackingByCorner(patch, 1, (dx, dy) => getCell(state.cells, 4 + dx, 4 + dy)?.terrain);
    expect(back, 'no fabricated base backing').toEqual([null, null, null, null]);
  });

  it('a WATER notch keeps its water and rounds its own corner — filled by the mountain that wraps it', () => {
    // A mountain built into a pond: the water in its Γ notch is never filled, and behind the water's
    // own cut shows the wrapping mountain, since a ground reveal would draw a grass wedge in the bank.
    const state = makeState(10, 10);
    for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const L: [number, number][] = [[5, 4], [4, 5], [5, 5]]; // wraps the BR corner of the water at (4,4)
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'rect', L.map(([x, y]) => ({ x, y })), []);

    const notch = getCell(state.cells, 4, 4)!.terrain!;
    expect(notch.type, 'the water survives — no mountain patch over it').toBe(TerrainType.Water);
    expect(notch.corners![3], 'its wrapped corner rounds out').toBe('tri-NW');
    const back = cutBackingByCorner(notch, 0, (dx, dy) => getCell(state.cells, 4 + dx, 4 + dy)?.terrain);
    expect(back[3], 'the cut opens onto the wrapping mountain, not bare ground')
      .toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('two mountains attached DIAGONALLY weld across the water corner between them', () => {
    // Two mountain cells meet diagonally at the water's corner. The water's cut shows the shores
    // behind it, and the diagonal fillet is cosmetic so no mass bridges the pinch.
    const state = makeState(12, 12);
    for (let y = 5; y <= 9; y++) for (let x = 5; x <= 9; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const pinch: [number, number][] = [[5, 4], [4, 5]]; // meeting at the TL corner of the water at (5,5)
    for (const [x, y] of pinch) setTerrain(state, x, y, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'rect', pinch.map(([x, y]) => ({ x, y })), []);

    const diag = getCell(state.cells, 4, 4)!.terrain!;
    expect(diag.patchOnly, 'the diagonal takes a fillet').toBe(true);
    expect(diag.patchBase, 'cosmetic only — no mass bridges the pinch, nothing may walk across').toBe(0);
    const notch = getCell(state.cells, 5, 5)!.terrain!;
    expect(notch.corners![0], 'the water rounds the corner the two shores meet at').toBe('tri-SE');
    const back = cutBackingByCorner(notch, 0, (dx, dy) => getCell(state.cells, 5 + dx, 5 + dy)?.terrain);
    expect(back[0], 'welded, not a fabricated grass wedge')
      .toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('GENERATION fills an EMPTY Γ notch COSMETICALLY, identical to the manual/stroke path (no phantom base)', () => {
    // A solid column or a missing patchBase would render a phantom lower step at the inner corner.
    const state = makeState(10, 10);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // tier-1 L; notch (4,4) empty
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 1);
    edgeCutGeneratedTerrain(makeToolCtx(state, exec(state)), L.map(([x, y]) => ({ x, y })), 'round');
    const patch = getCell(state.cells, 4, 4)!.terrain!;
    expect(patch.elevation).toBe(1);
    expect(patch.patchOnly).toBe(true);
    expect(patch.corners![0]).toBe('fan');
    expect(patch.patchBase).toBe(0);
    const back = cutBackingByCorner(patch, patch.elevation, (dx, dy) => getCell(state.cells, 4 + dx, 4 + dy)?.terrain);
    expect(back, 'no fabricated base backing').toEqual([null, null, null, null]);
  });

  it('AUTO-TRIM-IS-COSMETIC: rounds a lower real block in a Γ notch WITHOUT raising it structurally', () => {
    // A tier-1 block in a tier-2 L's notch gets a cosmetic fillet, as a manual Γ click gives it, and
    // keeps its real support; skipping it would leave square inner corners.
    const state = makeState(10, 10);
    const cells: [number, number][] = [[3, 3], [4, 3], [3, 4], [4, 4]]; // tier-2 L; notch (4,4) holds a tier-1 block
    for (const [x, y] of cells) setTerrain(state, x, y, TerrainType.Mountain, x === 4 && y === 4 ? 1 : 2);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', cells.map(([x, y]) => ({ x, y })), []);
    const block = getCell(state.cells, 4, 4)!.terrain!;
    expect(block.patchOnly, 'now a cosmetic fillet').toBe(true);
    expect(block.patchBase, 'real support unchanged — NOT structurally raised').toBe(1);
    expect(block.elevation, 'fillet sits at the wrapping tier').toBe(2);
    expect(block.corners?.[0], 'inner corner rounds').toBe('fan'); // TL faces the notch
  });

  it('a chosen pass fills a lower real block in a notch only when asked to, as the stroke path does', () => {
    const build = () => {
      const state = makeState(10, 10);
      const cells: [number, number][] = [[3, 3], [4, 3], [3, 4], [4, 4]]; // tier-2 L; notch (4,4) holds a tier-1 block
      for (const [x, y] of cells) setTerrain(state, x, y, TerrainType.Mountain, x === 4 && y === 4 ? 1 : 2);
      return { state, cells: cells.map(([x, y]) => ({ x, y })) };
    };
    const tri = () => 'tri' as const;
    const plain = build();
    edgeCutTerrainWith(makeToolCtx(plain.state, exec(plain.state)), plain.cells, tri);
    expect(getCell(plain.state.cells, 4, 4)!.terrain!.patchOnly, 'generation leaves a real block alone').toBeFalsy();
    const asked = build();
    edgeCutTerrainWith(makeToolCtx(asked.state, exec(asked.state)), asked.cells, tri, { fillLowerBlocks: true });
    const block = getCell(asked.state.cells, 4, 4)!.terrain!;
    expect(block.patchOnly).toBe(true);
    expect(block.patchBase, 'its own support kept').toBe(1);
    expect(block.elevation).toBe(2);
    expect(block.corners?.[0]).not.toBe('square');
  });

  it('raises an under-tall Γ fillet with the mass — a fillet is a grounded column, whatever its floor', () => {
    const state = makeState(12, 12);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // notch at (4,4)
    const trim = (e: number) => {
      for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, e);
      applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    };
    trim(1);
    expect(getCell(state.cells, 4, 4)!.terrain!.elevation, 'fillet starts at tier 1').toBe(1);
    trim(3); // stack the L up to tier 3, over a notch that is still bare ground
    const overGround = getCell(state.cells, 4, 4)!.terrain!;
    expect(overGround.patchOnly, 'still a cosmetic fillet').toBe(true);
    expect(overGround.elevation, 'follows the walls as a column from the ground').toBe(3);
    expect(overGround.patchBase, 'still no real base').toBe(0);
    expect(overGround.corners![0], 'keeps its rounded corner').toBe('fan');

    // A real block in the notch floor: the fillet keeps riding the walls, on that base.
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    const overBlock = getCell(state.cells, 4, 4)!.terrain!;
    expect(overBlock.patchOnly).toBe(true);
    expect(overBlock.elevation, 'fillet at the stacked tier').toBe(3);
    expect(overBlock.patchBase, 'on the block that was in the notch').toBe(2);
  });

  it('never trims a neighbour corner whose context the stroke did not change', () => {
    // A square-cornered tier-1 run whose west end is raised to tier 2. The far block's corners face
    // open ground the stroke never touched, so the border sweep leaves them.
    const state = makeState(12, 12);
    for (let x = 3; x <= 6; x++) setTerrain(state, x, 5, TerrainType.Mountain, 1);
    const stroke: [number, number][] = [[3, 5], [4, 5]];
    for (const [x, y] of stroke) setTerrain(state, x, y, TerrainType.Mountain, 2);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'rect', stroke.map(([x, y]) => ({ x, y })), []);
    const far = getCell(state.cells, 6, 5)!.terrain!;
    expect(far.corners?.some((c) => c !== 'square') ?? false, 'the far block keeps its square corners').toBe(false);
    const painted = getCell(state.cells, 3, 5)!.terrain!;
    expect(painted.elevation).toBe(2);
  });

  it('rounds a neighbouring cell made convex by the stroke (mountain peninsula into a new water hole)', () => {
    const state = makeState(12, 12);
    for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const water: [number, number][] = [[5, 4], [4, 5], [5, 5]]; // an L of water; (4,4) keeps water on its right + below
    for (const [x, y] of water) setTerrain(state, x, y, TerrainType.Water, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', water.map(([x, y]) => ({ x, y })), []);
    // (4,4) is outside the stroke, but its BR corner pokes into the new water.
    expect(getCell(state.cells, 4, 4)!.terrain!.corners?.[3], 'mountain peninsula corner rounds into the water').toBe('fan');
  });

  it('RIVER stroke: a water-wrapped ground notch rounds as a GROUND ISLET (manual-reachable), never a water Γ patch', () => {
    // The manual tool never fills a water notch; a river bend's inner corner is a ground islet (a
    // `type: None` cell whose corner rounds out). A water fillet would be uncyclable by the manual tool
    // and would read as solid water, cascading down the bank.
    const state = makeState(12, 12);
    const RIVER: [number, number][] = [[3, 3], [4, 3], [3, 4], [3, 5]]; // L river @0; inner bend notch (4,4)
    for (const [x, y] of RIVER) setTerrain(state, x, y, TerrainType.Water, 0);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', RIVER.map(([x, y]) => ({ x, y })), []);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const t = getCell(state.cells, x, y)?.terrain;
      expect(t && t.type === TerrainType.Water && t.patchOnly, `water patch at (${x},${y})`).toBeFalsy();
    }
    const notch = getCell(state.cells, 4, 4)!.terrain!;
    expect(notch.type, 'ground islet (None) cell').toBe(TerrainType.None);
    expect(notch.patchOnly).toBeFalsy();
    expect(notch.corners![0], 'TL rounds out into the water').toBe('fan');
    // (4,5) has water on one edge only, so it is no islet corner.
    expect(getCell(state.cells, 4, 5)!.terrain, 'no cascaded fill down the bank').toBeNull();
  });

  it('RIVER stroke: every auto-written cut is MODIFIABLE by the manual EdgeCutTool (cyclable site)', () => {
    const state = makeState(12, 12);
    const RIVER: [number, number][] = [[3, 3], [4, 3], [3, 4], [3, 5]];
    for (const [x, y] of RIVER) setTerrain(state, x, y, TerrainType.Water, 0);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex);
    applyAutoEdgeCut(ctx, 'round', RIVER.map(([x, y]) => ({ x, y })), []);
    const before = ex.historyDepth();
    const beforeCorner = getCell(state.cells, 4, 4)!.terrain!.corners![0];
    new EdgeCutTool().onPointerDown(cell({ x: 3, y: 3 }), point({ x: 0, y: 0 } as any), ctx); // governs the notch TL
    expect(ex.historyDepth(), 'manual click landed a command').toBeGreaterThan(before);
    expect(getCell(state.cells, 4, 4)?.terrain?.corners?.[0] ?? 'square', 'the auto cut cycled').not.toBe(beforeCorner);
  });

  it('does nothing in off mode', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'off', [{ x: 5, y: 5 }], []);
    expect(getCell(state.cells, 5, 5)!.terrain!.corners).toBeUndefined();
  });

  it('preserves an already-trimmed corner on repaint', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    getCell(state.cells, 5, 5)!.terrain!.corners = ['tri-SE', 'square', 'square', 'square'];
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [{ x: 5, y: 5 }], []);
    expect(getCell(state.cells, 5, 5)!.terrain!.corners).toEqual(['tri-SE', 'fan', 'fan', 'fan']);
  });
});

describe('applyAutoEdgeCut — road/tile', () => {
  function addRoad(state: any, x: number, y: number): PlacedObject {
    const road: PlacedObject = {
      id: `r-${x}-${y}`, catalogId: 'path-overgrown-dirt',
      position: { x, y }, rotation: 0, elevation: 0,
    };
    state.objects.set(road.id, road);
    return road;
  }

  it('applies a fan-based (round) canonical state to an isolated tile', () => {
    const state = makeState(10, 10);
    const road = addRoad(state, 5, 5);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [], [{ x: 5, y: 5 }]);
    expect(classifyRoadKind(road.corners)).toBe('round');
  });

  it('applies a triangle-based (direct) canonical state in rect mode', () => {
    const state = makeState(10, 10);
    const road = addRoad(state, 5, 5);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'rect', [], [{ x: 5, y: 5 }]);
    expect(classifyRoadKind(road.corners)).toBe('direct');
  });

  it('leaves a straight-through interior tile uncut (forced square)', () => {
    const state = makeState(10, 10);
    addRoad(state, 4, 5);
    const mid = addRoad(state, 5, 5);
    addRoad(state, 6, 5); // mid has left+right neighbours → opposite → must stay square
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [], [{ x: 5, y: 5 }]);
    expect(classifyRoadKind(mid.corners)).toBeNull();
  });
});

describe('applyAutoEdgeCut — what it reports it changed', () => {
  it('reports exactly the cells it cut, and nothing it only looked at', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const changed = applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [{ x: 5, y: 5 }], []);
    expect(changed).toEqual([{ x: 5, y: 5 }]);   // the 8 neighbours were swept, none of them cut
  });

  it('reports a block OUTSIDE the stroke that the stroke left newly convex', () => {
    // (5,5) is an older diagonal block the border sweep reaches; a flash over the stroke alone would
    // miss it.
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    const changed = applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [{ x: 4, y: 4 }], []);
    expect(changed.some((c) => c.x === 5 && c.y === 5)).toBe(true);
    expect(changed.some((c) => c.x === 4 && c.y === 4)).toBe(true);
  });

  it('reports the notch a Γ patch filled — a cell the stroke never painted', () => {
    const state = makeState(10, 10);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // notch at (4,4)
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const changed = applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    expect(getCell(state.cells, 4, 4)!.terrain!.patchOnly).toBe(true);
    expect(changed.some((c) => c.x === 4 && c.y === 4)).toBe(true);
  });

  it('reports a road tile it cut, and nothing when the mode is off', () => {
    const state = makeState(10, 10);
    const road: PlacedObject = {
      id: 'r', catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation: 0, elevation: 0,
    };
    state.objects.set(road.id, road);
    expect(applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'off', [], [{ x: 5, y: 5 }])).toEqual([]);
    expect(applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', [], [{ x: 5, y: 5 }]))
      .toEqual([{ x: 5, y: 5 }]);
  });
});
