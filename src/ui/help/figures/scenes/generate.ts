/** The Help Center's Generate scenes, with the section figures for scope, ground and maze width. */
import { TerrainType, type MacroCoord, type Command } from '../../../../core/model/types';
import { isBuildableZone } from '../../../../core/game/zones';
import { circleCells } from '../../../../core/grid/shapes';
import { SandboxWorld, defaultConfig, type GenerateConfig, type MazeGates } from '../../../../editor/sandbox/demo-world';
import { UNDO_KEYS, rect, CABIN, CABIN2, INTERIOR, COAST, type HelpScene } from './common';
import type { TextKey } from '../../../../i18n/keys';


const smart1: HelpScene = {
  stage: { x1: 63, y1: 97, x2: 82, y2: 107, tile: 19 },
  run: ({ world, view }) => {
    const at = { x: 72, y: 102 };
    const opts = { seed: 4, at, radius: 4, steepness: 'steep' as const, footing: 0 };
    const grow = (stage: number) => world.applyMacro('raise', { ...opts, stage,
      heldCells: circleCells(at, 6, 6).filter(c => world.kit.state.cells[c.y]?.[c.x]?.terrain)
        .map(c => c.y * world.kit.state.template.width + c.x),
    });
    return [
    { capKey: 'help.fig.smart1_1', move: [72, 102], pointer: 'place', dur: 1100,
      on: () => view.paintGhost(world.previewMacro('raise', opts).added, 'mountain'),
    },
    {
      press: true, capKey: 'help.fig.smart1_2', dur: 260,
      on: () => { view.paintGhost(null); grow(1); },
    },
    {
      press: true, dur: 700, on: () => grow(2),
    },
    {
      press: true, dur: 700, on: () => grow(3),
    },
    { press: false, dur: 1500 },
  ];
  },
};

/** An endpoint-guided river through terraces, built by the same macro as the editor. */
const stream: HelpScene = {
  stage: COAST,
  run: ({ world, view }) => {
    world.beginStroke();
    world.paint(rect(64, 114, 78, 119), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(66, 114, 76, 118), TerrainType.Mountain, 2);
    world.commit();
    world.beginStroke();
    world.paint(rect(68, 114, 74, 116), TerrainType.Mountain, 3);
    world.commit();
    // A tarn on the top terrace, walled by that terrace on every side: the press the copy describes
    // is a press on standing water.
    world.beginStroke();
    world.paint([{ x: 71, y: 115 }], TerrainType.Water, 3);
    world.commit();
    const from = { x: 71, y: 115 };
    const at = { x: 80, y: 120 }, opts = { seed: 5, from, at, width: 1 };
    return [
      { capKey: 'help.fig.stream_1', move: [from.x, from.y], pointer: 'place', dur: 700 },
      {
        press: true, move: [at.x, at.y], dur: 850,
        on: () => view.paintGhost(world.previewMacro('stream', opts).added, 'water'),
      },
      { press: false, capKey: 'help.fig.stream_2', dur: 2000,
        on: () => { view.paintGhost(null); world.applyMacro('stream', opts); },
      },
    ];
  },
};

const smart2: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    world.place(CABIN, 64, 97);
    world.place(CABIN2, 75, 104);
    const from = { x: 65, y: 98 }, at = { x: 76, y: 105 }, opts = { seed: 1, from, at, width: 2 };
    return [
      { capKey: 'help.fig.smart2_1', move: [from.x, from.y], pointer: 'place', dur: 550 },
      { press: true, move: [at.x, at.y], dur: 850,
        on: () => view.paintGhost(world.previewMacro('road-link', opts).added),
      },
      { press: false, capKey: 'help.fig.smart2_2', dur: 1700,
        on: () => { view.paintGhost(null); world.applyMacro('road-link', opts); },
      },
    ];
  },
};

/**
 * A designed run planned once per (scene, region) and replayed on every later loop. The pipeline is
 * deterministic per (seed, config) and the demo world rewinds to the same template between loops,
 * so the recorded command list is the run — and the planning (hundreds of ms on the main thread,
 * per loop, times a throttle on a weak machine) is paid a single time. A command shares nothing
 * with the map it lands on, so one list replays into every loop.
 */
