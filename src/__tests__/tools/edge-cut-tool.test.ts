import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { makeState, setTerrain } from '../rules/_helpers';
import { getCell } from '../../core/model/grid-model';
import { solidTopOf, surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { EdgeCutTool } from '../../tools/edge-cut/edge-cut-tool';
import { TerrainType, type Command, type EditorEvents, type GridState } from '../../core/model/types';
import type { ToolContext } from '../../tools/types';

function ctxFor(state: GridState, exec: CommandExecutor): ToolContext {
  return {
    gridState: state,
    executeCommand: (c: Command) => exec.execute(c),
    getUndoStackSize: () => exec.getUndoStackSize(),
    collapseHistory: (s: number) => exec.collapseHistory(s),
    commitStroke: (s: number) => exec.commitStroke(s),
  } as unknown as ToolContext;
}

describe('EdgeCutTool — gamma over a hidden lower block', () => {
  it('rounds the HIGHER tier at a concave corner (raises the hidden layer-1 block to layer 2), not trims it', () => {
    const state = makeState(20, 20);
    // An L of tier-2 wrapping a tier-1 block in the inner (concave) corner at (6,6).
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 6, TerrainType.Mountain, 2);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1); // the hidden layer-1 block in the notch
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    // Intersection (5,5) is the shared corner of cells (5,5),(6,5),(5,6),(6,6) — the L's concave corner.
    new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));

    const notch = getCell(state.cells, 6, 6)!.terrain!;
    expect(notch.type).toBe(TerrainType.Mountain);
    expect(notch.elevation, 'notch raised to the surrounding tier 2').toBe(2);
    expect(notch.patchOnly, 'notch became a rounding patch').toBe(true);
    expect(notch.corners?.[0], 'NW corner fanned (rounded)').toBe('fan');
  });

  it('a gamma fillet and an outer cut COEXIST on one cell — each corner is independent (through reconcile)', () => {
    // The user's exact case: a 2x2 of three tier-2 cells + one layer-1 cell (3,4) at the bottom-left, wrapped
    // by tier-2 on its N/E (so its TR is the tier-2 concave). The user bevels the exposed BL corner, THEN
    // rounds the tier-2 inner corner (TR gamma). Rounding the gamma must NOT wipe or lock the BL bevel — and
    // it must SURVIVE the post-stroke reconcile pass (which previously mistook the square base for the fillet
    // and reverted the whole cell). Corners are independent; an edge-cut only touches its own corner.
    const state = makeState(20, 20);
    setTerrain(state, 3, 3, TerrainType.Mountain, 2);
    setTerrain(state, 4, 3, TerrainType.Mountain, 2);
    setTerrain(state, 3, 4, TerrainType.Mountain, 1); // the layer-1 cell (bottom-left)
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();

    tool.onPointerDown({ x: 2, y: 4 }, { x: 2, y: 4 }, ctxFor(state, exec)); // bevel the exposed BL corner
    expect(getCell(state.cells, 3, 4)!.terrain?.corners?.[2], 'BL bevelled').toBe('fan');

    tool.onPointerDown({ x: 3, y: 3 }, { x: 3, y: 3 }, ctxFor(state, exec)); // round the tier-2 inner corner (TR gamma)
    const c = getCell(state.cells, 3, 4)!.terrain!;
    expect(c.patchOnly, 'now carries a gamma fillet').toBe(true);
    expect(c.patchBase, 'real layer-1 base preserved').toBe(1);
    expect(c.corners?.[1], 'TR is the gamma fillet').toBe('fan');
    expect(c.corners?.[2], 'BL bevel is PRESERVED, not wiped or reverted by reconcile').toBe('fan');

    // and the BL outer corner is STILL editable (not locked by the patch flag)
    tool.onPointerDown({ x: 2, y: 4 }, { x: 2, y: 4 }, ctxFor(state, exec)); // BL fan -> tri
    const c2 = getCell(state.cells, 3, 4)!.terrain!;
    expect(c2.corners?.[2], 'BL cycled on (outer tri), still editable').toBe('tri-NE');
    expect(c2.corners?.[1], 'TR gamma untouched by the BL edit').toBe('fan');
  });

  it('an edge cut never changes a cell real support surface — it is silhouette-only (no reconcile needed)', () => {
    const state = makeState(20, 20);
    setTerrain(state, 10, 10, TerrainType.Mountain, 3); // a lone tier-3 block
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 6, TerrainType.Mountain, 2);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1); // a layer-1 block in an L's concave
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();

    const surf = (x: number, y: number) => surfaceElevation(getCell(state.cells, x, y)?.terrain);
    const loneBefore = surf(10, 10);
    tool.onPointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, ctxFor(state, exec)); // outer-cut a corner
    expect(getCell(state.cells, 10, 10)!.terrain?.corners?.some(c => c !== 'square'), 'a corner was cut').toBe(true);
    expect(surf(10, 10), 'an outer cut leaves the support surface unchanged').toBe(loneBefore);

    const notchBefore = surf(6, 6); // the standable tier-1 surface
    tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec)); // gamma the concave (TL fillet)
    expect(getCell(state.cells, 6, 6)!.terrain?.patchOnly, 'now a gamma patch').toBe(true);
    expect(surf(6, 6), 'the gamma fillet is cosmetic — support stays the layer-1 base').toBe(notchBefore);
  });

  it('cycling the inner (gamma) corner OFF keeps the BL bevel — only the gamma corner resets', () => {
    // Same 2x2; (3,4) carries BL bevel + TR gamma. Cycling the TR gamma back to default must reset ONLY the
    // TR corner — the BL bevel stays (it is a separate corner). Previously the reconcile revert repainted the
    // whole base block and wiped the bevel.
    const state = makeState(20, 20);
    setTerrain(state, 3, 3, TerrainType.Mountain, 2);
    setTerrain(state, 4, 3, TerrainType.Mountain, 2);
    setTerrain(state, 3, 4, TerrainType.Mountain, 1);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();
    tool.onPointerDown({ x: 2, y: 4 }, { x: 2, y: 4 }, ctxFor(state, exec)); // BL bevel
    tool.onPointerDown({ x: 3, y: 3 }, { x: 3, y: 3 }, ctxFor(state, exec)); // TR gamma (fan)
    expect(getCell(state.cells, 3, 4)!.terrain?.corners?.[1]).toBe('fan');

    tool.onPointerDown({ x: 3, y: 3 }, { x: 3, y: 3 }, ctxFor(state, exec)); // TR fan -> tri
    tool.onPointerDown({ x: 3, y: 3 }, { x: 3, y: 3 }, ctxFor(state, exec)); // TR tri -> empty (gamma off)

    const c = getCell(state.cells, 3, 4)!.terrain!;
    expect(c.type).toBe(TerrainType.Mountain);
    expect(c.elevation, 'back to the real layer-1 block').toBe(1);
    expect(!!c.patchOnly, 'no longer a patch').toBe(false);
    expect(c.corners?.[2], 'BL bevel PRESERVED through the gamma reset').toBe('fan');
    expect(c.corners?.[1] ?? 'square', 'TR reset to default').toBe('square');
  });

  it('cycling the Γ fillet OFF leaves the N-1 base block (does not peel it to nothing)', () => {
    const state = makeState(20, 20);
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 6, TerrainType.Mountain, 2);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1); // the layer-1 base the fillet rounds
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();
    const click = () => tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));

    click(); // tier-1 → tier-2 patch, NW = fan
    expect(getCell(state.cells, 6, 6)!.terrain?.corners?.[0]).toBe('fan');
    click(); // fan → tri
    expect(getCell(state.cells, 6, 6)!.terrain?.corners?.[0]).toBe('tri-NW');
    click(); // tri → no-cut: must restore the tier-1 base, NOT null the cell

    const base = getCell(state.cells, 6, 6)!.terrain;
    expect(base, 'cell still has terrain after cycling the fillet off').not.toBeNull();
    expect(base?.type).toBe(TerrainType.Mountain);
    expect(base?.elevation, 'dropped back to the tier-1 base block').toBe(1);
    expect(base?.patchOnly ?? false, 'no longer a patch').toBe(false);
    expect(base?.corners, 'a plain square block').toBeUndefined();

    click(); // and cycling forward again re-rounds it: tier-1 → tier-2 fillet
    expect(getCell(state.cells, 6, 6)!.terrain?.elevation).toBe(2);
    expect(getCell(state.cells, 6, 6)!.terrain?.corners?.[0]).toBe('fan');
  });

  it('rounding an EMPTY notch NEVER creates a base — cosmetic at every tier (consistent with tier 1)', () => {
    // The user's bug: an L at tier N with an EMPTY notch. Rounding the inner corner must NOT raise the
    // notch into a tier-(N-1) block; it is a cosmetic fillet (patchBase 0, no structural mass) at every N.
    for (const N of [1, 2, 3]) {
      const state = makeState(20, 20);
      setTerrain(state, 5, 5, TerrainType.Mountain, N);
      setTerrain(state, 6, 5, TerrainType.Mountain, N);
      setTerrain(state, 5, 6, TerrainType.Mountain, N);
      // (6,6) deliberately EMPTY
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
      new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));
      const t = getCell(state.cells, 6, 6)!.terrain!;
      expect(t.patchOnly, `N=${N}: a cosmetic patch`).toBe(true);
      expect(t.elevation, `N=${N}: fillet renders at the surrounding tier`).toBe(N);
      expect(t.patchBase, `N=${N}: NO real base captured`).toBe(0);
      expect(t.corners?.[0], `N=${N}: NW fanned`).toBe('fan');
      expect(solidTopOf(t, TerrainType.Mountain), `N=${N}: contributes NO structural mass (no base block)`).toBe(0);
      expect(surfaceElevation(t), `N=${N}: placement/support sees ground, not a block`).toBe(0);
    }
  });

  it('only a CONVEX corner of the silhouette at the cell layer cuts — a low cell cuts toward GROUND, not toward a TALLER neighbour', () => {
    // A 2x2: three layer-2 cells + one layer-1 cell (3,4) at the bottom-left. (3,4) borders open ground on
    // W/S and the taller layer-2 on N/E. Only its SW corner (both edges ground) is a real convex corner of
    // the layer-1 silhouette; the corners toward the taller neighbours are NOT corners at layer 1 (that
    // neighbour's base covers the edge), so they stay square.
    const state = makeState(12, 12);
    setTerrain(state, 3, 3, TerrainType.Mountain, 2);
    setTerrain(state, 4, 3, TerrainType.Mountain, 2);
    setTerrain(state, 3, 4, TerrainType.Mountain, 1); // the layer-1 cell (bottom-left)
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    const locked = computeLockedCorners(state, 3, 4, 'terrain');
    expect(locked[2], 'BL (SW, both edges open ground) is the one convex corner → cuttable').toBe(false);
    expect(locked[0], 'TL toward the taller N neighbour is NOT a corner here → locked').toBe(true);
    expect(locked[3], 'BR toward the taller E neighbour is NOT a corner here → locked').toBe(true);
    // the taller cell DOES round down toward the lower one (the lower step does not reach its layer)
    expect(computeLockedCorners(state, 4, 4, 'terrain')[2], 'layer-2 (4,4) BL toward the lower (3,4) is cuttable').toBe(false);
  });

  it('a low cell mid-edge has NO cuttable corner toward a taller neighbour; the taller cell beside it does', () => {
    // The user's case: a 4x4 layer-1 base, with the right half raised to layer-2. At the bottom step, the
    // low cell 1*=(3,5) sits between same-height layer-1 (W,N) and the taller 2*=(4,5) (E). It is not a
    // corner at layer 1 anywhere, so NONE of its corners cut. 2* IS a convex corner of the layer-2
    // silhouette toward the lower 1*, so 2*'s BL cuts (bevels down).
    const state = makeState(10, 10);
    const M = TerrainType.Mountain;
    for (const [x, y, e] of [[2,2,2],[3,2,2],[4,2,2],[5,2,2],[2,3,2],[3,3,2],[4,3,2],[5,3,2],
                             [2,4,1],[3,4,1],[4,4,2],[5,4,2],[2,5,1],[3,5,1],[4,5,2],[5,5,2]] as const) {
      setTerrain(state, x, y, M, e);
    }
    expect(computeLockedCorners(state, 3, 5, 'terrain'), '1* (low, mid-edge) has no cuttable corner').toEqual([true, true, true, true]);
    expect(computeLockedCorners(state, 4, 5, 'terrain')[2], '2* BL (convex toward the lower 1*) cuts').toBe(false);
  });

  it('a corner toward a SAME-height neighbour stays locked (a flat interior seam is not cuttable)', () => {
    const state = makeState(12, 12);
    setTerrain(state, 3, 3, TerrainType.Mountain, 1);
    setTerrain(state, 4, 3, TerrainType.Mountain, 1); // equal-height east neighbour
    const locked = computeLockedCorners(state, 3, 3, 'terrain');
    expect(locked[1], 'TR toward the equal E neighbour stays locked').toBe(true);
    expect(locked[3], 'BR toward the equal E neighbour stays locked').toBe(true);
    expect(locked[0], 'TL toward open ground stays cuttable').toBe(false);
  });

  it('one click cycles ALL cut sites at a junction independently — 3x3 = 9 combinations, not lockstep', () => {
    // The user's water/mountain junction: clicking the centre offers a GAMMA (the (3,3) ground pocket the two
    // mountains wrap) AND an OUTER cut (the water w(2,2) corner). They share ONE base-3 odometer, so 9 clicks
    // visit all 9 (outer, gamma) combinations rather than moving the two in lockstep through only 3.
    const state = makeState(10, 10);
    const M = TerrainType.Mountain, W = TerrainType.Water;
    setTerrain(state, 1, 1, W, 0); setTerrain(state, 2, 1, W, 0); setTerrain(state, 3, 1, M, 1); setTerrain(state, 4, 1, M, 1);
    setTerrain(state, 1, 2, W, 0); setTerrain(state, 2, 2, W, 0); setTerrain(state, 3, 2, M, 1); setTerrain(state, 4, 2, M, 1);
    setTerrain(state, 1, 3, M, 1); setTerrain(state, 2, 3, M, 1); setTerrain(state, 1, 4, M, 1); setTerrain(state, 2, 4, M, 1);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();
    const digit = (c?: string) => (c === 'fan' ? 1 : c === 'tri-NW' ? 2 : 0); // OUTER_TRI[3] === INNER_TRI[0] === 'tri-NW'
    const outer = () => digit(getCell(state.cells, 2, 2)!.terrain?.corners?.[3]); // w(2,2).BR
    const gamma = () => { const t = getCell(state.cells, 3, 3)?.terrain; return t?.patchOnly ? digit(t.corners?.[0]) : 0; }; // (3,3).TL
    const seen = new Set<string>();
    for (let i = 0; i < 9; i++) {
      tool.onPointerDown({ x: 2, y: 2 }, { x: 2, y: 2 }, ctxFor(state, exec));
      seen.add(`${outer()},${gamma()}`);
    }
    expect(seen.size, 'all 9 (outer, gamma) combinations visited over 9 clicks').toBe(9);
  });

  it('cycling a from-empty gamma OFF returns to EMPTY — no base block is left behind', () => {
    const state = makeState(20, 20);
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 6, TerrainType.Mountain, 2);
    // (6,6) EMPTY — no real base anywhere
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();
    const click = () => tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));
    click(); // empty → fan patch (patchBase 0)
    expect(getCell(state.cells, 6, 6)!.terrain?.corners?.[0]).toBe('fan');
    click(); // fan → tri
    expect(getCell(state.cells, 6, 6)!.terrain?.corners?.[0]).toBe('tri-NW');
    click(); // tri → off: a from-empty gamma leaves NO base, so the cell returns to plain empty
    expect(getCell(state.cells, 6, 6)!.terrain, 'from-empty gamma cycles back to empty, no tier-1 block').toBeNull();
  });

  it('Bug 3: water in a higher-mountain pocket is NEVER overwritten — it rounds its own outer corner', () => {
    const state = makeState(20, 20);
    // An L of mountain@1 wrapping a GROUND-LEVEL water cell in the concave corner at (6,6).
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Water, 0); // the water tucked into the mountain notch
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));

    const t = getCell(state.cells, 6, 6)!.terrain!;
    expect(t.type, 'water survives — the notch-fill never overwrites a different real surface').toBe(TerrainType.Water);
    expect(t.elevation).toBe(0);
    expect(t.patchOnly ?? false, 'not turned into a mountain fillet').toBe(false);
    expect(t.corners?.[0], "the water rounds its OWN outer corner (the water's out-cut is prioritized)").toBe('fan');
  });

  it('Bug 1 (option A): clicking a ground island rounds the ISLAND\'s own corner, not the diagonal water', () => {
    const state = makeState(12, 12);
    // ground island at (5,5) (null terrain) ringed by water@0 on all 8 neighbours
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      setTerrain(state, 5 + dx, 5 + dy, TerrainType.Water, 0);
    }
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    // clicking macro (5,5) takes the island cell (5,5) at its BR corner (the corner poking SE into water)
    new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));

    const isle = getCell(state.cells, 5, 5)!.terrain!;
    expect(isle.type, 'a GROUND island-cut cell (reads as ground; renders grass rounded + water behind)').toBe(TerrainType.None);
    expect(isle.elevation, 'still ground level').toBe(0);
    expect(isle.corners?.[3], 'the island rounds its OWN BR corner').toBe('fan');
    // the surrounding water is untouched — the cut is on the island, not offset onto a diagonal water cell
    expect(getCell(state.cells, 6, 6)!.terrain!.corners ?? null, 'diagonal water stays square').toBeNull();
  });

  it('Bug 1: cycling the island corner back to square restores plain ground (no stray None cell)', () => {
    const state = makeState(12, 12);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      setTerrain(state, 5 + dx, 5 + dy, TerrainType.Water, 0);
    }
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();
    tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec)); // BR: square→fan
    tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec)); // fan→tri
    tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec)); // tri→square → cell back to null ground
    expect(getCell(state.cells, 5, 5)!.terrain, 'the island is plain ground again').toBeNull();
  });

  it('Issue 1: a diagonal pinch traverses all 3x3 corner combos, not lockstep', () => {
    const state = makeState(12, 12);
    // two mountain blocks meeting only at a diagonal point (a pinch); both pinch corners are cuttable
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new EdgeCutTool();
    // clicking macro cell (5,5) processes (5,5).BR [1*] and (6,6).TL [2*] together
    tool.onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));
    // one COMBINED step: 1* advances, 2* stays — a MIXED state the old lockstep could never reach
    expect(getCell(state.cells, 5, 5)!.terrain!.corners?.[3], '1* (BR) rounded').toBe('fan');
    expect(getCell(state.cells, 6, 6)!.terrain?.corners?.[0] ?? 'square', '2* (TL) independent — still square').toBe('square');
  });

  it('Issue A: all 3 pinch cases behave identically — both corners traverse 3x3, no special case', () => {
    // each pinch: clicking (5,5) processes (5,5).BR [1*] + (6,6).TL [2*]; after one combined step 1* advances,
    // 2* stays — a MIXED state, proving both are independent cuttable slots regardless of the type combo.
    for (const [t1, t2] of [
      [TerrainType.Mountain, TerrainType.Mountain],
      [TerrainType.Water, TerrainType.Water],
      [TerrainType.Mountain, TerrainType.Water], // mountain+water is NOT special — same as the others
    ] as const) {
      const s = makeState(12, 12);
      setTerrain(s, 5, 5, t1, t1 === TerrainType.Water ? 0 : 1); // ground-level lake / a low hill
      setTerrain(s, 6, 6, t2, t2 === TerrainType.Water ? 0 : 1);
      new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(s, new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry())));
      expect(getCell(s.cells, 5, 5)!.terrain!.corners?.[3], `${t1}+${t2}: 1* rounds`).toBe('fan');
      expect(getCell(s.cells, 6, 6)!.terrain?.corners?.[0] ?? 'square', `${t1}+${t2}: 2* independent`).toBe('square');
    }
  });

  it('a mountain island in water is cuttable — rounds the rock (generic island rule, no MOUNTAIN-BANK lock)', () => {
    const state = makeState(12, 12);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1); // a rock
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      setTerrain(state, 5 + dx, 5 + dy, TerrainType.Water, 0); // a lake around it
    }
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));
    const t = getCell(state.cells, 5, 5)!.terrain!;
    expect(t.type, 'still a mountain rock (not flooded)').toBe(TerrainType.Mountain);
    expect(t.elevation).toBe(1);
    expect(t.corners?.[3], 'the rock rounds its BR corner toward the water').toBe('fan');
  });

  it('ATOMIC UNDO: a gamma click (raise + trim) is ONE undo step that restores the prior state', () => {
    const state = makeState(20, 20);
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 6, TerrainType.Mountain, 2);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    new EdgeCutTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctxFor(state, exec));

    expect(getCell(state.cells, 6, 6)!.terrain?.patchOnly, 'gamma applied').toBe(true);
    expect(exec.getUndoStackSize(), 'raise paint + trim folded into one entry').toBe(1);
    exec.undo();
    const t = getCell(state.cells, 6, 6)!.terrain;
    expect(t?.elevation, 'one undo restores the original tier-1 block').toBe(1);
    expect(t?.patchOnly ?? false).toBe(false);
  });
});
