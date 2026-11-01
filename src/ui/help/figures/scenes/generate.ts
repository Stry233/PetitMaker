/** The Help Center's Generate scenes, with the section figures for scope, ground and maze width. */
import { TerrainType, type MacroCoord, type Command } from '../../../../core/model/types';
import { SandboxWorld, defaultConfig, type GenerateConfig, type MazeGates } from '../../../../editor/sandbox/demo-world';
import { mazeFootprintOn, mazeMarks, type MazeMarks } from '../../../../editor/editing/generate-batch';
import {
  Hand, UNDO_KEYS, macroArming, pickTool, rect, timed, CABIN, CABIN2, INTERIOR, COAST, type DemoCtx, type HelpScene, type SceneStep,
} from './common';
import { MOUSE_FORM } from './build-objects';


/** The mountain spray held in one spot: the tool's own ghost under a hovering mouse, then a hold
 *  whose bursts tick on the player's clock, each raising the same mound a stage. */
const smart1: HelpScene = {
  stage: { x1: 63, y1: 97, x2: 82, y2: 107, tile: 19 },
  run: (_ctx, _t, form) => {
    const hand = new Hand(form);
    return [
      hand.hover(72, 102, {
        capKey: 'help.fig.smart1_1', pointer: 'place', dur: 1100, on: (c) => pickTool(c, macroArming('raise')),
      }),
      timed(hand.press({ capKey: 'help.fig.smart1_2', dur: 260 })),
      timed({ press: true, dur: 700 }),
      timed({ press: true, dur: 700 }),
      hand.release({ dur: 1500 }),
    ];
  },
};

/** An endpoint-guided river through terraces, dragged with the editor's own river tool. */
const stream: HelpScene = {
  stage: COAST,
  run: ({ world }, _t, form) => {
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
    const hand = new Hand(form);
    // Terrain cells: a cell's centre is its whole coordinate.
    return [
      hand.hover(71, 115, { capKey: 'help.fig.stream_1', pointer: 'place', dur: 700, on: (c) => pickTool(c, macroArming('stream')) }),
      hand.press({ dur: 160 }),
      hand.drag(80, 120, { dur: 850 }),
      hand.release({ capKey: 'help.fig.stream_2', dur: 2000 }),
    ];
  },
};

