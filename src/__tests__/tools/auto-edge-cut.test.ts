import { describe, it, expect } from 'vitest';
import { applyAutoEdgeCut, edgeCutGeneratedTerrain } from '../../tools/edge-cut/auto-edge-cut';
import { EdgeCutTool } from '../../tools/edge-cut/edge-cut-tool';
import { cutBackingByCorner } from '../../core/edge-cut/cut-backing';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, ObjectCategory, type EditorEvents, type PlacedObject } from '../../core/model/types';
import { classifyRoadKind } from '../../core/edge-cut/road-cut-states';
import { getCell } from '../../core/model/grid-model';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';

function exec(state: any): CommandExecutor {
  return new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
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
    // Regression guard: an elev>=2 convex corner must round even when the cut reveals only ground, so a
    // tall circle/pillar kept square corners under auto-trim while the manual tool rounded it. Cuttability
    // is a 2D-silhouette property, so a convex tip rounds at any height now.
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
    // The build-brush auto-trim (stroke path) must produce ONLY states the manual EdgeCutTool could produce.
    // For an empty concave notch the manual tool materialises a COSMETIC fillet with patchBase 0 (no base
    // column) — the notch stays open ground behind a rounded top corner. Raising a real support column
    // here would violate AUTO-TRIM-IS-COSMETIC (a structural base block the manual tool never adds).
    const state = makeState(10, 10);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // tier-3 L; notch (4,4) empty
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 3);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    const patch = getCell(state.cells, 4, 4)!.terrain!;
    expect(patch.elevation, 'fillet sits at the wrapping tier').toBe(3);
    expect(patch.patchOnly).toBe(true);
    expect(patch.corners![0]).toBe('fan');
    // THE FIX: cosmetic fillet, real support 0 — NOT a structurally-raised base block.
    expect(patch.patchBase, 'cosmetic — no base column added (AUTO-TRIM-IS-COSMETIC)').toBe(0);
    // cut-backing must therefore reveal NOTHING behind the cut (open notch), exactly like the manual tool —
    // not a phantom mountain@N-1 base fabricated by cutBacking's patchBase-undefined fallback (symptom d).
    const back = cutBackingByCorner(patch, 3, (dx, dy) => getCell(state.cells, 4 + dx, 4 + dy)?.terrain);
    expect(back, 'no fabricated base backing').toEqual([null, null, null, null]);
  });

  it('GENERATION fills an EMPTY Γ notch COSMETICALLY, identical to the manual/stroke path (no phantom base)', () => {
    // The notch must round from-empty with patchBase 0, byte-identical to the manual tool, so generated
    // and painted gammas render the same at any elevation. Guards against raising a solid column here
    // or omitting patchBase, either of which makes the render fabricate a phantom mountain@N-1 base
    // (a lower step at the inner corner that hand-drawn terrain never has).
    const state = makeState(10, 10);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // tier-2 L; notch (4,4) empty
    for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, 2);
    edgeCutGeneratedTerrain(makeToolCtx(state, exec(state)), L.map(([x, y]) => ({ x, y })), 'round');
    const patch = getCell(state.cells, 4, 4)!.terrain!;
    expect(patch.elevation).toBe(2);
    expect(patch.patchOnly).toBe(true);
    expect(patch.corners![0]).toBe('fan');
    // A from-empty gamma: patchBase 0, so the notch stays open ground behind the rounded corner — the cut
    // reveals NOTHING (no fabricated lower step).
    expect(patch.patchBase).toBe(0);
    const back = cutBackingByCorner(patch, patch.elevation, (dx, dy) => getCell(state.cells, 4 + dx, 4 + dy)?.terrain);
    expect(back, 'no fabricated base backing').toEqual([null, null, null, null]);
  });

  it('AUTO-TRIM-IS-COSMETIC: rounds a lower real block in a Γ notch WITHOUT raising it structurally', () => {
    // A lower real block tucked into a taller mass's notch (here a tier-1 block in a tier-2 L) gets a
    // COSMETIC fillet that rounds the inner corner — exactly like a manual Γ click. AUTO-TRIM-IS-COSMETIC still holds in the
    // sense that matters: the block's real support (patchBase / standable surface) is unchanged, so nothing
    // is structurally raised; only the silhouette rounds. (The old behaviour skipped it entirely, which left
    // a raised disc / water hole on a base with square inner corners.)
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

  it('raises an under-tall Γ fillet when the shape is stacked higher (fillet tracks the mass tier)', () => {
    // Regression: a circle drawn at ground then stacked taller left its inner Γ fillets at the FIRST tier,
    // so the rounding showed only "on the ground" while the mountain rose square above it. Re-trimming must
    // lift the fillet to the current mass tier.
    const state = makeState(12, 12);
    const L: [number, number][] = [[3, 3], [4, 3], [3, 4]]; // notch at (4,4)
    const trim = (e: number) => {
      for (const [x, y] of L) setTerrain(state, x, y, TerrainType.Mountain, e);
      applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', L.map(([x, y]) => ({ x, y })), []);
    };
    trim(1);
    expect(getCell(state.cells, 4, 4)!.terrain!.elevation, 'fillet starts at tier 1').toBe(1);
    trim(3); // stack the L up to tier 3
    const t = getCell(state.cells, 4, 4)!.terrain!;
    expect(t.patchOnly, 'still a cosmetic fillet').toBe(true);
    expect(t.elevation, 'fillet rose to the stacked tier').toBe(3);
    expect(t.corners![0], 'keeps its rounded corner').toBe('fan');
  });

  it('rounds a neighbouring cell made convex by the stroke (mountain peninsula into a new water hole)', () => {
    // Regression: carving water into a mountain leaves mountain corners poking into the water (two water
    // edges = a convex peninsula tip). Those corners belong to cells OUTSIDE the water stroke, so a
    // stroke-only pass never rounded them and the water/mountain border stayed jagged — yet the manual tool
    // rounds them. Auto-trim must round the stroke's real-terrain border too.
    const state = makeState(12, 12);
    for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const water: [number, number][] = [[5, 4], [4, 5], [5, 5]]; // an L of water; (4,4) keeps water on its right + below
    for (const [x, y] of water) setTerrain(state, x, y, TerrainType.Water, 1);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', water.map(([x, y]) => ({ x, y })), []);
    // (4,4) is mountain, NOT in the water stroke, but its BR corner now pokes into the water → rounds.
    expect(getCell(state.cells, 4, 4)!.terrain!.corners?.[3], 'mountain peninsula corner rounds into the water').toBe('fan');
  });

  it('RIVER stroke: a water-wrapped ground notch rounds as a GROUND ISLAND (manual-reachable), never a water Γ patch', () => {
    // The manual EdgeCutTool NEVER fills a water notch (its gamma branch is Mountain-only: "a WATER notch
    // must NOT be flooded — the island rounds out via the water's concave cut"). The correct state at a
    // river bend's inner corner is a ground-island cut (a `type: None` cell whose corner rounds OUT,
    // revealing the water — ISLAND-ROUNDS-REVEALING-WATER). A patchOnly WATER fillet
    // there would be a state the manual tool can neither produce nor cycle (no cut site matches), and it
    // cascades: the patch reads as solid water@0, wrapping the NEXT ground cell down the bank.
    const state = makeState(12, 12);
    const RIVER: [number, number][] = [[3, 3], [4, 3], [3, 4], [3, 5]]; // L river @0; inner bend notch (4,4)
    for (const [x, y] of RIVER) setTerrain(state, x, y, TerrainType.Water, 0);
    applyAutoEdgeCut(makeToolCtx(state, exec(state)), 'round', RIVER.map(([x, y]) => ({ x, y })), []);
    // no water Γ patches anywhere — the manual tool cannot produce them
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const t = getCell(state.cells, x, y)?.terrain;
      expect(t && t.type === TerrainType.Water && t.patchOnly, `water patch at (${x},${y})`).toBeFalsy();
    }
    // the notch is a ground-island cut, exactly what the manual tool produces at this corner
    const notch = getCell(state.cells, 4, 4)!.terrain!;
    expect(notch.type, 'ground island (None) cell').toBe(TerrainType.None);
    expect(notch.patchOnly).toBeFalsy();
    expect(notch.corners![0], 'TL rounds out into the water').toBe('fan');
    // no cascade: (4,5) has water on only ONE edge — not an island corner; stays plain ground
    expect(getCell(state.cells, 4, 5)!.terrain, 'no cascaded fill down the bank').toBeNull();
  });

  it('RIVER stroke: every auto-written cut is MODIFIABLE by the manual EdgeCutTool (cyclable site)', () => {
    // The user's key complaint: auto-trimmed river cells were dead to the manual tool. After a river
    // stroke's auto-trim, clicking the bend intersection must find a cut site and change state.
    const state = makeState(12, 12);
    const RIVER: [number, number][] = [[3, 3], [4, 3], [3, 4], [3, 5]];
    for (const [x, y] of RIVER) setTerrain(state, x, y, TerrainType.Water, 0);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex);
    applyAutoEdgeCut(ctx, 'round', RIVER.map(([x, y]) => ({ x, y })), []);
    const before = ex.getUndoStackSize();
    const beforeCorner = getCell(state.cells, 4, 4)!.terrain!.corners![0];
    new EdgeCutTool().onPointerDown({ x: 3, y: 3 }, { x: 0, y: 0 } as any, ctx); // governs the notch TL
    expect(ex.getUndoStackSize(), 'manual click landed a command').toBeGreaterThan(before);
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
    // idx0 keeps its manual triangle; the other three round.
    expect(getCell(state.cells, 5, 5)!.terrain!.corners).toEqual(['tri-SE', 'fan', 'fan', 'fan']);
  });
});

describe('applyAutoEdgeCut — road/tile', () => {
  function addRoad(state: any, x: number, y: number): PlacedObject {
    const road: PlacedObject = {
      id: `r-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
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
