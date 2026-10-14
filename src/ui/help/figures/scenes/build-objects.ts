/** The Help Center's Build scenes for water, roads, trims, objects and groups. */
import { removeObjectCommand } from '../../../../core/model/command-build';
import { helpFacts } from '../../facts';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { templateLandmark } from '../../../../core/model/landmarks';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { CTRL_KEYS, ROTATE_KEYS, DELETE_KEYS, stroke, coatStroke, row, rect, CABIN, TREE, FLOWER, BRIDGE, RAMP, ROAD_TILE, RING_SEED, HEART_SEED, INTERIOR, PLAZA_EDGE, type HelpScene } from './common';


const water: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'draw', surface: 'water' },
  run: ({ world }) => {
    // The basin stands before the brush arrives: water above ground level is legal only against
    // rock at its own layer, so the walls are the recipe's first ingredient (the same authoring
    // as the objects scene's pond).
    world.beginStroke();
    world.paint(row(100, 67, 74), TerrainType.Mountain, 1);
    world.paint(row(103, 67, 74), TerrainType.Mountain, 1);
    for (let y = 101; y <= 102; y++) world.paint([{ x: 67, y }, { x: 74, y }], TerrainType.Mountain, 1);
    world.commit();
    const fill = rect(68, 101, 73, 102);
    return [
      { capKey: 'help.fig.water_1', move: [70.5, 99], pointer: 'select', dur: 800 },
      { move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, dur: 220 },
      { press: false, move: [68, 101], pointer: 'water', dur: 500 },
      { capKey: 'help.fig.water_2', press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [73, 102], dur: 900, during: stroke(fill, TerrainType.Water, 1) },
      { press: false, capKey: 'help.fig.water_3', dur: 1500, on: ({ world: w }) => { w.commit(); } },
      { dur: 500 },
    ];
  },
};

const road: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'rect', surface: 'road' },
  run: () => {
    // An L of pavers: one held drag, each crossed cell taking its own coating object through the
    // real placement command, the way the paving brush lays a street.
    const along = row(101, 66, 71);
    const up: MacroCoord[] = [{ x: 71, y: 100 }, { x: 71, y: 99 }, { x: 71, y: 98 }];
    return [
      { capKey: 'help.fig.road_1', move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'draw', dur: 500 },
      { press: false, move: [66, 101], pointer: 'road', dur: 500 },
      { press: true, dur: 160 },
      { move: [71, 101], dur: 800, during: coatStroke(along, ROAD_TILE) },
      { move: [71, 98], dur: 550, during: coatStroke(up, ROAD_TILE) },
      { press: false, capKey: 'help.fig.road_2', dur: 1500 },
      { dur: 400 },
    ];
  },
};

/** One corner of one cell, stepped through the edge-cut tool's own cycle: the digit is the tool's
 *  base-3 odometer state (0 square, 1 fan, 2 the corner's own outer triangle from `OUTER_TRI`),
 *  so the pictured shapes are the live cycle's and can never drift from it. */

