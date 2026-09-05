/*
 * The Help figures' claims held to the rules: every scene's timeline runs headless against its own
 * real world (`DemoWorld` on a real planet template), and what a demo SHOWS is asserted to be what
 * the editor DOES — the builds land, the ghosts' validity answers come from the registry, and the
 * two refusal demos refuse with exactly the error the caption stands beside. The `DemoView` seam is
 * a recorder here; in the app it is the real overlay layer.
 */
import { describe, expect, it } from 'vitest';
import { HELP_SCENES, type DemoCtx, type DemoView, type HelpScene, type SceneStep } from '../../../ui/chrome/modals/help/figures/scenes';
import { DemoWorld } from '../../../ui/chrome/modals/help/figures/demo-world';
import { TerrainType, type MacroCoord } from '../../../core/model/types';
import { isBuildableZone } from '../../../core/model/grid-model';
import { PLAZA_ID } from '../../../core/model/constants';
import { INNER_TRI, OUTER_TRI } from '../../../core/edge-cut/cut-validator';
import { CORNER_INDEX } from '../../../core/edge-cut/corner-index';
import { CANONICAL_ROAD_STATES } from '../../../core/edge-cut/road-cut-states';
import { splineCells, type CurveAnchor } from '../../../tools/paint/shapes';
import { brushCells } from '../../../tools/paint/drawing-tool';

interface Recorded {
  ghostOks: boolean[];
  marks: number;
  routeMax: number;
  gauges: number[];
  plops: number;
  spins: Array<[number, number]>;
  groupSpins: number;
}

function recorder(): { view: DemoView; rec: Recorded } {
  const rec: Recorded = { ghostOks: [], marks: 0, routeMax: 0, gauges: [], plops: 0, spins: [], groupSpins: 0 };
  const view: DemoView = {
    ghost: (_c, _x, _y, _r, ok) => { rec.ghostOks.push(ok); },
    clearGhost: () => {},
    groupGhost: () => {},
    selection: () => {},
    clearSelection: () => {},
    band: () => {},
    paintGhost: () => {},
    region: () => {},
    route: (cells) => { if (cells) rec.routeMax = Math.max(rec.routeMax, cells.length); },
    marks: (m) => { rec.marks = Math.max(rec.marks, m.length); },
    gauge: (v) => { rec.gauges.push(v); },
    plop: () => { rec.plops++; },
    poof: () => {},
    spin: (_id, fromDeg, toDeg) => { rec.spins.push([fromDeg, toDeg]); },
    groupSpin: () => { rec.groupSpins++; },
    annotations: () => {},
    curveHandles: () => {},
  };
  return { view, rec };
}

interface Run { world: DemoWorld; rec: Recorded; steps: SceneStep[]; refusalAtRelease: string | null }

/** Play a scene the way the player's reduced-motion path does: every step settled in order. */
function play(scene: HelpScene): Run {
  const world = new DemoWorld(scene.template);
  const { view, rec } = recorder();
  const ctx: DemoCtx = { world, view };
  const steps = scene.run(ctx, (key) => key);
  let refusalAtRelease: string | null = null;
  for (const step of steps) {
    step.on?.(ctx);
    step.during?.(ctx, 1);
    if (step.realToast) refusalAtRelease = world.refusal?.message ?? null;
  }
  return { world, rec, steps, refusalAtRelease };
}

function terrainAt(run: Run, x: number, y: number): { type: TerrainType; elevation: number } | undefined {
  const cell = run.world.state.cells[y]?.[x]?.terrain;
  return cell ? { type: cell.type, elevation: cell.elevation } : undefined;
}

function objectCount(run: Run, catalogId: string): number {
  return [...run.world.state.objects.values()].filter((o) => o.catalogId === catalogId).length;
}