const designedRuns = new Map<string, Command[]>();

function runDesigned(world: SandboxWorld, key: string, region: MacroCoord[] | null): void {
  const cached = designedRuns.get(key);
  if (cached) {
    for (const cmd of cached) world.execute(cmd);
    return;
  }
  const commands: Command[] = [];
  world.generateDesigned({ seed: 20260829, richness: 0.7, maxElevation: 4, mode: 'mixed', region }, (cmd) => { commands.push(cmd); });
  designedRuns.set(key, commands);
}

const generate: HelpScene = {
  // The whole planet in frame: a designed run is a planet-scale fact. The cards themselves
  // are the candidates page's figure; this one shows what landing a card does to the map.
  stage: { x1: 0, y1: 0, x2: 168, y2: 139, tile: 2.6 },
  run: () => [
    { capKey: 'help.fig.generate_1', move: [84, 70], dur: 1200 },
    { capKey: 'help.fig.generate_2', dur: 800 },
    {
      dur: 300,
      on: ({ world }) => {
        world.beginStroke();
        runDesigned(world, 'island', null);
        world.commit();
      },
    },
    { dur: 500 },
    { capKey: 'help.fig.generate_3', dur: 1600 },
  ],
};

const region: HelpScene = {
  stage: INTERIOR,
  run: ({ view }) => {
    const base = rect(65, 100, 69, 104);
    return [
      { capKey: 'help.fig.region_1', move: [65, 100], pointer: 'marquee', dur: 450 },
      { press: true, dur: 160 },
      {
        move: [69.5, 104.5], dur: 750,
        during: (_ctx, k) => {
          view.region(base.filter((c) => c.x <= 65 + 4 * k + 0.5 && c.y <= 100 + 4 * k + 0.5));
        },
      },
      { press: false, dur: 400 },
      // The region's undo unit is the whole drag: one gesture, one stack entry, all of it back.
      {
        keys: UNDO_KEYS, capKey: 'help.fig.region_2', dur: 900,
        on: () => { view.region(null); },
      },
      { keys: null, move: [65, 100], pointer: 'marquee', dur: 400 },
      { press: true, dur: 160 },
      {
        move: [69.5, 104.5], dur: 600,
        during: (_ctx, k) => {
          view.region(base.filter((c) => c.x <= 65 + 4 * k + 0.5 && c.y <= 100 + 4 * k + 0.5));
        },
      },
      { press: false, dur: 400 },
      // The move keeps the tool's own cursor: the region screen has no grab hand.
      { capKey: 'help.fig.region_3', move: [67, 102], dur: 500 },
      { press: true, dur: 160 },
      {
        move: [72, 103], dur: 800,
        during: (_ctx, k) => {
          const dx = Math.round(5 * k);
          const dy = Math.round(1 * k);
          view.region(base.map((c) => ({ x: c.x + dx, y: c.y + dy })));
        },
      },
      { press: false, dur: 1000 },
    ];
  },
};

/** The figures' maze recipe: seed 11, two layers tall, carved into `zone`. */
const mazeRecipe = (corridorWidth: number, zone: MacroCoord[], mazeGates?: MazeGates): GenerateConfig => defaultConfig('maze', {
  corridorWidth, maxElevation: 2, seed: 11, region: zone, ...(mazeGates ? { mazeGates } : {}),
});