const objects: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'shelf', items: [BRIDGE, TREE] },
  run: ({ world, view }) => {
    // A mountain-walled pond, filled through the rules so the water genuinely stands. Oblong on
    // purpose: the short way across is under the bridge's span, so only one orientation stands.
    world.beginStroke();
    world.paint(row(99, 70, 73), TerrainType.Mountain, 1);
    world.paint(row(104, 70, 73), TerrainType.Mountain, 1);
    for (let y = 100; y <= 103; y++) world.paint([{ x: 70, y }, { x: 73, y }], TerrainType.Mountain, 1);
    for (let y = 100; y <= 103; y++) world.paint(row(y, 71, 72), TerrainType.Water, 1);
    world.commit();
    return [
      { capKey: 'help.fig.objects_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, follow: { catalogId: BRIDGE }, dur: 240 },
      { press: false, pointer: 'place', move: [72, 101], dur: 800 },
      { capKey: 'help.fig.objects_2', move: [71, 101], dur: 900 },
      // The card stays in hand after a placement; clicking its shelf card puts it away.
      {
        press: true, dur: 240,
        on: ({ world: w }) => { w.place(BRIDGE, 71, 101, { plop: view.plop }); },
      },
      { press: false, move: [72, 102.5], dur: 500 },
      { move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, follow: null, strip: null, dur: 240 },
      { press: false, dur: 300 },
      { capKey: 'help.fig.objects_3', move: { strip: 1 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 1, follow: { catalogId: TREE }, dur: 240 },
      { press: false, pointer: 'place', move: [64, 99], dur: 700 },
      {
        press: true, dur: 240,
        on: ({ world: w }) => { w.place(TREE, 64, 99, { plop: view.plop }); },
      },
      // The card stays in hand after a placement, exactly as the shelf arms it.
      { press: false, move: [65, 100], dur: 550 },
      { capKey: 'help.fig.objects_4', move: [66, 103], dur: 600 },
      {
        press: true, follow: null, strip: null, dur: 240,
        on: ({ world: w }) => { view.clearGhost(); w.place(TREE, 66, 103, { plop: view.plop }); },
      },
      { press: false, dur: 900 },
    ];
  },
};

const rotate: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    world.place(CABIN, 68, 98);
    return [
      { capKey: 'help.fig.rotate_1', move: [70, 99.5], pointer: 'select', dur: 700 },
      {
        press: true, dur: 200,
        on: ({ world: w }) => {
          const c = w.objectAt(CABIN, 68, 98);
          if (c) view.selection(c.position.x, c.position.y, 5, 4);
        },
      },
      { press: false, dur: 600 },
      { capKey: 'help.fig.rotate_2', keys: ROTATE_KEYS, dur: 500 },
      {
        dur: 1000,
        on: ({ world: w }) => {
          const c = w.objectAt(CABIN, 68, 98);
          if (!c) return;
          const res = w.rotateObject(c, 90, { from: 0, to: 90 });
          if (res.ok && res.spin) view.spin(c.id, res.spin.from, res.spin.to);
          // The footprint transposes with the turn, and the ring follows it the way the live one does.
          view.selection(68, 98, 4, 5);
        },
      },
      { capKey: 'help.fig.rotate_3', dur: 500 },
      {
        dur: 1000,
        on: ({ world: w }) => {
          const c = w.objectAt(CABIN, 68, 98);
          if (!c) return;
          const res = w.rotateObject(c, 180, { from: 90, to: 180 });
          if (res.ok && res.spin) view.spin(c.id, res.spin.from, res.spin.to);
          view.selection(68, 98, 5, 4);
        },
      },
      { keys: null, dur: 800 },
    ];
  },
};