const smart2: HelpScene = {
  stage: INTERIOR,
  run: ({ world }, _t, form) => {
    world.place(CABIN, 64, 97);
    world.place(CABIN2, 75, 104);
    const hand = new Hand(form);
    // Placement cells (65, 98) to (76, 105), pressed at their centres; the bar poses a road two wide.
    return [
      hand.hover(65.5, 98.5, { capKey: 'help.fig.smart2_1', pointer: 'place', dur: 550, on: (c) => pickTool(c, macroArming('road-link', 2)) }),
      hand.press({ dur: 160 }),
      hand.drag(76.5, 105.5, { dur: 850 }),
      hand.release({ capKey: 'help.fig.smart2_2', dur: 1700 }),
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

/** Region selection armed with the rect figure, drawn through the view's region wash. */
function armRegion({ world, view }: DemoCtx): void {
  world.selectRegion({ tool: 'rect', show: (cells) => view.region(cells.length ? [...cells] : null) });
}

const region: HelpScene = {
  stage: INTERIOR,
  run: (_ctx, _t, form = MOUSE_FORM) => {
    const hand = new Hand(form);
    // Terrain cells (65, 100) to (69, 104); the drag ends just inside the far cell's corner.
    const drawBox = (dur: number): SceneStep[] => [
      hand.press({ dur: 160 }),
      hand.drag(69.45, 104.45, { dur }),
      hand.release({ dur: 400 }),
    ];
    return [
      hand.hover(65, 100, { capKey: 'help.fig.region_1', pointer: 'marquee', dur: 450, on: armRegion }),
      ...drawBox(750),
      // The region's undo unit is the whole drag: one gesture, one entry on its own lane, all of it
      // back. A touch reader undoes with a two-finger tap (EDIT-44).
      ...(form.touch
        ? [
          hand.glide(67, 102, { capKey: 'help.fig.region_2', second: [68.6, 102], dur: 350 }),
          { press: true, dur: 140, on: ({ world }) => { world.undo(); } },
          { press: false, second: null, dur: 410 },
        ] satisfies SceneStep[]
        : [{ keys: UNDO_KEYS, capKey: 'help.fig.region_2', dur: 900, on: ({ world }) => { world.undo(); } }] satisfies SceneStep[]),
      hand.hover(65, 100, { keys: null, pointer: 'marquee', dur: 400 }),
      ...drawBox(600),
      // A press inside the region grabs the connected figure; the move keeps the tool's own cursor,
      // since the region screen has no grab hand.
      hand.hover(67, 102, { capKey: 'help.fig.region_3', dur: 500 }),
      hand.press({ dur: 160 }),
      hand.drag(72, 103, { dur: 800 }),
      hand.release({ dur: 1000 }),
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
    // The marks the shelf stands over a landed run: each end read off the maze's lattice
    // (`generate-batch.ts:mazeMarks`), a hole on its wall or a destination inside it.
    const runMaze = (gates?: { entrance?: MacroCoord | null; exit?: MacroCoord | null }): MazeMarks => {
      world.beginStroke();
      const out = world.generateTerrain(mazeRecipe(1, zone, gates));
      world.commit();
      walk = out.mazeWalk ?? null;
      const fp = mazeFootprintOn(world.state, zone, 1);
      return fp && out.mazeGates ? mazeMarks(world.state, fp, out.mazeGates) : { entrance: null, exit: null };
    };
    const first = runMaze();
    const from = first.entrance?.cell ?? { x: 64, y: 100 };
    // Strictly interior to the zone, so the dropped end resolves as a destination.
    const dropAt = { x: Math.min(82, from.x + 4), y: Math.min(106, from.y + 3) };
    return [
      { capKey: 'help.fig.maze_1', dur: 900, on: () => { view.marks(first); } },
      { capKey: 'help.fig.maze_2', move: [from.x, from.y], dur: 500 },
      { press: true, pointer: 'hand-closed', dur: 160 },
      {
        move: [dropAt.x, dropAt.y], dur: 700,
        during: (_ctx, k) => {
          // The held mark rides the pointer, as the live marker follows its drag.
          const at = { x: from.x + (dropAt.x - from.x) * k, y: from.y + (dropAt.y - from.y) * k };
          view.marks({ ...first, entrance: first.entrance ? { ...first.entrance, cell: at } : null });
        },
      },
      {
        press: false, pointer: 'select', dur: 900,
        on: ({ world: w }) => {
          w.undo();
          const gates = runMaze({ entrance: dropAt, exit: first.exit?.cell ?? null });
          view.marks(gates);
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
  run: (_ctx, _t, form) => {
    const hand = new Hand(form);
    return [
      hand.hover(SCOPE_RECT.x1, SCOPE_RECT.y1, { capKey: 'help.fig.scope_1', pointer: 'marquee', dur: 700, on: armRegion }),
      hand.press({ dur: 160 }),
      hand.drag(SCOPE_RECT.x2 + 0.45, SCOPE_RECT.y2 + 0.45, { dur: 900 }),
      // Done on the scope screen: the mark stays as the region the run reads.
      hand.release({ pointer: 'select', dur: 500, on: ({ world }) => { world.endRegionSelection(); } }),
      {
        capKey: 'help.fig.scope_2', dur: 400,
        on: ({ world, view }) => {
          world.beginStroke();
          runDesigned(world, 'scope', [...world.region]);
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
  run: (_ctx, _t, form) => {
    // A box straddling the coast: grass rows on top, then the boundary line, the beach and the sea.
    // The region brush itself skips every cell off buildable ground.
    const box = { x1: 63, y1: 118, x2: 74, y2: 128 };
    const hand = new Hand(form);
    return [
      hand.hover(box.x1, box.y1, { capKey: 'help.fig.ground_1', pointer: 'marquee', dur: 500, on: armRegion }),
      hand.press({ dur: 160 }),
      hand.drag(box.x2 + 0.45, box.y2 + 0.45, { dur: 800 }),
      hand.release({ pointer: 'select', dur: 800 }),
      hand.hover(69, 129.5, { capKey: 'help.fig.ground_2', dur: 600 }),
      hand.press({ dur: 200 }),
      hand.release({ dur: 1300 }),
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