const maze: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    // The real region-scoped run: with a region marked, the maze fills that frame.
    const zone = rect(63, 97, 84, 107);
    let walk: MacroCoord[] | null = null;
    const runMaze = (gates?: { entrance?: MacroCoord | null; exit?: MacroCoord | null }) => {
      world.beginStroke();
      const out = world.generateTerrain(mazeRecipe(1, zone, gates));
      world.commit();
      walk = out.mazeWalk ?? null;
      return out.mazeGates ?? { entrance: null, exit: null };
    };
    const first = runMaze();
    // A mark's word is read from where the end stands (maze-endpoints): on the maze's own wall it
    // is a hole you pass through (In/Out); anywhere inside it is a destination to reach (To).
    const marksOf = (g: { entrance: MacroCoord | null; exit: MacroCoord | null }, entranceInside = false) => {
      const marks: Array<{ x: number; y: number; labelKey: TextKey }> = [];
      if (g.entrance) marks.push({ x: g.entrance.x, y: g.entrance.y, labelKey: entranceInside ? 'generate.gate_to' : 'generate.gate_in' });
      if (g.exit) marks.push({ x: g.exit.x, y: g.exit.y, labelKey: 'generate.gate_out' });
      return marks;
    };
    const from = first.entrance ?? { x: 64, y: 100 };
    // Strictly interior to the zone, so the dropped end resolves as a destination.
    const dropAt = { x: Math.min(82, from.x + 4), y: Math.min(106, from.y + 3) };
    return [
      { capKey: 'help.fig.maze_1', dur: 900, on: () => { view.marks(marksOf(first)); } },
      { capKey: 'help.fig.maze_2', move: [from.x, from.y], dur: 500 },
      { press: true, pointer: 'hand-closed', dur: 160 },
      {
        move: [dropAt.x, dropAt.y], dur: 700,
        during: (_ctx, k) => {
          const m = marksOf(first);
          if (m[0]) m[0] = { ...m[0], x: from.x + (dropAt.x - from.x) * k, y: from.y + (dropAt.y - from.y) * k };
          view.marks(m);
        },
      },
      {
        press: false, pointer: 'select', dur: 900,
        on: ({ world: w }) => {
          w.undo();
          const gates = runMaze({ entrance: dropAt, exit: first.exit });
          view.marks(marksOf(gates));
        },
      },
      {
        capKey: 'help.fig.maze_3', dur: 900,
        during: (_ctx, k) => {
          if (!walk) return;
          view.route(walk.slice(0, Math.floor(walk.length * k)));
        },
      },
      { dur: 1200 },
    ];
  },
};

const stencil: HelpScene = {
  stage: INTERIOR,
  run: ({ view }) => {
    const box = { origin: { x: 67, y: 97 }, width: 14, height: 10 };
    const regionCells = rect(box.origin.x, box.origin.y, box.origin.x + box.width - 1, box.origin.y + box.height - 1);
    // One chain for the async beats (font decode, then each run), so the water rerun always
    // follows the mountain glyph it replaces.
    let job: Promise<void> = Promise.resolve();
    const runGlyph = (world: SandboxWorld, terrain: TerrainType) => {
      job = job.then(async () => {
        const { glyphStencil } = await import('../../../../editor/sandbox/stencil-shots');
        const { TEXT_POOL } = await import('../../../shell/bars/generate/stencil-samples');
        // The glyph is the shelf's own first sample, so the demo writes what the real pool deals.
        const glyph = TEXT_POOL[0]?.text ?? 'A';
        const st = await glyphStencil(glyph, box);
        if (!st) return;
        world.beginStroke();
        world.generateTerrain(
          defaultConfig('stencil', {
            maxElevation: 3, seed: 1,
            stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain }, stencil: st, origin: box.origin },
          }),
        );
        world.commit();
      });
    };
    return [
      { capKey: 'help.fig.stencil_1', dur: 900, on: () => { view.region(regionCells); } },
      {
        capKey: 'help.fig.stencil_2', dur: 400,
        on: ({ world }) => { view.region(null); runGlyph(world, TerrainType.Mountain); },
      },
      { dur: 1300 },
      {
        capKey: 'help.fig.stencil_3', dur: 1500,
        on: ({ world }) => {
          job = job.then(() => { world.undo(); });
          runGlyph(world, TerrainType.Water);
        },
      },
      { dur: 700 },
    ];
  },
};



/** The scope demo's marked rectangle: a terrace north-east of the plaza, wholly on land, where the
 *  demo's designed run raises ground and lays streets, so the built square reads at planet scale. */
const SCOPE_RECT = { x1: 110, y1: 40, x2: 137, y2: 68 } as const;