const ramp: HelpScene = {
  stage: { x1: 64, y1: 94, x2: 81, y2: 105, tile: 20 },
  strip: { kind: 'shelf', items: [RAMP] },
  run: ({ world, view }) => {
    // Placement resolves the direction and elevation from the terrace edge.
    world.beginStroke();
    world.paint(rect(68, 95, 77, 98), TerrainType.Mountain, Number(helpFacts().rampDrop));
    world.commit();
    return [
      { capKey: 'help.fig.ramp_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, follow: { catalogId: RAMP }, dur: 240 },
      { press: false, pointer: 'place', move: [72, 99], dur: 1000 },
      {
        capKey: 'help.fig.ramp_2', press: true, follow: null, strip: null, dur: 240,
        on: ({ world: w }) => { view.clearGhost(); w.place(RAMP, 72, 98, { plop: view.plop }); },
      },
      { press: false, dur: 1800 },
    ];
  },
};

const spacing: HelpScene = {
  stage: { x1: 62, y1: 96, x2: 75, y2: 104, tile: 24 },
  strip: { kind: 'shelf', items: [TREE] },
  run: ({ world }) => {
    world.place(TREE, 67, 100);
    return [
      { capKey: 'help.fig.plant_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, follow: { catalogId: TREE }, dur: 240 },
      { press: false, pointer: 'place', move: [68, 101], dur: 800 },
      // The press asks the rules; the refusal that comes back is the app's own toast, word for word.
      { press: true, dur: 240, on: ({ world: w }) => { w.place(TREE, 68, 101); } },
      { press: false, realToast: true, capKey: 'help.fig.plant_2', dur: 1700 },
      { toastKey: null, move: [69.5, 102.5], dur: 700 },
      {
        press: true, follow: null, strip: null, dur: 240,
        on: (ctx) => { ctx.view.clearGhost(); ctx.world.place(TREE, 69, 102, { plop: ctx.view.plop }); },
      },
      { press: false, capKey: 'help.fig.plant_3', dur: 1200 },
    ];
  },
};

/** The smart-planting card the trees tab leads with: one press plants a varied patch through the
 *  real macro, and a second press elsewhere draws a different combination from the same grammar. */
const smartpatch: HelpScene = {
  stage: { x1: 61, y1: 95, x2: 78, y2: 106, tile: 20 },
  strip: { kind: 'shelf', items: [TREE], smart: true },
  run: () => [
    { capKey: 'help.fig.smartpatch_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
    { press: true, strip: 0, dur: 240 },
    { press: false, pointer: 'place', move: [66, 100], dur: 700 },
    // Radius 4 is the bar's own smallest setting, the same floor `smart1` poses.
    { press: true, dur: 260, on: ({ world }) => { world.applyMacro('patch-tree', { seed: 11, at: { x: 66, y: 100 }, radius: 4 }); } },
    { press: false, dur: 1300 },
    { capKey: 'help.fig.smartpatch_2', move: [73, 102], dur: 600 },
    { press: true, dur: 260, on: ({ world }) => { world.applyMacro('patch-tree', { seed: 12, at: { x: 73, y: 102 }, radius: 4 }); } },
    { press: false, dur: 1800 },
  ],
};

/** The rare set piece: two presses of the planting card whose seeds the roll answers with a shape,
 *  so the figure shows the pieces themselves rather than the odds of getting one. */
const delight: HelpScene = {
  stage: { x1: 60, y1: 95, x2: 81, y2: 107, tile: 18 },
  strip: { kind: 'shelf', items: [FLOWER], smart: true },
  run: () => {
    const ring = { x: 66, y: 101 };
    const heart = { x: 76, y: 101 };
    return [
      { capKey: 'help.fig.delight_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, dur: 240 },
      { press: false, pointer: 'place', move: [ring.x, ring.y], dur: 700 },
      {
        press: true, dur: 280,
        on: ({ world }) => { world.applyMacro('patch-flora', { seed: RING_SEED, at: ring, radius: 4 }); },
      },
      { press: false, capKey: 'help.fig.delight_2', dur: 1600 },
      { move: [heart.x, heart.y], dur: 700 },
      {
        press: true, dur: 280,
        on: ({ world }) => { world.applyMacro('patch-flora', { seed: HEART_SEED, at: heart, radius: 4 }); },
      },
      { press: false, capKey: 'help.fig.delight_3', dur: 1900 },
    ];
  },
};

const select: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    world.place(TREE, 64, 98);
    world.place(TREE, 66, 99);
    world.place(FLOWER, 64, 102);
    world.place(CABIN, 75, 99);
    const picked = [
      { catalogId: TREE, x: 64, y: 98 },
      { catalogId: TREE, x: 66, y: 99 },
      { catalogId: FLOWER, x: 64, y: 102 },
    ];
    const ringPicked = () => {
      for (const [i, p] of picked.entries()) view.selection(p.x, p.y, 1, 1, i > 0);
    };
    return [
      { keys: CTRL_KEYS, capKey: 'help.fig.select_1', move: [63.2, 97.2], dur: 500 },
      { press: true, pointer: 'marquee', dur: 160 },
      {
        move: [67.8, 103.6], dur: 700,
        during: (_ctx, k) => { view.band({ x: 63.2, y: 97.2, w: 4.6 * k, h: 6.4 * k }); },
      },
      {
        press: false, pointer: 'select', capKey: 'help.fig.select_2', dur: 900,
        on: () => {
          view.band(null);
          ringPicked();
        },
      },
      // Ctrl's second job, membership: still held, a click brings the cabin in, another lets it go.
      { capKey: 'help.fig.select_ctrl', move: [77.5, 101], dur: 550 },
      { press: true, dur: 180, on: () => { view.selection(75, 99, 5, 4, true); } },
      { press: false, dur: 700 },
      { press: true, dur: 180, on: () => { ringPicked(); } },
      { press: false, keys: null, dur: 500 },
      { capKey: 'help.fig.select_3', move: [65, 100.5], pointer: 'hand-open', dur: 450 },
      {
        press: true, pointer: 'hand-closed', dur: 180,
        on: ({ world: w }) => {
          for (const p of picked) {
            const obj = w.objectAt(p.catalogId, p.x, p.y);
            if (obj) { view.poof(obj.id); w.execute(removeObjectCommand(obj)); }
          }
          view.clearSelection();
        },
      },
      {
        move: [69, 101.5], dur: 800,
        during: (_ctx, k) => {
          view.groupGhost(picked.map((p) => ({ catalogId: p.catalogId, x: p.x + 4 * k, y: p.y + 1 * k, rotation: 0, elevation: 0 })));
        },
      },
      {
        press: false, pointer: 'select', dur: 1000,
        on: ({ world: w }) => {
          view.clearGhost();
          for (const [i, p] of picked.entries()) {
            w.place(p.catalogId, p.x + 4, p.y + 1, { plop: view.plop });
            view.selection(p.x + 4, p.y + 1, 1, 1, i > 0);
          }
        },
      },
    ];
  },
};

const grouprotate: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    const members = [
      { catalogId: TREE, x: 66, y: 98 },
      { catalogId: TREE, x: 70, y: 98 },
      { catalogId: FLOWER, x: 66, y: 102 },
    ];
    const ids: string[] = [];
    for (const m of members) {
      const id = world.place(m.catalogId, m.x, m.y);
      if (id) ids.push(id);
    }
    const ringAll = (w: SandboxWorld) => {
      let first = true;
      for (const id of ids) {
        const o = w.state.objects.get(id);
        if (o) { view.selection(o.position.x, o.position.y, 1, 1, !first); first = false; }
      }
    };
    return [
      {
        capKey: 'help.fig.gspin_1', move: [68, 100], pointer: 'select', dur: 700,
        on: ({ world: w }) => { ringAll(w); },
      },
      { keys: ROTATE_KEYS, dur: 600 },
      {
        capKey: 'help.fig.gspin_2', dur: 400,
        on: ({ world: w }) => {
          view.clearSelection();
          w.rotateGroup(ids, 1, (turn) => view.groupSpin(turn));
        },
      },
      { dur: 900, on: ({ world: w }) => { ringAll(w); } },
      { keys: null, capKey: 'help.fig.gspin_3', dur: 1400 },
    ];
  },
};

