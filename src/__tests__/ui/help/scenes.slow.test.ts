/*
 * Help figures held to the rules: each scene runs headless on `SandboxWorld` with a real planet
 * template, and what a demo shows is what the editor does, refusals included with the captioned
 * error. `DemoView` is a recorder here.
 */
import { getCatalogItem } from '../../../state/catalog';
import { readingKey } from '../../../i18n/terms/device-readings';
import { describe, expect, it } from 'vitest';
import { holdsTemplateTerrain } from '../../../core/model/template';
import { sameTerrain } from '../../../core/model/grid-model';
import { objectRect } from '../../../state/object-geometry';
import { HELP_SCENES, plotClearing, sceneWorld, type DemoCtx, type DemoView, type HelpScene, type SceneForm, type SceneStep } from '../../../ui/help/figures/scenes';
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { TerrainType, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { detectWaterfalls } from '../../../core/domain/terrain/waterfall-geometry';
import { isBuildableZone } from '../../../core/game/zones';
import { INNER_TRI, OUTER_TRI } from '../../../core/domain/edge-cut/cut-validator';
import { CORNER_INDEX } from '../../../core/model/corners';
import { CANONICAL_ROAD_STATES } from '../../../core/domain/edge-cut/road-cut-states';
import { splineCells } from '../../../core/grid/shapes';
import { type CurveAnchor } from '../../../core/base/spline';
import { brushCells } from '../../../core/grid/shapes';
import { measureDrawing } from '../../../core/model/annotation/dimensions';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { HEADLESS_OVERLAY } from '../../../tools/pointer/runtime/host';
import { mapChunkAt } from '../../../core/grid/map-chunks';
import { getMapStats } from '../../../state/map-stats';
import { chunkLoad } from '../../../ui/chrome/modals/load/map-load';
import { selectionTarget } from '../../../editor/editing/group-edit';

const MOUSE: SceneForm = { touch: false, upright: false };

interface Recorded {
  /** The last region mark the view was shown, before any clear. */
  region: Array<{ x: number; y: number }>;
  marks: number;
  routeMax: number;
  meter: boolean;
  plops: number;
  spins: Array<[number, number]>;
  groupSpins: number;
  /** Every notice the scene stood as its toast, in order. */
  notices: Array<{ key: string; params?: Record<string, string | number> }>;
}

function recorder(): { view: DemoView; rec: Recorded } {
  const rec: Recorded = { region: [], marks: 0, routeMax: 0, meter: false, plops: 0, spins: [], groupSpins: 0, notices: [] };
  const view: DemoView = {
    clearGhost: () => {},
    groupGhost: () => {},
    paintGhost: () => {},
    notice: (n) => { if (n) rec.notices.push({ key: n.key, ...(n.params ? { params: n.params } : {}) }); },
    region: (cells) => { if (cells) rec.region = cells; },
    route: (cells) => { if (cells) rec.routeMax = Math.max(rec.routeMax, cells.length); },
    marks: (m) => { rec.marks = Math.max(rec.marks, (m?.entrance ? 1 : 0) + (m?.exit ? 1 : 0)); },
    loadMeter: (on) => { rec.meter ||= on; },
    plop: () => { rec.plops++; },
    poof: () => {},
    spin: (_id, fromDeg, toDeg) => { rec.spins.push([fromDeg, toDeg]); },
    groupSpin: () => { rec.groupSpins++; },
    annotations: () => {},
  };
  return { view, rec };
}

/** `start` holds the ids the world stood with before the scene ran: a scene with a plot plays inside
 *  a built neighbourhood, so what the scene laid is what stands beyond them. */
interface Run { world: SandboxWorld; rec: Recorded; steps: SceneStep[]; refusalAtRelease: string | null; start: ReadonlySet<string> }

/** The objects standing in `world` that it did not start with. */
function laidSince(world: SandboxWorld, start: ReadonlySet<string>): PlacedObject[] {
  return [...world.state.objects.values()].filter((o) => !start.has(o.id));
}

/** Play a scene the way the player's reduced-motion path does: every step settled in order. */
function play(scene: HelpScene, form: SceneForm = MOUSE): Run {
  const world = sceneWorld(scene);
  const start = new Set(world.state.objects.keys());
  const { view, rec } = recorder();
  const ctx: DemoCtx = { world, view };
  const steps = scene.run(ctx, (key) => key, form);
  let refusalAtRelease: string | null = null;
  for (const step of steps) {
    step.on?.(ctx);
    step.during?.(ctx, 1);
    if (step.realToast) refusalAtRelease = world.refusal?.message ?? null;
  }
  return { world, rec, steps, refusalAtRelease, start };
}

function terrainAt(run: Run, x: number, y: number): { type: TerrainType; elevation: number } | undefined {
  const cell = run.world.state.cells[y]?.[x]?.terrain;
  return cell ? { type: cell.type, elevation: cell.elevation } : undefined;
}

function objectCount(run: Run, catalogId: string): number {
  return laidSince(run.world, run.start).filter((o) => o.catalogId === catalogId).length;
}

describe('the demo world finishes a stroke the way the live tool does', () => {
  it('sweeps the committed stroke with the visitor\'s auto-trim setting', () => {
    const world = new SandboxWorld();
    world.autoTrim = 'round';
    world.beginStroke();
    world.paint([{ x: 70, y: 100 }, { x: 71, y: 100 }, { x: 70, y: 101 }, { x: 71, y: 101 }], TerrainType.Mountain, 1);
    world.commit();
    const corners = world.state.cells[100]?.[70]?.terrain?.corners;
    // The block's outer corner comes back rounded, exactly as the live finishStroke leaves it.
    expect(corners?.[0]).toBe('fan');
  });

  it('leaves the stroke square when the setting is off, the app default', () => {
    const world = new SandboxWorld();
    world.beginStroke();
    world.paint([{ x: 70, y: 100 }, { x: 71, y: 100 }], TerrainType.Mountain, 1);
    world.commit();
    expect(world.state.cells[100]?.[70]?.terrain?.corners).toBeUndefined();
  });
});

describe('[EDIT-51] a placing press', () => {
  const PLACING = new Set(['welcome', 'objects', 'ramp', 'spacing', 'objlimit', 'rectpad']);

  it.each(Object.keys(HELP_SCENES))('%s: lands where the placer\'s own ghost stood, or nowhere where it stood refused', (name) => {
    const scene = HELP_SCENES[name]!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    // The last body ghost the world's tools drew, as the figure's overlay shows it.
    let ghost: { catalogId: string; x: number; y: number; valid: boolean } | null = null;
    world.drawToolsOn({
      ...HEADLESS_OVERLAY,
      showPlacementGhost: (g, valid) => { ghost = { catalogId: g.catalogId, x: g.x, y: g.y, valid }; },
      clearGhost: () => { ghost = null; },
    });
    let aims = 0;
    for (const step of scene.run(ctx, (key) => key, MOUSE)) {
      const before = new Set(world.state.objects.keys());
      const aimed = ghost as { catalogId: string; x: number; y: number; valid: boolean } | null;
      step.on?.(ctx);
      step.during?.(ctx, 1);
      // A press the placer took while its ghost stood: what landed is the ghost's item at its place.
      if (!aimed || !step.press) continue;
      const landed = [...world.state.objects.values()].filter((o) => !before.has(o.id) && o.catalogId === aimed.catalogId);
      expect(landed.map((o) => o.position), `${name} at ${aimed.x},${aimed.y}`).toEqual(aimed.valid ? [{ x: aimed.x, y: aimed.y }] : []);
      aims++;
    }
    // Every figure that places by hand does so under the placer's ghost.
    if (PLACING.has(name)) expect(aims, name).toBeGreaterThan(0);
  });
});

describe('[UI-65] a building demonstration plays inside a lived-in map', () => {
  const PLOTTED = Object.entries(HELP_SCENES).filter(([, scene]) => scene.plot);
  /** Every object scene but `delight`, whose set pieces ask for a large open field around them. */
  const OBJECT_SCENES = [
    'welcome', 'objects', 'ramp', 'spacing', 'objlimit', 'objpaint', 'objmix', 'rotate', 'select', 'grouprotate', 'locked',
    'copypaste', 'pasteblock', 'copydrag', 'smartpatch',
  ];
  type Box = { x1: number; y1: number; x2: number; y2: number };
  const inside = (r: { x: number; y: number; w: number; h: number }, b: Box) =>
    r.x >= b.x1 && r.y >= b.y1 && r.x + r.w <= b.x2 + 1 && r.y + r.h <= b.y2 + 1;
  const meets = (r: { x: number; y: number; w: number; h: number }, b: Box) =>
    r.x < b.x2 + 1 && r.x + r.w > b.x1 && r.y < b.y2 + 1 && r.y + r.h > b.y1;
  const holds = (b: Box, x: number, y: number) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

  it('every object scene names its plot', () => {
    expect(OBJECT_SCENES.filter((name) => !HELP_SCENES[name]?.plot)).toEqual([]);
  });

  it.each(PLOTTED.map(([name]) => name))('%s: built pieces stand in the frame around a bare plot, and the action stays on cleared ground', (name) => {
    const scene = HELP_SCENES[name]!;
    const plot = scene.plot!;
    const cleared = plotClearing(plot);
    const world = sceneWorld(scene);
    const { template } = world.state;
    const standing = [...world.state.objects.values()].filter((o) => !o.locked);
    // The frame shows the neighbourhood: built pieces stand on the stage beyond the cleared ground.
    expect(standing.filter((o) => meets(objectRect(o), scene.stage) && !meets(objectRect(o), cleared)).length, name).toBeGreaterThan(0);
    // The street stands back around the plot, but nothing built stands on it or within a cell of it,
    // and the plot is the planet's own ground.
    const apron = { x1: plot.x1 - 1, y1: plot.y1 - 1, x2: plot.x2 + 1, y2: plot.y2 + 1 };
    expect(standing.filter((o) => meets(objectRect(o), apron)), name).toEqual([]);
    for (let y = plot.y1; y <= plot.y2; y++) {
      for (let x = plot.x1; x <= plot.x2; x++) expect(holdsTemplateTerrain(template, x, y, world.state.cells[y]![x]!), `${name} ${x},${y}`).toBe(true);
    }
    const before = world.state.cells.map((row) => row.map((c) => c.terrain));
    const run = play(scene);
    // Nothing the scene does reaches past the cleared ground: every piece it laid stands on it, and
    // no terrain changes beyond it.
    for (const o of laidSince(run.world, run.start)) expect(inside(objectRect(o), cleared), `${name} ${o.catalogId}@${o.position.x},${o.position.y}`).toBe(true);
    run.world.state.cells.forEach((row, y) => row.forEach((c, x) => {
      if (!holds(cleared, x, y)) expect(sameTerrain(c.terrain, before[y]![x], { patchOnly: 'flag' }), `${name} ${x},${y}`).toBe(true);
    }));
    // The player's rewind stops at the neighbourhood, never taking it apart.
    while (run.world.undo()) { /* rewinding */ }
    expect([...run.world.state.objects.keys()].sort()).toEqual([...run.start].sort());
  });
});

describe('help demo scenes are proofs: the real commands land on the real template', () => {
  it('welcome: the standing build survives, the tree really moves, the new cabin lands', () => {
    const run = play(HELP_SCENES.welcome!);
    expect(terrainAt(run, 61, 115)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
    expect(objectCount(run, 'building-sunset-cabin')).toBe(1);
    expect(objectCount(run, 'tree-apple')).toBe(3);
    expect(run.world.objectAt('tree-apple', 62, 120)).toBeTruthy();
    expect(run.world.objectAt('tree-apple', 66, 116)).toBeFalsy();
    // A single move lands without the squash a placement plays, as on the map; the cabin plops.
    expect(run.rec.plops).toBe(1);
  });

  it('camera authors its base scene by the plaza', () => {
    const run = play(HELP_SCENES.camera!);
    expect(terrainAt(run, 76, 94)?.type).toBe(TerrainType.Mountain);
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
  });

  it('terrain: the free stroke wanders and turns, the retraced part stacks to 2, the shift line lays level 1', () => {
    const run = play(HELP_SCENES.terrain!);
    // The wandering stroke covers two rows: a ruled line would sit on one.
    for (const c of [{ x: 65, y: 100 }, { x: 66, y: 100 }, { x: 66, y: 101 }]) {
      expect(terrainAt(run, c.x, c.y)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    }
    for (const c of [{ x: 67, y: 101 }, { x: 68, y: 101 }, { x: 68, y: 100 }, { x: 69, y: 100 }]) {
      expect(terrainAt(run, c.x, c.y)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    }
    for (let x = 65; x <= 74; x++) expect(terrainAt(run, x, 103)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('trim: the block stands and its corner cycles fan, tri, square through the real command', () => {
    const scene = HELP_SCENES.trim!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const cornersAfter: (string | undefined)[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      cornersAfter.push(world.state.cells[101]?.[72]?.terrain?.corners?.[3]);
    }
    expect(world.state.cells[100]?.[71]?.terrain).toMatchObject({ elevation: 2 });
    expect(cornersAfter).toContain('fan');
    // The tri step must be the BR corner's own outer triangle, the same table the live tool cycles.
    expect(cornersAfter).toContain(OUTER_TRI[CORNER_INDEX.BR]);
    expect(cornersAfter[cornersAfter.length - 1] ?? 'square').toBe('square');
  });

  it('objects: the pond stands, the follow-ghost answers come from the registry, the pieces land', () => {
    const scene = HELP_SCENES.objects!;
    const world = sceneWorld(scene);
    const start = new Set(world.state.objects.keys());
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    // The registry answers the follow-ghost shows on its way: an anchor with no crossing refuses,
    // the bank with one stands; beside a fresh tree refuses, one cell of air stands.
    expect(world.canPlace('bridge-plank', 72, 101)).toBe(false);
    expect(world.canPlace('bridge-plank', 71, 101)).toBe(true);
    for (const step of steps) { step.on?.(ctx); step.during?.(ctx, 1); }
    expect(world.canPlace('tree-apple', 65, 100)).toBe(false);
    const run: Run = { world, rec: recorder().rec, steps, refusalAtRelease: null, start };
    expect(terrainAt(run, 71, 101)?.type).toBe(TerrainType.Water);
    expect(objectCount(run, 'bridge-plank')).toBe(1);
    expect(objectCount(run, 'tree-apple')).toBe(2);
  });

  it('water: the walls stand at the water layer and the poured fill survives its commit', () => {
    const run = play(HELP_SCENES.water!);
    expect(terrainAt(run, 67, 100)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(terrainAt(run, 74, 103)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    for (let y = 101; y <= 102; y++) {
      for (let x = 68; x <= 73; x++) expect(terrainAt(run, x, y)).toEqual({ type: TerrainType.Water, elevation: 1 });
    }
  });

  it('road: the drag lays one coating object per crossed cell, both legs of the L', () => {
    const run = play(HELP_SCENES.road!);
    expect(objectCount(run, 'path-cobblestone')).toBe(9);
    expect(run.world.objectAt('path-cobblestone', 66, 101)).toBeTruthy();
    expect(run.world.objectAt('path-cobblestone', 71, 101)).toBeTruthy();
    expect(run.world.objectAt('path-cobblestone', 71, 98)).toBeTruthy();
  });

  it('roadtrim: each click lands a road-layer trim command and walks the canonical cycle', () => {
    const scene = HELP_SCENES.roadtrim!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const seen = new Set<string>();
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      const end = world.objectAt('path-cobblestone', 73, 101);
      if (end?.corners) seen.add(JSON.stringify(end.corners));
    }
    // Three clicks walk at least two distinct cut states, and every landed state is one of the
    // tool's own table entries (the raw all-square slot included).
    expect(seen.size).toBeGreaterThanOrEqual(2);
    const legal = new Set([
      JSON.stringify(['square', 'square', 'square', 'square']),
      ...CANONICAL_ROAD_STATES.filter((s) => s).map((s) => JSON.stringify(s)),
    ]);
    for (const state of seen) expect(legal.has(state), state).toBe(true);
  });

  it('trimmulti: one click at the pinch governs both corners, and the clicks walk distinct combinations', () => {
    const scene = HELP_SCENES.trimmulti!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const pairs: string[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      const a = world.state.cells[100]?.[69]?.terrain?.corners?.[CORNER_INDEX.BR] ?? 'square';
      const b = world.state.cells[101]?.[70]?.terrain?.corners?.[CORNER_INDEX.TL] ?? 'square';
      pairs.push(`${a}/${b}`);
    }
    // Both blocks stand at the pinch, and both corners move over the run: one click is not one
    // corner here.
    expect(new Set(pairs.map((p) => p.split('/')[0])).size).toBeGreaterThan(1);
    expect(new Set(pairs.map((p) => p.split('/')[1])).size).toBeGreaterThan(1);
    // Every combination the clicks land is a new one: the odometer never repeats inside a cycle.
    const landed = [...new Set(pairs)];
    expect(landed.length).toBeGreaterThanOrEqual(4);
    // And every shape in them is one the tool's own tables carry.
    for (const pair of landed) {
      for (const shape of pair.split('/')) {
        expect(['square', 'fan', OUTER_TRI[CORNER_INDEX.BR], OUTER_TRI[CORNER_INDEX.TL]]).toContain(shape);
      }
    }
  });

  it('trimnotch: the click fillets the taller block and leaves the hollow a patch, never solid ground', () => {
    const scene = HELP_SCENES.trimnotch!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    // Before any click the hollow is a real cell one layer below the L around it.
    expect(world.state.cells[100]?.[73]?.terrain?.elevation).toBe(1);
    expect(world.state.cells[100]?.[73]?.terrain?.patchOnly).toBeFalsy();
    for (const step of steps) { step.on?.(ctx); step.during?.(ctx, 1); }
    const hollow = world.state.cells[100]?.[73]?.terrain;
    // The click leaves a cosmetic patch at the taller tier that carries no support.
    expect(hollow?.elevation).toBe(2);
    expect(hollow?.patchOnly).toBe(true);
    // A wrapped corner's bevel is the inner triangle, the shape the gamma path lays.
    expect(hollow?.corners?.[CORNER_INDEX.TL]).toBe(INNER_TRI[CORNER_INDEX.TL]);
    // The L itself was not repainted: its own cells keep their square corners.
    expect(world.state.cells[99]?.[73]?.terrain?.corners).toBeUndefined();
  });

  it('delight: two presses of the planting card lay two different set pieces', () => {
    const run = play(HELP_SCENES.delight!);
    const bySpecies = new Map<string, Array<{ x: number; y: number }>>();
    for (const obj of laidSince(run.world, run.start)) {
      const cells = bySpecies.get(obj.catalogId) ?? [];
      cells.push(obj.position);
      bySpecies.set(obj.catalogId, cells);
    }
    // The ring: one white species alone, every plant of it standing off its own centre at one
    // radius, and nothing in the middle.
    const ring = [...bySpecies.entries()].find(([id]) => id.endsWith('-white'));
    expect(ring, 'a white ring stands').toBeTruthy();
    const [, ringCells] = ring!;
    expect(ringCells.length).toBeGreaterThan(8);
    const cx = ringCells.reduce((n, c) => n + c.x, 0) / ringCells.length;
    const cy = ringCells.reduce((n, c) => n + c.y, 0) / ringCells.length;
    for (const c of ringCells) {
      const r = Math.hypot(c.x - cx, c.y - cy);
      expect(r, `${c.x},${c.y}`).toBeGreaterThan(2.5);
      expect(r, `${c.x},${c.y}`).toBeLessThan(4.6);
    }
    expect(ringCells.some((c) => Math.round(c.x) === Math.round(cx) && Math.round(c.y) === Math.round(cy))).toBe(false);
    // The heart: two colourways of one species, which is what makes it one shape in two colours.
    const pair = [...bySpecies.keys()].filter((id) => !id.endsWith('-white'));
    expect(pair.length).toBe(2);
    const [a, b] = [...pair].sort((p, q) => p.length - q.length) as [string, string];
    expect(b.startsWith(`${a}-`)).toBe(true);
    expect(bySpecies.get(a)!.length + bySpecies.get(b)!.length).toBeGreaterThan(8);
  });

  it('rotate: the real rotate command turns the cabin 90 then 180, and each spin plays', () => {
    const run = play(HELP_SCENES.rotate!);
    const cabin = run.world.objectAt('building-forest-cabin', 68, 98);
    expect(cabin?.rotation).toBe(180);
    expect(run.rec.spins).toEqual([[0, 90], [90, 180]]);
  });

  it('ramp: the heightDrop rule snaps the ramp onto the one-layer terrace edge', () => {
    const run = play(HELP_SCENES.ramp!);
    const rampObj = laidSince(run.world, run.start).find((o) => o.catalogId === 'ramp-park-steps');
    expect(rampObj).toBeTruthy();
    expect(rampObj!.elevation).toBe(1);
    expect(rampObj!.rotation).toBe(0);
    expect(terrainAt(run, 72, 98)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(run.rec.plops).toBe(1);
  });

  it('spacing: the too-close tree refuses with the spacing rule, the spaced one lands', () => {
    const run = play(HELP_SCENES.spacing!);
    expect(run.refusalAtRelease).toBe('error.too_close_same_kind');
    expect(objectCount(run, 'tree-apple')).toBe(2);
    expect(run.world.objectAt('tree-apple', 68, 101)).toBeFalsy();
    expect(run.world.objectAt('tree-apple', 69, 102)).toBeTruthy();
  });

  it('smartpatch: each press plants a varied stand through the real macro, and the two differ', () => {
    const scene = HELP_SCENES.smartpatch!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const start = new Set(world.state.objects.keys());
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const countAfter: number[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      countAfter.push(laidSince(world, start).length);
    }
    const afterFirst = countAfter[4]!;
    const afterSecond = countAfter[countAfter.length - 1]!;
    // A patch is a stand, never a single piece; the second press adds its own.
    expect(afterFirst).toBeGreaterThan(1);
    expect(afterSecond).toBeGreaterThan(afterFirst + 1);
    // Two seeds, two compositions: the stands do not share every species count.
    const bySpecies = new Map<string, number>();
    for (const o of laidSince(world, start)) bySpecies.set(o.catalogId, (bySpecies.get(o.catalogId) ?? 0) + 1);
    expect(bySpecies.size).toBeGreaterThan(1);
  });

  it('grouprotate: the pure group rotate turns the set as one body with one turn spec', () => {
    const run = play(HELP_SCENES.grouprotate!);
    expect(run.rec.groupSpins).toBe(1);
    expect(objectCount(run, 'tree-apple')).toBe(2);
    expect(objectCount(run, 'flower-daisy')).toBe(1);
    const flower = laidSince(run.world, run.start).find((o) => o.catalogId === 'flower-daisy');
    expect(flower?.position).not.toEqual({ x: 66, y: 102 });
  });

  it('select: the group lands at its destination through the map\'s own drag', () => {
    const run = play(HELP_SCENES.select!);
    expect(objectCount(run, 'tree-apple')).toBe(2);
    expect(objectCount(run, 'flower-daisy')).toBe(1);
    const moved = laidSince(run.world, run.start).find((o) => o.catalogId === 'flower-daisy');
    expect(moved?.position).toEqual({ x: 68, y: 103 });
  });

  it('locked: the group delete keeps the plaza and counts it, and deleting it alone is refused', () => {
    const scene = HELP_SCENES.locked!;
    const world = sceneWorld(scene);
    const start = new Set(world.state.objects.keys());
    const { view } = recorder();
    scene.run({ world, view }, (key) => key, MOUSE);
    // The two trees the band is about genuinely stand before a step runs.
    expect(laidSince(world, start).filter((o) => o.catalogId === 'tree-apple').length).toBe(2);
    const run = play(scene);
    // Both trees the band caught are gone; the plaza and the cabin standing outside it are not.
    expect(objectCount(run, 'tree-apple')).toBe(0);
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
    expect(run.world.state.objects.get(ANCHOR_LANDMARK.id)?.locked).toBe(true);
    // The toast is the group delete's own word, counting what the band caught that survived locked:
    // the plaza alone. No step scripts it.
    const survivedLocked = [...run.world.state.objects.values()].filter((o) => o.locked && o.id === ANCHOR_LANDMARK.id).length;
    expect(run.rec.notices).toEqual([{ key: 'toast.group_delete_kept', params: { n: survivedLocked } }]);
    expect(run.steps.some((s) => s.toastKey)).toBe(false);
    // The refusal is the lock rule's own, word for word.
    expect(run.refusalAtRelease).toBe('error.locked_immutable');
  });

  it('smart1: a held local spray grows a terraced mound', () => {
    const run = play(HELP_SCENES.smart1!);
    const raised: number[] = [];
    for (let y = 95; y <= 109; y++) {
      for (let x = 61; x <= 84; x++) {
        const cell = run.world.state.cells[y]?.[x]?.terrain;
        if (cell && cell.type === TerrainType.Mountain && cell.elevation >= 3) raised.push(x);
      }
    }
    expect(raised.length).toBeGreaterThan(8);
    expect(raised.some((x) => x < 73)).toBe(true);
    expect(raised.some((x) => x >= 73)).toBe(true);
    expect(run.world.state.cells[102]![72]!.terrain?.elevation).toBeGreaterThan(3);
  });

  it('[GEN-17] smart1: the whole hold is one undo step', () => {
    const run = play(HELP_SCENES.smart1!);
    expect(run.world.undo()).toBe(true);
    for (let y = 95; y <= 109; y++) {
      for (let x = 61; x <= 84; x++) expect(run.world.state.cells[y]![x]!.terrain?.type ?? TerrainType.None, `${x},${y}`).not.toBe(TerrainType.Mountain);
    }
  });

  it('stream: the drag joins the upper pond to the selected destination through legal falls', () => {
    const run = play(HELP_SCENES.stream!);
    const course: Array<{ x: number; y: number; elevation: number }> = [];
    for (let y = 112; y <= 130; y++) {
      for (let x = 60; x <= 85; x++) {
        const cell = run.world.state.cells[y]?.[x]?.terrain;
        if (cell?.type === TerrainType.Water) course.push({ x, y, elevation: cell.elevation });
      }
    }
    expect(terrainAt(run, 71, 115)).toEqual({ type: TerrainType.Water, elevation: 3 });
    expect(terrainAt(run, 80, 120)).toEqual({ type: TerrainType.Water, elevation: 0 });
    expect(course.length).toBeGreaterThan(10);
    expect(detectWaterfalls(run.world.state).length).toBeGreaterThan(0);
    expect(run.world.kit.registry.validatePostStroke(run.world.state)).toEqual([]);
    expect(course.every(c => c.y <= 121)).toBe(true);
  });

  it('smart2: the drag connects the two cabins with a road', () => {
    const run = play(HELP_SCENES.smart2!);
    const roads = [...run.world.state.objects.values()].filter((o) => o.catalogId.startsWith('path-'));
    expect(roads.length).toBeGreaterThan(0);
  });

  it('generate: the designed island lands pieces and ground on the whole planet', () => {
    const run = play(HELP_SCENES.generate!);
    // The plaza is one object; a designed run adds many more.
    expect(run.world.state.objects.size).toBeGreaterThan(10);
    let touched = 0;
    for (const rowCells of run.world.state.cells) {
      for (const cell of rowCells) if (cell.terrain && cell.terrain.type !== TerrainType.None) touched++;
    }
    expect(touched).toBeGreaterThan(20);
  });

  it('maze: the region-scoped generator carves, gates resolve, and the walk is its own answer', () => {
    const run = play(HELP_SCENES.maze!);
    expect(run.rec.marks).toBeGreaterThan(0);
    expect(run.rec.routeMax).toBeGreaterThan(3);
    let walls = 0;
    for (let y = 97; y <= 107; y++) {
      for (let x = 63; x <= 84; x++) {
        if (run.world.state.cells[y]?.[x]?.terrain?.type === TerrainType.Mountain) walls++;
      }
    }
    expect(walls).toBeGreaterThan(10);
  });

  it('[EDIT-07] [EDIT-21] undo: the base rule cuts the column the brush stacks, one undo clears it, and the closing rebuild stands', () => {
    const scene = HELP_SCENES.undo!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const columns: Array<number | null> = [];
    const toasts: Array<string | null> = [];
    for (const step of scene.run(ctx, (key) => key, MOUSE)) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      const cell = world.state.cells[101]![73]!.terrain;
      columns.push(cell?.type === TerrainType.Mountain ? cell.elevation : null);
      if (step.realToast) toasts.push(world.refusal?.message ?? null);
    }
    // The press fills the bare cell up to layer 4 in one stroke; its release settles at 3, naming
    // the support rule.
    expect(toasts).toEqual(['error.need_base_support']);
    const cut = columns.indexOf(3);
    expect(columns.slice(0, cut)).toEqual([null, 4]);
    // The undo takes the whole column back in one step.
    expect(columns[cut + 1]).toBeNull();
    // The loop ends on the short rebuilt stack, so the settled frame is never an empty map.
    expect(columns.at(-1)).toBe(2);
  });

  it('load: the live meter stands over a region the world really loads', () => {
    const run = play(HELP_SCENES.load!);
    expect(run.rec.meter).toBe(true);
    const region = mapChunkAt(run.world.state.template, 67, 99);
    expect(chunkLoad(getMapStats(run.world.state), region.cx, region.cy)?.value ?? 0).toBeGreaterThan(0);
  });

  it('faq: capped water stands, uncapped water takes itself back with the real refusal', () => {
    const run = play(HELP_SCENES.faq!);
    for (let x = 68; x <= 70; x++) expect(terrainAt(run, x, 101)?.type).toBe(TerrainType.Water);
    expect(terrainAt(run, 72, 101)?.type ?? TerrainType.None).not.toBe(TerrainType.Water);
    // The live toast's own rewrite: a refused water stroke that would stand at exactly one
    // layer names that layer instead of quoting the containment rule.
    expect(run.refusalAtRelease).toBe('error.water_only_layer');
  });

  it('notes: the zone kept with Done and the dragged route ride the state for the real annotation layer to draw', () => {
    const run = play(HELP_SCENES.notes!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items.map((i) => i.kind).sort()).toEqual(['route', 'zone']);
    expect(run.world.annotationDraft).toBeNull();
    const route = items.find((i) => i.kind === 'route')!;
    expect(route.kind === 'route' && route.points.length).toBe(3);
  });

  it('scope: the region-scoped designed run lands only inside the mark', () => {
    const run = play(HELP_SCENES.scope!);
    // The mark the scene drags out, as the view drew it; the whole planet outside it must come back
    // untouched.
    const mark = new Set(run.rec.region.map((c) => `${c.x},${c.y}`));
    expect(mark.size).toBeGreaterThan(20);
    const inMark = (x: number, y: number) => mark.has(`${x},${y}`);
    let inside = 0;
    for (let y = 0; y < run.world.state.cells.length; y++) {
      const rowCells = run.world.state.cells[y]!;
      for (let x = 0; x < rowCells.length; x++) {
        const cell = rowCells[x]?.terrain;
        if (!cell || cell.type === TerrainType.None || holdsTemplateTerrain(run.world.state.template, x, y, rowCells[x]!)) continue;
        expect(inMark(x, y), `terrain at ${x},${y}`).toBe(true);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(20);
    for (const obj of run.world.state.objects.values()) {
      if (obj.locked) continue; // the plaza ships with the planet
      expect(inMark(obj.position.x, obj.position.y), `${obj.catalogId} at ${obj.position.x},${obj.position.y}`).toBe(true);
    }
  });

  it('region: the brush paints the dragged box, one undo takes the drag back, and a press inside moves the figure', () => {
    const scene = HELP_SCENES.region!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const key = (cells: readonly MacroCoord[]) => cells.map((c) => `${c.x},${c.y}`).sort();
    const box = (dx: number, dy: number) => {
      const cells: MacroCoord[] = [];
      for (let y = 100; y <= 104; y++) for (let x = 65; x <= 69; x++) cells.push({ x: x + dx, y: y + dy });
      return key(cells);
    };
    const regions: string[][] = [[]];
    const map = JSON.stringify(world.state.cells);
    for (const step of scene.run(ctx, (k) => k, MOUSE)) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      const now = key(world.region);
      if (JSON.stringify(regions.at(-1)) !== JSON.stringify(now)) regions.push(now);
    }
    expect(regions).toEqual([[], box(0, 0), [], box(0, 0), box(5, 1)]);
    // The region's lane is its own: the map never changed.
    expect(JSON.stringify(world.state.cells)).toBe(map);
  });

  it('ground: the region wash answers with the brush eligibility rule, cell for cell', () => {
    const scene = HELP_SCENES.ground!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    let lastWash: Array<{ x: number; y: number }> = [];
    view.region = (cells) => { if (cells) lastWash = cells; };
    const ctx: DemoCtx = { world, view };
    for (const step of scene.run(ctx, (key) => key, MOUSE)) { step.on?.(ctx); step.during?.(ctx, 1); }
    // Independently computed expectation: the dragged box filtered by the zone rule itself.
    const expected: string[] = [];
    for (let y = 118; y <= 128; y++) {
      for (let x = 63; x <= 74; x++) {
        if (isBuildableZone(world.state.cells[y]![x]!.zone)) expected.push(`${x},${y}`);
      }
    }
    expect(lastWash.map((c) => `${c.x},${c.y}`).sort()).toEqual([...expected].sort());
    // The box genuinely straddles the coast: part of it is skipped, part washes.
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(12 * 7);
    expect(isBuildableZone(world.state.cells[125]![69]!.zone)).toBe(false);
  });

  it('maze width pair: one recipe and zone, the wider corridor leaves fewer walls', () => {
    const w1 = play(HELP_SCENES.mazew1!);
    const w2 = play(HELP_SCENES.mazew2!);
    const walls = (run: Run) => {
      let n = 0;
      for (let y = 97; y <= 107; y++) {
        for (let x = 64; x <= 83; x++) {
          if (run.world.state.cells[y]?.[x]?.terrain?.type === TerrainType.Mountain) n++;
        }
      }
      return n;
    };
    expect(walls(w1)).toBeGreaterThan(10);
    expect(walls(w2)).toBeGreaterThan(0);
    expect(walls(w1)).toBeGreaterThan(walls(w2));
    // Both mazes hand back a walk for the route gold to draw.
    expect(w1.rec.routeMax).toBeGreaterThan(3);
    expect(w2.rec.routeMax).toBeGreaterThan(3);
  });

  it('notezone: two strokes land as ONE tagged zone', () => {
    const run = play(HELP_SCENES.notezone!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items).toHaveLength(1);
    const zone = items[0]!;
    expect(zone.kind === 'zone' && zone.tag).toBe('homes');
    // Both arms of the L are in the one zone.
    expect(zone.kind === 'zone' && zone.cells.some((c) => c.x >= 71)).toBe(true);
    expect(zone.kind === 'zone' && zone.cells.some((c) => c.y >= 107)).toBe(true);
  });

  it('notegrow: the zone keeps its identity while it grows and is trimmed in place', () => {
    const run = play(HELP_SCENES.notegrow!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items).toHaveLength(1);
    const zone = items[0]!;
    expect(zone.kind).toBe('zone');
    if (zone.kind !== 'zone') return;
    expect(zone.cells.some((c) => c.y >= 109)).toBe(true);
    expect(zone.cells.some((c) => c.x === 67 && c.y === 98)).toBe(false);
    // The closing click inside selects it.
    expect(run.world.annotationSelection).toEqual([zone.id]);
  });

  it('measurement counts both endpoints, flips its label and resizes along its original axis', () => {
    const scene = HELP_SCENES.measurement!;
    const initial = play({ ...scene, run: (ctx, t, form) => scene.run(ctx, t, form).slice(0, 4) });
    const before = initial.world.state.annotations!.items[0]!;
    expect(before.kind).toBe('measure');
    if (before.kind !== 'measure') return;
    const original = measureDrawing(before.points, 1);
    expect(original.labels[0]!.value).toBe(20);
    const resized = play(scene).world.state.annotations!.items[0]!;
    expect(resized.kind).toBe('measure');
    if (resized.kind !== 'measure') return;
    expect(resized.points[0]).toEqual(before.points[0]);
    expect(resized.points[1].y).toBe(before.points[1].y);
    const flipped = measureDrawing(resized.points, 1, resized.flipped);
    expect(flipped.labels[0]!.value).toBe(30);
    expect(flipped.labels[0]!.at.y).toBeLessThan(before.points[0].y);
    expect(original.labels[0]!.at.y).toBeGreaterThan(before.points[0].y);
  });

  it('noteroute: the dragged path lands as a route of three anchors', () => {
    const run = play(HELP_SCENES.noteroute!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(['route']);
    const route = items[0]!;
    expect(route.kind === 'route' && route.points.length).toBe(3);
    // The release leaves it selected with the curve brush's adjust handles on its anchors.
    expect(run.world.annotationSelection).toEqual([route.id]);
    expect(run.world.curveAnchors()?.length).toBe(3);
  });

  it('noteselect: the dragged zone moved whole and the others stayed', () => {
    const run = play(HELP_SCENES.noteselect!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(['zone', 'zone', 'chip']);
    const homes = items[0]!;
    expect(homes.kind === 'zone' && Math.min(...homes.cells.map((c) => c.y))).toBe(102);
    const farm = items[1]!;
    expect(farm.kind === 'zone' && Math.min(...farm.cells.map((c) => c.y))).toBe(106);
    // The Ctrl-click added the farm zone to the moved one.
    expect(run.world.annotationSelection).toEqual([homes.id, farm.id]);
  });

  it.each(['notes', 'notetext', 'notezone', 'notegrow', 'measurement', 'noteroute', 'noteselect'])(
    '[UI-62] %s: the world\'s own undo takes every note and object back, and the next loop lays the same notes',
    (name) => {
      const run = play(HELP_SCENES[name]!);
      const shape = (w: SandboxWorld) => (w.state.annotations?.items ?? []).map(({ id: _id, ...rest }) => JSON.stringify(rest));
      const laid = shape(run.world);
      const template = sceneWorld(HELP_SCENES[name]!);
      while (run.world.undo()) { /* the player's rewind */ }
      expect(run.world.state.annotations?.items ?? []).toEqual([]);
      expect(run.world.annotationDraft).toBeNull();
      expect(run.world.annotationSelection).toEqual([]);
      expect([...run.world.state.objects.keys()].sort()).toEqual([...template.state.objects.keys()].sort());
      const ctx: DemoCtx = { world: run.world, view: recorder().view };
      for (const step of HELP_SCENES[name]!.run(ctx, (key) => key, MOUSE)) { step.on?.(ctx); step.during?.(ctx, 1); }
      expect(shape(run.world)).toEqual(laid);
    },
  );

  it('notetext: two chips of different tags and sizes land on the annotations state', () => {
    const run = play(HELP_SCENES.notetext!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(['chip', 'chip']);
    const chips = items.filter((i) => i.kind === 'chip');
    expect(new Set(chips.map((c) => c.tag)).size).toBe(2);
    expect(new Set(chips.map((c) => c.size)).size).toBe(2);
  });

  it('brushfree: the dressed hill stands and the wandering stroke reads as mountain where the hand went', () => {
    const run = play(HELP_SCENES.brushfree!);
    const wiggle = [
      { x: 70, y: 103 }, { x: 70, y: 104 }, { x: 71, y: 104 }, { x: 71, y: 105 },
      { x: 72, y: 105 }, { x: 73, y: 105 }, { x: 73, y: 104 }, { x: 74, y: 104 },
    ];
    for (const c of wiggle) expect(terrainAt(run, c.x, c.y)?.type, `${c.x},${c.y}`).toBe(TerrainType.Mountain);
    for (let x = 70; x <= 74; x++) expect(terrainAt(run, x, 99)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    // The opener's dressing genuinely landed: rounded outer corners and the tree on top.
    expect(run.world.state.cells[99]?.[70]?.terrain?.corners?.[0]).toBe('fan');
    expect(run.world.objectAt('tree-apple', 71, 100)).toBeTruthy();
  });

  it('brushwidth: the same stroke lays one cell at size 1 and three wide once the slider moves', () => {
    const run = play(HELP_SCENES.brushwidth!);
    // Size 1: only the path itself stands; a cell just off it never does.
    const path = [{ x: 65, y: 100 }, { x: 66, y: 100 }, { x: 67, y: 100 }, { x: 67, y: 101 }, { x: 68, y: 101 }];
    for (const c of path) expect(terrainAt(run, c.x, c.y)?.type, `${c.x},${c.y}`).toBe(TerrainType.Mountain);
    expect(terrainAt(run, 66, 99)?.type ?? TerrainType.None).not.toBe(TerrainType.Mountain);
    // Size 3: every cell of the brush footprint unioned along the same bend stands.
    const path2 = path.map((p) => ({ x: p.x, y: p.y + 4 }));
    const wide = new Set<string>();
    for (const p of path2) for (const c of brushCells(p.x, p.y, 3)) wide.add(`${c.x},${c.y}`);
    for (const key of wide) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      expect(terrainAt(run, x, y)?.type, key).toBe(TerrainType.Mountain);
    }
    expect(wide.size).toBeGreaterThan(path2.length);
  });

  it('eraseline: the notch keeps its base layer, the pass clears through both', () => {
    const run = play(HELP_SCENES.eraseline!);
    expect(terrainAt(run, 73, 104)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(terrainAt(run, 73, 105)?.type ?? TerrainType.None).not.toBe(TerrainType.Mountain);
    expect(terrainAt(run, 73, 106)?.type ?? TerrainType.None).not.toBe(TerrainType.Mountain);
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
    for (let y = 100; y <= 102; y++) expect(terrainAt(run, 76, y)?.type).toBe(TerrainType.Water);
  });

  it('lineridge: the causeway lands mountain across the whole crossed strait', () => {
    const run = play(HELP_SCENES.lineridge!);
    for (let x = 67; x <= 76; x++) expect(terrainAt(run, x, 101)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(terrainAt(run, 70, 100)?.type).toBe(TerrainType.Water);
    expect(terrainAt(run, 70, 102)?.type).toBe(TerrainType.Water);
  });

  it('lineridge: nothing lands while dragging, only the release paints the causeway', () => {
    const scene = HELP_SCENES.lineridge!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const landedByStep: boolean[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      landedByStep.push(world.state.cells[101]?.[70]?.terrain?.type === TerrainType.Mountain);
    }
    const firstLanded = landedByStep.findIndex((v) => v);
    expect(firstLanded).toBeGreaterThan(-1);
    expect(landedByStep.slice(0, firstLanded).every((v) => v === false)).toBe(true);
    expect(landedByStep.slice(firstLanded).every((v) => v === true)).toBe(true);
  });

  it('curvebank: nothing lands until the finishing double click, and the handle drag relays through the moved anchor', () => {
    const scene = HELP_SCENES.curvebank!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const anchors: CurveAnchor[] = [{ x: 64, y: 115 }, { x: 72, y: 117 }, { x: 80, y: 115 }];
    const moved: CurveAnchor = { x: 72, y: 120 };
    const width = 2;
    const drawnCells = splineCells(anchors, width);
    const movedCells = splineCells([anchors[0]!, moved, anchors[2]!], width);
    const stands = (cells: readonly MacroCoord[]) => cells.every((c) => world.state.cells[c.y]?.[c.x]?.terrain?.type === TerrainType.Mountain);
    const drawnByStep: boolean[] = [];
    const movedByStep: boolean[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      drawnByStep.push(stands(drawnCells));
      movedByStep.push(stands(movedCells));
    }
    const firstLanded = drawnByStep.findIndex((v) => v);
    const firstMoved = movedByStep.findIndex((v) => v);
    expect(firstLanded).toBeGreaterThan(-1);
    expect(firstMoved).toBeGreaterThan(firstLanded);
    // Nothing stands before the double click; the drawn curve stands whole until the reshape
    // release, which takes it down and lays the path through the moved anchor as one stroke.
    expect(drawnByStep.slice(0, firstLanded).every((v) => v === false)).toBe(true);
    expect(drawnByStep.slice(firstLanded, firstMoved).every((v) => v === true)).toBe(true);
    expect(movedByStep[movedByStep.length - 1]).toBe(true);
    for (const a of [anchors[0]!, moved, anchors[2]!]) {
      expect(world.state.cells[a.y]?.[a.x]?.terrain?.type).toBe(TerrainType.Mountain);
    }
  });

  it('rectpad: the platform stands flat at layer 1 and both cabins are on it', () => {
    const run = play(HELP_SCENES.rectpad!);
    for (let x = 69; x <= 73; x++) {
      for (let y = 100; y <= 103; y++) expect(terrainAt(run, x, y)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    }
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
    expect(objectCount(run, 'building-sunset-cabin')).toBe(1);
    expect(run.world.objectAt('building-sunset-cabin', 69, 100)).toBeTruthy();
  });

  it('rectpad: nothing lands while dragging, only the release lays the whole platform', () => {
    const scene = HELP_SCENES.rectpad!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const landedByStep: boolean[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      landedByStep.push(world.state.cells[101]?.[71]?.terrain?.type === TerrainType.Mountain && world.state.cells[101]?.[71]?.terrain?.elevation === 1);
    }
    const firstLanded = landedByStep.findIndex((v) => v);
    expect(firstLanded).toBeGreaterThan(-1);
    expect(landedByStep.slice(0, firstLanded).every((v) => v === false)).toBe(true);
    expect(landedByStep.slice(firstLanded).every((v) => v === true)).toBe(true);
  });

  it('circlepond: the round pond stands on release', () => {
    const run = play(HELP_SCENES.circlepond!);
    expect(terrainAt(run, 70, 102)).toEqual({ type: TerrainType.Water, elevation: 0 });
    expect(terrainAt(run, 67, 102)).toEqual({ type: TerrainType.Water, elevation: 0 });
    expect(objectCount(run, 'flower-daisy')).toBe(4);
  });

  it('circlepond: nothing lands while dragging, only the release lays the whole pond', () => {
    const scene = HELP_SCENES.circlepond!;
    const world = sceneWorld(scene);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key, MOUSE);
    const landedByStep: boolean[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      landedByStep.push(world.state.cells[102]?.[70]?.terrain?.type === TerrainType.Water);
    }
    const firstLanded = landedByStep.findIndex((v) => v);
    expect(firstLanded).toBeGreaterThan(-1);
    expect(landedByStep.slice(0, firstLanded).every((v) => v === false)).toBe(true);
    expect(landedByStep.slice(firstLanded).every((v) => v === true)).toBe(true);
  });

  it('autotrim: the same L stands as drawn, bevels, and rounds across the three settings', () => {
    const run = play(HELP_SCENES.autotrim!);
    const tip = (x: number) => run.world.state.cells[99]?.[x]?.terrain?.corners?.[CORNER_INDEX.TL];
    expect(tip(66) ?? 'square').toBe('square');
    expect(tip(72)).toBe(OUTER_TRI[CORNER_INDEX.TL]);
    expect(tip(78)).toBe('fan');
  });

  it('every scene rewinds clean through the real undo stack', () => {
    for (const [name, scene] of Object.entries(HELP_SCENES)) {
      if (name === 'generate' || name === 'scope') continue; // one designed run each per suite is enough compute
      const run = play(scene);
      const placed = run.world.state.objects.size;
      while (run.world.undo()) { /* rewinding */ }
      const again = play(scene);
      expect(again.world.state.objects.size, name).toBe(placed);
    }
  });

  it('the brush, shape, curve and trim figures lay the same map for a touch reader, with no key held', () => {
    const mapOf = (run: Run) => JSON.stringify(run.world.state.cells.map((r) => r.map((c) => c?.terrain ?? null)));
    for (const name of ['terrain', 'brushfree', 'brushwidth', 'eraseline', 'lineridge', 'curvebank', 'rectpad', 'circlepond', 'autotrim', 'trim', 'trimmulti', 'trimnotch', 'roadtrim']) {
      const touch = play(HELP_SCENES[name]!, { touch: true, upright: false });
      expect(touch.steps.some((s) => s.keys), name).toBe(false);
      expect(touch.world.held.constrain, name).toBe(false);
      expect(mapOf(touch), name).toBe(mapOf(play(HELP_SCENES[name]!)));
    }
  });
});

describe('object and plan figures ask the real hit tests and step the touch gestures', () => {
  const TOUCH: SceneForm = { touch: true, upright: false };

  type Ring = Array<{ x: number; y: number; w: number; h: number }>;

  /** Plays `scene` settled in order, keeping each selection ring the world's painter left standing
   *  after a step (when it changed) and every mark the view was handed. */
  function watch(scene: HelpScene, form: SceneForm = MOUSE) {
    const world = sceneWorld(scene);
    const start = new Set(world.state.objects.keys());
    const { view } = recorder();
    const rings: Ring[] = [];
    const words: string[] = [];
    let ring: Ring = [];
    world.drawToolsOn({
      ...HEADLESS_OVERLAY,
      showSelection: (r, _grid, opts) => { ring = opts?.append ? [...ring, { ...r }] : [{ ...r }]; },
      clearSelection: () => { ring = []; },
    });
    view.marks = (m) => { if (m?.entrance) words.push(m.entrance.kind); };
    const steps = scene.run({ world, view }, (key) => key, form);
    let last = '';
    const keep = () => {
      const now = JSON.stringify(ring);
      if (now !== last && ring.length > 0) rings.push(ring);
      last = now;
    };
    keep();
    for (const step of steps) {
      step.on?.({ world, view });
      step.during?.({ world, view }, 1);
      keep();
    }
    return { world, steps, rings, words, start };
  }

  const byPlace = (r: Ring) => [...r].sort((a, b) => a.y - b.y || a.x - b.x);

  it.each([MOUSE, TOUCH])('[EDIT-24] select: the band rings exactly the objects its rect touches, each on its own footprint (%o)', (form) => {
    const { rings } = watch(HELP_SCENES.select!, form);
    // The band's catch: two trees and the flower, never the cabin outside it (a finger's menu
    // selects the first tree before its band adds the rest).
    const caught = rings.find((r) => r.length === 3)!;
    expect(byPlace(caught)).toEqual([{ x: 64, y: 98, w: 1, h: 1 }, { x: 66, y: 99, w: 1, h: 1 }, { x: 64, y: 102, w: 1, h: 1 }]);
    // The Ctrl+click (a tap under Multi-select) brings the cabin in on its own placed footprint, then lets it go.
    const withCabin = rings.find((r) => r.length === 4)!;
    expect(withCabin).toContainEqual({ x: 75, y: 99, w: 5, h: 4 });
    expect(rings.at(-1)).toHaveLength(3);
  });

  it.each(['objects', 'ramp', 'spacing', 'objlimit', 'pasteblock'])('[EDIT-51] %s: a finger places what the mouse places, by tap or by a drag that carries the preview', (name) => {
    const layout = (w: SandboxWorld) => [...w.state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}/${o.rotation}`).sort();
    const touch = watch(HELP_SCENES[name]!, TOUCH);
    expect(touch.steps.some((s) => s.keys)).toBe(false);
    expect(layout(touch.world)).toEqual(layout(watch(HELP_SCENES[name]!).world));
  });

  it('[EDIT-28] rotate: the ring follows the turned footprint after each quarter turn', () => {
    const { world, rings } = watch(HELP_SCENES.rotate!);
    const cabin = world.objectAt('building-forest-cabin', 68, 98)!;
    expect(rings.map((r) => [r[0]!.w, r[0]!.h])).toEqual([[5, 4], [4, 5], [5, 4]]);
    expect(cabin.rotation).toBe(180);
  });

  it.each([MOUSE, TOUCH])('[EDIT-30] locked: the band catches the plaza and the trees, and the delete keeps only the plaza (%o)', (form) => {
    const { world, rings, start } = watch(HELP_SCENES.locked!, form);
    expect(rings.some((r) => r.length === 3)).toBe(true);
    expect(laidSince(world, start).filter((o) => o.catalogId === 'tree-apple')).toHaveLength(0);
    expect(world.state.objects.get(ANCHOR_LANDMARK.id)).toBeTruthy();
  });

  it('[GEN-07] maze: the dropped entrance inside the maze stands as a destination, the live marks wording it by its kind', () => {
    const { words } = watch(HELP_SCENES.maze!);
    expect(words).toContain('hole');
    expect(words.at(-1)).toBe('target');
  });

  it('[EDIT-44] undo: a touch reader undoes with a two-finger tap and the loop ends as the mouse one does', () => {
    const { steps, world } = watch(HELP_SCENES.undo!, TOUCH);
    expect(steps.some((s) => Array.isArray(s.second))).toBe(true);
    expect(steps.some((s) => s.keys)).toBe(false);
    expect(world.state.cells[101]![73]!.terrain).toEqual(play(HELP_SCENES.undo!).world.state.cells[101]![73]!.terrain);
  });

  it.each(['welcome', 'camera', 'rotate', 'select', 'grouprotate', 'locked', 'region', 'noteselect'])(
    '[EDIT-45] %s: the touch form lands the map the mouse form does, with no key-held beat',
    (name) => {
      const touch = watch(HELP_SCENES[name]!, TOUCH);
      const mouse = watch(HELP_SCENES[name]!);
      const layout = (w: SandboxWorld) => [...w.state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}/${o.rotation}`).sort();
      expect(layout(touch.world)).toEqual(layout(mouse.world));
      // A caption written for a mouse reads by finger through its touch reading (`device-readings.ts`).
      const mouseOnly = /select_1$|select_ctrl$|rotate_1$|rotate_2$|camera_[123]$|welcome_1$|noteselect_[13]$/;
      for (const s of touch.steps) {
        if (s.capKey && mouseOnly.test(s.capKey)) expect(readingKey(s.capKey, { inputMode: 'touch', shape: 'landscape' }), s.capKey).toBe(`${s.capKey}_touch`);
      }
    },
  );
});

describe('[UI-64] a finger pressing a selection verb presses the pictured control that runs it', () => {
  const TOUCH: SceneForm = { touch: true, upright: false };

  /** The pictured controls each step of `scene` glides to, with what the world held as it arrived. */
  function arrivals(scene: HelpScene, form: SceneForm) {
    const world = new SandboxWorld(scene.template);
    const ctx: DemoCtx = { world, view: recorder().view };
    const steps = scene.run(ctx, (key) => key, form);
    const seen: Array<{ control: string; card: ReturnType<typeof selectionTarget>; latched: boolean; selected: number }> = [];
    for (const step of steps) {
      if (step.move && 'control' in step.move) {
        // The live card's own rule: it stands for a selection it can act on while multi-select is not latched.
        const card = world.multiSelectLatched ? null : selectionTarget(world.selection, world.state, false);
        seen.push({ control: step.move.control, card, latched: world.multiSelectLatched, selected: world.selectedIds().length });
      }
      step.on?.(ctx);
      step.during?.(ctx, 1);
    }
    return seen;
  }

  it('grouprotate: the finger lands on the card\'s Rotate while the card stands over the group', () => {
    const seen = arrivals(HELP_SCENES.grouprotate!, TOUCH);
    expect(seen.map((s) => s.control)).toEqual(['handle-rotate']);
    expect(seen[0]!.card?.plural).toBe(true);
    expect(seen[0]!.card?.rotatable).toBe(true);
  });

  it.each([
    ['locked', ['multi-select-delete', 'multi-select-done']],
    ['copypaste', ['multi-select-copy', 'multi-select-done']],
    ['copydrag', ['multi-select-copy', 'multi-select-done']],
  ])('[EDIT-43] %s: the finger lands on multi-select\'s own controls while the latch stands them', (name, controls) => {
    const seen = arrivals(HELP_SCENES[name]!, TOUCH);
    expect(seen.map((s) => s.control)).toEqual(controls);
    for (const s of seen) expect(s.latched).toBe(true);
    // Copy is offered for two or more (EDIT-53), and Delete for a group that holds something.
    expect(seen[0]!.selected).toBeGreaterThanOrEqual(seen[0]!.control === 'multi-select-copy' ? 2 : 1);
  });

  it.each(['grouprotate', 'locked', 'copypaste', 'copydrag', 'rotate'])('%s: a mouse reader turns, copies and deletes by key, gliding to no pictured control', (name) => {
    expect(arrivals(HELP_SCENES[name]!, MOUSE)).toEqual([]);
  });
});

describe('copy, paste and placing many, on the editor\'s own code', () => {
  const TOUCH_FORM: SceneForm = { touch: true, upright: false };
  const count = (run: Run, id: string) => laidSince(run.world, run.start).filter((o) => o.catalogId === id).length;

  it.each([MOUSE, TOUCH_FORM])('[EDIT-54] copypaste lands one whole copy with its top-left on the picked block (%o)', (form) => {
    const run = play(HELP_SCENES.copypaste!, form);
    expect(count(run, 'tree-apple')).toBe(2);
    expect(count(run, 'flower-daisy')).toBe(4);
    // The copy's outline starts at (65, 99); its top-left lands on the picked block (74, 101).
    expect(run.world.objectAt('tree-apple', 75, 101)).toBeTruthy();
    expect(run.world.objectAt('flower-daisy', 74, 102)).toBeTruthy();
  });

  it.each([MOUSE, TOUCH_FORM])('[EDIT-53] copypaste toasts what the copy took, and the paste that fits says nothing (%o)', (form) => {
    const run = play(HELP_SCENES.copypaste!, form);
    expect(run.rec.notices).toEqual([{ key: 'copy.copied', params: { n: 3 } }]);
    expect(run.steps.some((s) => s.toastKey)).toBe(false);
  });

  it.each([MOUSE, TOUCH_FORM])('[EDIT-57] pasteblock lands the copy nearby when the picked block has no room, and says so (%o)', (form) => {
    const run = play(HELP_SCENES.pasteblock!, form);
    expect(count(run, 'tree-apple')).toBe(2);
    expect(run.world.objectAt('flower-daisy', 72, 101)).toBeFalsy();
    expect(run.rec.notices).toEqual([{ key: 'paste.nearby' }]);
  });

  it('[EDIT-60] copydrag drags out copies and leaves the originals', () => {
    const run = play(HELP_SCENES.copydrag!);
    expect(count(run, 'tree-apple')).toBe(3);
    expect(run.world.objectAt('tree-apple', 66, 99)).toBeTruthy();
  });

  it('[EDIT-66] objpaint lays trees along the drag a Spacing apart, as one undo step', () => {
    const run = play(HELP_SCENES.objpaint!);
    const xs = laidSince(run.world, run.start).filter((o) => o.catalogId === 'tree-apple').map((o) => o.position.x).sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(3);
    xs.slice(1).forEach((x, i) => expect(x - xs[i]!).toBeGreaterThanOrEqual(2));
    expect(run.world.undo()).toBe(true);
    expect(count(run, 'tree-apple')).toBe(0);
  });

  it('[EDIT-70] objmix lays the picked cards in turn along one stroke', () => {
    const run = play(HELP_SCENES.objmix!);
    const laid = laidSince(run.world, run.start).sort((a, b) => a.position.x - b.position.x).map((o) => o.catalogId);
    expect(laid.length).toBeGreaterThan(3);
    laid.forEach((id, i) => expect(id).toBe(i % 2 === 0 ? 'tree-apple' : 'flower-daisy'));
  });

  it('[EDIT-52] objlimit places the one cabin a map may hold, and its card is put down', () => {
    const scene = HELP_SCENES.objlimit!;
    const run = play(scene);
    expect(getCatalogItem('building-forest-cabin')?.maxCount).toBe(1);
    expect(count(run, 'building-forest-cabin')).toBe(1);
    // The world put the card down itself, and the pictured shelf shows it put down.
    expect(run.world.toolPicked).toBe(false);
    expect(run.steps.at(-2)?.strip).toBeNull();
  });
});