const scope: HelpScene = {
  // The whole planet in frame, like the lead figure: the point is what the mark does to a
  // planet-scale run — the design is still drawn for the whole planet, and only the piece that
  // falls inside the mark is built.
  stage: { x1: 0, y1: 0, x2: 168, y2: 139, tile: 2.6 },
  run: ({ view }) => {
    const zone = rect(SCOPE_RECT.x1, SCOPE_RECT.y1, SCOPE_RECT.x2, SCOPE_RECT.y2);
    const w = SCOPE_RECT.x2 - SCOPE_RECT.x1;
    const h = SCOPE_RECT.y2 - SCOPE_RECT.y1;
    return [
      { capKey: 'help.fig.scope_1', move: [SCOPE_RECT.x1, SCOPE_RECT.y1], pointer: 'marquee', dur: 700 },
      { press: true, dur: 160 },
      {
        move: [SCOPE_RECT.x2 + 0.5, SCOPE_RECT.y2 + 0.5], dur: 900,
        during: (_ctx, k) => {
          view.region(zone.filter((c) => c.x <= SCOPE_RECT.x1 + w * k + 0.5 && c.y <= SCOPE_RECT.y1 + h * k + 0.5));
        },
      },
      { press: false, pointer: 'select', dur: 500 },
      {
        capKey: 'help.fig.scope_2', dur: 400,
        on: ({ world }) => {
          world.beginStroke();
          runDesigned(world, 'scope', zone);
          world.commit();
          // A landed run takes the scope decal down, exactly as the live shelf does.
          view.region(null);
        },
      },
      { dur: 500 },
      { capKey: 'help.fig.scope_3', dur: 1800 },
    ];
  },
};

const ground: HelpScene = {
  // Deeper south than the shared coast crop: the point is the wash stopping, so the frame must
  // show the beach and the open sea the box crosses.
  stage: { x1: 60, y1: 114, x2: 83, y2: 131, tile: 15 },
  run: ({ world, view }) => {
    // The region brush's own eligibility rule: a cell may be scoped only on a buildable zone.
    const takes = (x: number, y: number) => {
      const cell = world.state.cells[y]?.[x];
      return !!cell && isBuildableZone(cell.zone);
    };
    // A box straddling the coast: grass rows on top, then the boundary line, the beach and the sea.
    const box = { x1: 63, y1: 118, x2: 74, y2: 128 };
    const cells = rect(box.x1, box.y1, box.x2, box.y2);
    return [
      { capKey: 'help.fig.ground_1', move: [box.x1, box.y1], pointer: 'marquee', dur: 500 },
      { press: true, dur: 160 },
      {
        move: [box.x2 + 0.5, box.y2 + 0.5], dur: 800,
        during: (_ctx, k) => {
          view.region(cells.filter((c) =>
            c.x <= box.x1 + (box.x2 - box.x1) * k + 0.5
            && c.y <= box.y1 + (box.y2 - box.y1) * k + 0.5
            && takes(c.x, c.y)));
        },
      },
      { press: false, pointer: 'select', dur: 800 },
      { capKey: 'help.fig.ground_2', move: [69, 129.5], dur: 600 },
      { press: true, dur: 200 },
      { press: false, dur: 1300 },
    ];
  },
};

/** The corridor-width pair: one recipe, one zone, the width knob the only difference. */
function mazeWidth(corridorWidth: number): HelpScene {
  return {
    // Small tiles so the pair stands side by side inside the page column.
    stage: { x1: 63, y1: 96, x2: 84, y2: 108, tile: 12 },
    run: ({ world, view }) => {
      const zone = rect(64, 97, 83, 107);
      world.beginStroke();
      const out = world.generateTerrain(mazeRecipe(corridorWidth, zone));
      world.commit();
      const walk = out.mazeWalk ?? null;
      return [
        { dur: 900 },
        {
          dur: 1100,
          during: (_ctx, k) => {
            if (walk) view.route(walk.slice(0, Math.floor(walk.length * k)));
          },
        },
        { dur: 1400 },
      ];
    },
  };
}

const mazew1 = mazeWidth(1);
const mazew2 = mazeWidth(2);


export const GENERATE_SCENES: Record<string, HelpScene> = { smart1, stream, smart2, generate, region, maze, stencil, scope, ground, mazew1, mazew2 };