/** The plaza refusing, twice over: a group delete keeps it and reports what it kept, and a delete
 *  aimed at it alone comes back with the rule's own words. Both go through the real doors — the
 *  group verb `deleteGroup` and the plain removal command every delete surface issues. */
const locked: HelpScene = {
  // The plaza's south-west corner, which is the only part of the slab a readable crop can hold.
  stage: PLAZA_EDGE,
  run: ({ world, view }) => {
    world.place(CABIN, 73, 93);
    const trees = [{ x: 81, y: 94 }, { x: 84, y: 96 }];
    const ids: string[] = [];
    for (const p of trees) {
      const id = world.place(TREE, p.x, p.y);
      if (id) ids.push(id);
    }
    const landmark = templateLandmark(world.state);
    const ringLandmark = () => {
      if (landmark) view.selection(landmark.position.x, landmark.position.y, landmark.width ?? 1, landmark.height ?? 1);
    };
    const band = { x: 79, y: 88, w: 7.5, h: 9.5 };
    return [
      { keys: CTRL_KEYS, capKey: 'help.fig.locked_1', move: [band.x, band.y], pointer: 'marquee', dur: 550 },
      { press: true, dur: 160 },
      {
        move: [band.x + band.w, band.y + band.h], dur: 750,
        during: (_ctx, k) => { view.band({ x: band.x, y: band.y, w: band.w * k, h: band.h * k }); },
      },
      // The plaza joins the selection like anything else the band touched; its ring is its whole
      // footprint, most of which stands outside this crop.
      {
        press: false, keys: null, pointer: 'select', capKey: 'help.fig.locked_2', dur: 1000,
        on: ({ world: w }) => {
          view.band(null);
          ringLandmark();
          for (const p of trees) {
            const obj = w.objectAt(TREE, p.x, p.y);
            if (obj) view.selection(obj.position.x, obj.position.y, 1, 1, true);
          }
        },
      },
      { keys: DELETE_KEYS, dur: 600 },
      // The group verb takes what it can and keeps what it cannot: the trees go, the plaza stands.
      {
        press: true, dur: 200,
        on: ({ world: w }) => {
          w.deleteGroup(ids, (obj) => view.poof(obj.id));
          view.clearSelection();
          ringLandmark();
        },
      },
      // The app's own count for a group delete that kept a locked member.
      { press: false, keys: null, toastKey: 'toast.group_delete_kept', toastParams: { n: 1 }, dur: 1700 },
      { toastKey: null, capKey: 'help.fig.locked_3', move: [82, 90], dur: 700 },
      { keys: DELETE_KEYS, dur: 600 },
      // The same removal command every delete surface issues, and the rule's own refusal comes back.
      {
        press: true, realToast: true, dur: 240,
        on: ({ world: w }) => {
          const p = templateLandmark(w.state);
          if (p) w.execute(removeObjectCommand(p));
        },
      },
      { press: false, keys: null, dur: 1600 },
    ];
  },
};


export const BUILD_OBJECT_SCENES: Record<string, HelpScene> = { water, road, objects, rotate, ramp, spacing, smartpatch, delight, select, grouprotate, locked };