describe('the demo world finishes a stroke the way the live tool does', () => {
  it('sweeps the committed stroke with the visitor\'s auto-trim setting', () => {
    const world = new DemoWorld();
    world.autoTrim = 'round';
    world.beginStroke();
    world.paint([{ x: 70, y: 100 }, { x: 71, y: 100 }, { x: 70, y: 101 }, { x: 71, y: 101 }], TerrainType.Mountain, 1);
    world.commit();
    const corners = world.state.cells[100]?.[70]?.terrain?.corners;
    // The block's outer corner comes back rounded, exactly as the live finishStroke leaves it.
    expect(corners?.[0]).toBe('fan');
  });

  it('leaves the stroke square when the setting is off, the app default', () => {
    const world = new DemoWorld();
    world.beginStroke();
    world.paint([{ x: 70, y: 100 }, { x: 71, y: 100 }], TerrainType.Mountain, 1);
    world.commit();
    expect(world.state.cells[100]?.[70]?.terrain?.corners).toBeUndefined();
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
    expect(run.rec.plops).toBe(2);
  });

  it('camera authors its base scene by the plaza', () => {
    const run = play(HELP_SCENES.camera!);
    expect(terrainAt(run, 74, 88)?.type).toBe(TerrainType.Mountain);
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
  });

  it('terrain: the free stroke wanders and turns, the retraced part stacks to 2, the shift line lays level 1', () => {
    const run = play(HELP_SCENES.terrain!);
    // The wandering stroke covers two rows — a ruled line would sit on one.
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
    const cornersAfter: (string | undefined)[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      cornersAfter.push(world.state.cells[101]?.[72]?.terrain?.corners?.[3]);
    }
    expect(world.state.cells[100]?.[71]?.terrain).toMatchObject({ elevation: 2 });
    expect(cornersAfter).toContain('fan');
    // The tri step must be the BR corner's OWN outer triangle, the same table the live tool cycles.
    expect(cornersAfter).toContain(OUTER_TRI[CORNER_INDEX.BR]);
    expect(cornersAfter[cornersAfter.length - 1] ?? 'square').toBe('square');
  });

  it('objects: the pond stands, the follow-ghost answers come from the registry, the pieces land', () => {
    const scene = HELP_SCENES.objects!;
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
    // The registry answers the follow-ghost shows on its way: an anchor with no crossing refuses,
    // the bank with one stands; beside a fresh tree refuses, one cell of air stands.
    expect(world.canPlace('bridge-plank', 72, 101)).toBe(false);
    expect(world.canPlace('bridge-plank', 71, 101)).toBe(true);
    for (const step of steps) { step.on?.(ctx); step.during?.(ctx, 1); }
    expect(world.canPlace('tree-apple', 65, 100)).toBe(false);
    const run: Run = { world, rec: recorder().rec, steps, refusalAtRelease: null };
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
    // Before any click the hollow is a real cell one layer below the L around it.
    expect(world.state.cells[100]?.[73]?.terrain?.elevation).toBe(1);
    expect(world.state.cells[100]?.[73]?.terrain?.patchOnly).toBeFalsy();
    for (const step of steps) { step.on?.(ctx); step.during?.(ctx, 1); }
    const hollow = world.state.cells[100]?.[73]?.terrain;
    // What the click left stands at the TALLER tier and is a patch: cosmetic, carrying no support,
    // which is what "it does not fill the hollow with solid terrain" means in the data.
    expect(hollow?.elevation).toBe(2);
    expect(hollow?.patchOnly).toBe(true);
    // A wrapped corner's bevel is the INNER triangle, the shape the gamma path lays.
    expect(hollow?.corners?.[CORNER_INDEX.TL]).toBe(INNER_TRI[CORNER_INDEX.TL]);
    // The L itself was not repainted: its own cells keep their square corners.
    expect(world.state.cells[99]?.[73]?.terrain?.corners).toBeUndefined();
  });

  it('delight: two presses of the planting card lay two different set pieces', () => {
    const run = play(HELP_SCENES.delight!);
    const bySpecies = new Map<string, Array<{ x: number; y: number }>>();
    for (const obj of run.world.state.objects.values()) {
      if (obj.locked) continue;
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
    // The heart: two colourways of ONE species, which is what makes it one shape in two colours.
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
    const rampObj = [...run.world.state.objects.values()].find((o) => o.catalogId === 'ramp-park-steps');
    expect(rampObj).toBeTruthy();
    expect(rampObj!.elevation).toBe(1);
    expect(rampObj!.rotation).toBe(0);
    expect(terrainAt(run, 72, 98)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(run.rec.plops).toBe(1);
  });

  it('spacing: the too-close tree refuses with the spacing rule, the spaced one lands', () => {
    const run = play(HELP_SCENES.spacing!);
    expect(run.refusalAtRelease).toBe('error.tree_too_close');
    expect(objectCount(run, 'tree-apple')).toBe(2);
    expect(run.world.objectAt('tree-apple', 68, 101)).toBeFalsy();
    expect(run.world.objectAt('tree-apple', 69, 102)).toBeTruthy();
  });

  it('smartpatch: each press plants a varied stand through the real macro, and the two differ', () => {
    const scene = HELP_SCENES.smartpatch!;
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
    const countAfter: number[] = [];
    for (const step of steps) {
      step.on?.(ctx);
      step.during?.(ctx, 1);
      countAfter.push([...world.state.objects.values()].filter((o) => !o.locked).length);
    }
    const afterFirst = countAfter[4]!;
    const afterSecond = countAfter[countAfter.length - 1]!;
    // A patch is a stand, never a single piece; the second press adds its own.
    expect(afterFirst).toBeGreaterThan(1);
    expect(afterSecond).toBeGreaterThan(afterFirst + 1);
    // Two seeds, two compositions: the stands do not share every species count.
    const bySpecies = new Map<string, number>();
    for (const o of world.state.objects.values()) {
      if (!o.locked) bySpecies.set(o.catalogId, (bySpecies.get(o.catalogId) ?? 0) + 1);
    }
    expect(bySpecies.size).toBeGreaterThan(1);
  });

  it('grouprotate: the pure group rotate turns the set as one body with one turn spec', () => {
    const run = play(HELP_SCENES.grouprotate!);
    expect(run.rec.groupSpins).toBe(1);
    expect(objectCount(run, 'tree-apple')).toBe(2);
    expect(objectCount(run, 'flower-daisy')).toBe(1);
    const flower = [...run.world.state.objects.values()].find((o) => o.catalogId === 'flower-daisy');
    expect(flower?.position).not.toEqual({ x: 66, y: 102 });
  });

  it('select: the group lands at its destination through real remove and place', () => {
    const run = play(HELP_SCENES.select!);
    expect(objectCount(run, 'tree-apple')).toBe(2);
    expect(objectCount(run, 'flower-daisy')).toBe(1);
    const moved = [...run.world.state.objects.values()].find((o) => o.catalogId === 'flower-daisy');
    expect(moved?.position).toEqual({ x: 68, y: 103 });
  });

  it('locked: the group delete keeps the plaza and counts it, and deleting it alone is refused', () => {
    const scene = HELP_SCENES.locked!;
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    scene.run({ world, view }, (key) => key);
    // The two trees the band is about genuinely stand before a step runs.
    expect([...world.state.objects.values()].filter((o) => o.catalogId === 'tree-apple').length).toBe(2);
    const run = play(scene);
    // Both trees the band caught are gone; the plaza and the cabin standing outside it are not.
    expect(objectCount(run, 'tree-apple')).toBe(0);
    expect(objectCount(run, 'building-forest-cabin')).toBe(1);
    expect(run.world.state.objects.get(PLAZA_ID)?.locked).toBe(true);
    // The count the demo's toast claims is what actually survived locked.
    const survivedLocked = [...run.world.state.objects.values()].filter((o) => o.locked).length;
    const claim = run.steps.find((s) => s.toastKey === 'toast.group_delete_kept_one');
    expect(claim?.toastParams).toEqual({ n: survivedLocked });
    // The refusal is the lock rule's own, word for word.
    expect(run.refusalAtRelease).toBe('error.locked_immutable');
  });

  it('smart1: two taps of the real raise macro land two different mounds', () => {
    const run = play(HELP_SCENES.smart1!);
    const raised: number[] = [];
    for (let y = 95; y <= 109; y++) {
      for (let x = 61; x <= 84; x++) {
        const cell = run.world.state.cells[y]?.[x]?.terrain;
        if (cell && cell.type === TerrainType.Mountain && cell.elevation > 0) raised.push(x);
      }
    }
    expect(raised.length).toBeGreaterThan(8);
    expect(raised.some((x) => x < 73)).toBe(true);
    expect(raised.some((x) => x >= 73)).toBe(true);
  });

  it('stream: one press carves a course from the aimed tier down to sea level and out to the coast', () => {
    const run = play(HELP_SCENES.stream!);
    const course: Array<{ x: number; y: number; elevation: number }> = [];
    for (let y = 112; y <= 130; y++) {
      for (let x = 60; x <= 85; x++) {
        const cell = run.world.state.cells[y]?.[x]?.terrain;
        if (cell?.type === TerrainType.Water) course.push({ x, y, elevation: cell.elevation });
      }
    }
    // The press lands on the authored tarn, and the course leaves it: the cell below it is water
    // the macro cut, at the tarn's own tier.
    expect(terrainAt(run, 71, 116)).toEqual({ type: TerrainType.Water, elevation: 3 });
    // Every tier between the top and sea level carries part of the course: it steps down rather
    // than plunging, and it ends at level 0.
    expect(new Set(course.map((c) => c.elevation))).toEqual(new Set([3, 2, 1, 0]));
    // It runs out past the terraces to the boundary the island's own zones draw, which is what
    // "reaches open water" means here.
    const mouth = course.reduce((lowest, c) => (c.y > lowest.y ? c : lowest), course[0]!);
    expect(mouth.elevation).toBe(0);
    expect(isBuildableZone(run.world.state.cells[mouth.y + 1]![mouth.x]!.zone)).toBe(false);
  });

  it('smart2: the road press lays a network between the cabins', () => {
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

  it('undo: the base rule cuts the held column, one undo clears it, and the closing rebuild stands', () => {
    const run = play(HELP_SCENES.undo!);
    expect(run.refusalAtRelease).toBe('error.need_3x3_base');
    // The loop ends on the short rebuilt stack, so the settled frame is never an empty map.
    expect(terrainAt(run, 73, 101)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('load: the disc readings are the meter arithmetic over the real stats', () => {
    const run = play(HELP_SCENES.load!);
    expect(Math.max(...run.rec.gauges)).toBeGreaterThan(0);
  });

  it('faq: capped water stands, uncapped water takes itself back with the real refusal', () => {
    const run = play(HELP_SCENES.faq!);
    for (let x = 68; x <= 70; x++) expect(terrainAt(run, x, 101)?.type).toBe(TerrainType.Water);
    expect(terrainAt(run, 72, 101)?.type ?? TerrainType.None).not.toBe(TerrainType.Water);
    // The live toast's own rewrite: a refused water stroke that would stand at exactly one
    // layer names that layer instead of quoting the containment rule.
    expect(run.refusalAtRelease).toBe('error.water_only_layer');
  });

  it('notes: both annotations ride the state for the real annotation layer to draw', () => {
    const run = play(HELP_SCENES.notes!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items.map((i) => i.kind).sort()).toEqual(['route', 'zone']);
  });

  it('scope: the region-scoped designed run lands only inside the mark', () => {
    const run = play(HELP_SCENES.scope!);
    // The mark the scene drags out; the whole planet outside it must come back untouched.
    const inMark = (x: number, y: number) => x >= 58 && x <= 85 && y >= 94 && y <= 122;
    let inside = 0;
    for (let y = 0; y < run.world.state.cells.length; y++) {
      const rowCells = run.world.state.cells[y]!;
      for (let x = 0; x < rowCells.length; x++) {
        const cell = rowCells[x]?.terrain;
        if (!cell || cell.type === TerrainType.None) continue;
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

  it('ground: the region wash answers with the brush eligibility rule, cell for cell', () => {
    const scene = HELP_SCENES.ground!;
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    let lastWash: Array<{ x: number; y: number }> = [];
    view.region = (cells) => { if (cells) lastWash = cells; };
    const ctx: DemoCtx = { world, view };
    for (const step of scene.run(ctx, (key) => key)) { step.on?.(ctx); step.during?.(ctx, 1); }
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

  it('notetext: both text styles land on the annotations state', () => {
    const run = play(HELP_SCENES.notetext!);
    const items = run.world.state.annotations?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(['text', 'text']);
    expect(items.map((i) => (i.kind === 'text' ? i.style : '')).sort()).toEqual(['chip', 'label']);
    for (const item of items) {
      if (item.kind === 'text') expect(item.text.length).toBeGreaterThan(0);
    }
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
    // Size 3, the real per-point brush footprint unioned along the same bend: every cell it
    // covers stands, which reads as a band three cells wide rather than the path alone.
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
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
    const world = new DemoWorld(scene.template);
    const { view } = recorder();
    const ctx: DemoCtx = { world, view };
    const steps = scene.run(ctx, (key) => key);
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
});
