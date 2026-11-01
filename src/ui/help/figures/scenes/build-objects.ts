/** The Help Center's Build scenes for water, roads, trims, objects and groups. */
import { helpFacts } from '../../facts';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import {
  CTRL_KEYS, ROTATE_KEYS, DELETE_KEYS, Hand, armItem, macroArming, pickTool, timed, freshSession, placeThrough, putDown, sayNotice,
  stroke, coatStroke, row, rect,
  CABIN, TREE, FLOWER, BRIDGE, RAMP, ROAD_TILE, RING_SEED, HEART_SEED, INTERIOR, PLAZA_EDGE,
  type HelpScene, type SceneForm, type SceneStep,
} from './common';
import type { SandboxWorld } from '../../../../editor/sandbox/demo-world';

type Point = readonly [number, number];

/** The form a caller that names none plays: a mouse reader on a wide screen. */
export const MOUSE_FORM: SceneForm = { touch: false, upright: false };

/** The multi-select command held (`on`) or let go, for a step's own fields: its key chip and the
 *  held state the press reads. A finger holds no key; its multi-select is the long-press menu's
 *  latch (`bandSteps`). */
export function ctrlHeld(form: SceneForm, on: boolean): Pick<SceneStep, 'keys' | 'on'> {
  if (form.touch) return {};
  return { keys: on ? CTRL_KEYS : null, on: ({ world }) => { world.held.multiSelect = on; } };
}

/**
 * A band drag from `from` to `to` on the map's own press. A mouse reader holds Ctrl, which the press
 * rule answers with the band; a touch reader first latches Multi-select from the long-press menu of
 * the object at `holdAt` (EDIT-43), which selects it, and the latch makes the drag a band. The band
 * adds what it touches on release. Ctrl stays held after it; `release` rides on the release beat.
 */
export function bandSteps(hand: Hand, form: SceneForm, band: {
  from: Point; to: Point; holdAt: Point;
  caps: { hold: SceneStep['capKey']; drag: SceneStep['capKey']; done: SceneStep['capKey'] };
  dur: { drag: number; done: number };
  release?: SceneStep;
}): SceneStep[] {
  const { from, to, holdAt, caps, dur } = band;
  const lead: SceneStep[] = form.touch
    ? [
      hand.glide(holdAt[0], holdAt[1], { capKey: caps.hold, dur: 550 }),
      hand.hold({ dur: 800 }),
      hand.release({ dur: 300, on: ({ world }) => { world.menuMultiSelect(); } }),
      hand.glide(from[0], from[1], { capKey: caps.drag, dur: 450 }),
    ]
    : [hand.glide(from[0], from[1], { ...ctrlHeld(form, true), capKey: caps.drag, dur: 550 })];
  return [
    ...lead,
    hand.press({ pointer: 'marquee', dur: 160 }),
    hand.drag(to[0], to[1], { dur: dur.drag }),
    hand.release({ ...band.release, pointer: 'select', capKey: caps.done, dur: dur.done }),
  ];
}

const water: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 67, y1: 99, x2: 74, y2: 103 },
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
  plot: { x1: 66, y1: 98, x2: 71, y2: 101 },
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
  plot: { x1: 64, y1: 99, x2: 73, y2: 104 },
  strip: { kind: 'shelf', items: [BRIDGE, TREE] },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    const { world } = ctx;
    // A mountain-walled pond, filled through the rules so the water genuinely stands. Oblong on
    // purpose: the short way across is under the bridge's span, so only one orientation stands.
    world.beginStroke();
    world.paint(row(99, 70, 73), TerrainType.Mountain, 1);
    world.paint(row(104, 70, 73), TerrainType.Mountain, 1);
    for (let y = 100; y <= 103; y++) world.paint([{ x: 70, y }, { x: 73, y }], TerrainType.Mountain, 1);
    for (let y = 100; y <= 103; y++) world.paint(row(y, 71, 72), TerrainType.Water, 1);
    world.commit();
    const hand = new Hand(form, true);
    return [
      hand.strip(0, { capKey: 'help.fig.objects_1', pointer: 'clickable', dur: 600 }),
      { press: true, strip: 0, dur: 240, on: (c) => armItem(c, BRIDGE) },
      // The placer's own ghost: refused where the pointer finds no crossing, standing on the bank.
      ...placeThrough(hand, form, [
        [72, 101, { press: false, pointer: 'place', dur: 800 }],
        [71, 101, { capKey: 'help.fig.objects_2', dur: 900 }],
      ], { dur: 240 }, { dur: 300 }),
      // The card stays in hand after a placement; clicking its shelf card puts it away.
      hand.hover(72, 102.5, { dur: 500 }),
      hand.strip(0, { pointer: 'clickable', dur: 550 }),
      { press: true, strip: null, dur: 240, on: putDown },
      { press: false, dur: 300 },
      hand.strip(1, { capKey: 'help.fig.objects_3', pointer: 'clickable', dur: 600 }),
      { press: true, strip: 1, dur: 240, on: (c) => armItem(c, TREE) },
      ...placeThrough(hand, form, [[64, 99, { press: false, pointer: 'place', dur: 700 }]], { dur: 240 }, { dur: 300 }),
      // The card stays in hand after a placement, exactly as the shelf arms it.
      hand.hover(65, 100, { dur: 550 }),
      ...placeThrough(hand, form, [[66, 103, { capKey: 'help.fig.objects_4', dur: 600 }]], { dur: 240 }, { dur: 900 }),
    ];
  },
};

/** The rotate key, or by finger the turn its beat names, then the turn itself. */
function turnSteps(hand: Hand, form: SceneForm, capKey: SceneStep['capKey']): SceneStep[] {
  // A touch reader turns it from the object's long-press menu, whose Rotate turns it as the
  // selection card's does (EDIT-42); a mouse reader presses the rotate key.
  if (form.touch) return [hand.hold({ capKey, dur: 800 }), hand.release({ dur: 1000, on: ({ world }) => { world.menuRotate(); } })];
  return [{ capKey, keys: ROTATE_KEYS, dur: 500 }, { dur: 1000, on: ({ world }) => { world.rotateSelection(90); } }];
}

const rotate: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 68, y1: 98, x2: 72, y2: 102 },
  run: (ctx, _t, form = MOUSE_FORM) => {
    freshSession(ctx);
    ctx.world.place(CABIN, 68, 98);
    const hand = new Hand(form, true);
    return [
      hand.glide(70, 99.5, { capKey: 'help.fig.rotate_1', pointer: 'select', dur: 700 }),
      ...hand.tap({ dur: 200 }, { dur: 600 }),
      ...turnSteps(hand, form, 'help.fig.rotate_2'),
      ...turnSteps(hand, form, 'help.fig.rotate_3'),
      { keys: null, dur: 800 },
    ];
  },
};

const ramp: HelpScene = {
  stage: { x1: 64, y1: 94, x2: 81, y2: 105, tile: 20 },
  plot: { x1: 68, y1: 95, x2: 77, y2: 99 },
  strip: { kind: 'shelf', items: [RAMP] },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    // Placement resolves the direction and elevation from the terrace edge.
    ctx.world.beginStroke();
    ctx.world.paint(rect(68, 95, 77, 98), TerrainType.Mountain, Number(helpFacts().rampDrop));
    ctx.world.commit();
    const hand = new Hand(form, true);
    return [
      hand.strip(0, { capKey: 'help.fig.ramp_1', pointer: 'clickable', dur: 600 }),
      { press: true, strip: 0, dur: 240, on: (c) => armItem(c, RAMP) },
      ...placeThrough(hand, form, [[72, 99, { press: false, pointer: 'place', dur: 1000 }]], { capKey: 'help.fig.ramp_2', dur: 240 }, { dur: 1800 }),
    ];
  },
};

const spacing: HelpScene = {
  stage: { x1: 62, y1: 96, x2: 75, y2: 104, tile: 24 },
  plot: { x1: 67, y1: 100, x2: 69, y2: 102 },
  strip: { kind: 'shelf', items: [TREE] },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    ctx.world.place(TREE, 67, 100);
    const hand = new Hand(form, true);
    return [
      hand.strip(0, { capKey: 'help.fig.plant_1', pointer: 'clickable', dur: 600 }),
      { press: true, strip: 0, dur: 240, on: (c) => armItem(c, TREE) },
      // The press asks the rules; the refusal that comes back is the app's own toast, word for word.
      ...placeThrough(hand, form, [[68, 101, { press: false, pointer: 'place', dur: 800 }]], { dur: 240 }, { realToast: true, capKey: 'help.fig.plant_2', dur: 1700 }),
      ...placeThrough(hand, form, [[69.5, 102.5, { toastKey: null, dur: 700 }]], { dur: 240 }, { capKey: 'help.fig.plant_3', dur: 1200 }),
    ];
  },
};

/** The smart-planting card the trees tab leads with: one press plants a varied patch through the
 *  editor's planting tool, and a second press elsewhere draws a different combination from the same
 *  grammar. */
const smartpatch: HelpScene = {
  stage: { x1: 61, y1: 95, x2: 78, y2: 106, tile: 20 },
  plot: { x1: 65, y1: 99, x2: 74, y2: 103 },
  strip: { kind: 'shelf', items: [TREE], smart: true },
  run: (_ctx, _t, form = MOUSE_FORM) => {
    const hand = new Hand(form);
    // Placement cells (66, 100) and (73, 102), pressed at their centres; each press is shorter than
    // one hold burst, so it plants once.
    return [
      hand.strip(0, { capKey: 'help.fig.smartpatch_1', pointer: 'clickable', dur: 600 }),
      { press: true, strip: 0, dur: 240, on: (c) => pickTool(c, macroArming('patch-tree')) },
      hand.hover(66.5, 100.5, { press: false, pointer: 'place', dur: 700 }),
      timed(hand.press({ dur: 260 })),
      hand.release({ dur: 1300 }),
      hand.hover(73.5, 102.5, { capKey: 'help.fig.smartpatch_2', dur: 600 }),
      timed(hand.press({ dur: 260 })),
      hand.release({ dur: 1800 }),
    ];
  },
};

/** The rare set piece: two presses of the planting card, each dealt a seed the roll answers with a
 *  shape, so the figure shows the pieces themselves rather than the odds of getting one. */
const delight: HelpScene = {
  stage: { x1: 60, y1: 95, x2: 81, y2: 107, tile: 18 },
  strip: { kind: 'shelf', items: [FLOWER], smart: true },
  run: (_ctx, _t, form = MOUSE_FORM) => {
    const hand = new Hand(form);
    // Placement cells (66, 101) and (76, 101), pressed at their centres.
    return [
      hand.strip(0, { capKey: 'help.fig.delight_1', pointer: 'clickable', dur: 600 }),
      { press: true, strip: 0, dur: 240, on: (c) => pickTool(c, macroArming('patch-flora')) },
      hand.hover(66.5, 101.5, { press: false, pointer: 'place', dur: 700, on: ({ world }) => { world.dealSeed(RING_SEED); } }),
      timed(hand.press({ dur: 280 })),
      hand.release({ capKey: 'help.fig.delight_2', dur: 1600 }),
      hand.hover(76.5, 101.5, { dur: 700, on: ({ world }) => { world.dealSeed(HEART_SEED); } }),
      timed(hand.press({ dur: 280 })),
      hand.release({ capKey: 'help.fig.delight_3', dur: 1900 }),
    ];
  },
};


const select: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 63, y1: 97, x2: 79, y2: 103 },
  run: (ctx, _t, form = MOUSE_FORM) => {
    freshSession(ctx);
    const { world } = ctx;
    world.place(TREE, 64, 98);
    world.place(TREE, 66, 99);
    world.place(FLOWER, 64, 102);
    world.place(CABIN, 75, 99);
    const hand = new Hand(form, true);
    const cabinAt: Point = [77.5, 101];
    return [
      ...bandSteps(hand, form, {
        from: [63.2, 97.2], to: [67.8, 103.6], holdAt: [64.5, 98.5],
        caps: {
          hold: 'help.fig.select_multi_touch',
          drag: 'help.fig.select_1',
          done: 'help.fig.select_2',
        },
        dur: { drag: 700, done: 900 },
      }),
      // Membership, Ctrl's second job (a tap while Multi-select is on): the pressed object comes in,
      // a second press lets it go.
      hand.glide(cabinAt[0], cabinAt[1], { capKey: 'help.fig.select_ctrl', dur: 550 }),
      ...hand.tap({ dur: 180 }, { dur: 700 }),
      ...hand.tap({ dur: 180 }, { dur: 500, ...ctrlHeld(form, false) }),
      // The map's own drag session: a press on a member grabs the group, each move previews the drop
      // on the overlay, and the release lands every member as one undo step (EDIT-27).
      hand.glide(66.5, 99.5, { capKey: 'help.fig.select_3', pointer: 'hand-open', dur: 450 }),
      hand.press({ pointer: 'hand-closed', dur: 180 }),
      hand.drag(70.5, 100.5, { dur: 800 }),
      hand.release({ pointer: 'select', dur: 1000 }),
    ];
  },
};

/** Selects what the band from `from` to `to` touches before a scene's first beat, through the map's
 *  own Ctrl band, for a scene whose story starts from a selection. */
function selectBefore(world: SandboxWorld, from: MacroCoord, to: MacroCoord): void {
  world.held.multiSelect = true;
  world.pressMap(from);
  world.moveMap(to);
  world.releaseMap(to);
  world.held.multiSelect = false;
}

const grouprotate: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 66, y1: 96, x2: 70, y2: 102 },
  run: (ctx, _t, form = MOUSE_FORM) => {
    freshSession(ctx);
    const { world } = ctx;
    world.place(TREE, 66, 98);
    world.place(TREE, 70, 98);
    world.place(FLOWER, 66, 102);
    selectBefore(world, { x: 65.5, y: 97.5 }, { x: 70.5, y: 102.5 });
    const hand = new Hand(form, true);
    const spin: SceneStep['on'] = ({ world: w }) => { w.rotateSelection(90); };
    // A mouse reader turns the group by key; a touch reader with the selection card's Rotate, which
    // stands over the selection (the long-press menu turns the one object it was opened on).
    const turn: SceneStep[] = form.touch
      ? [
        hand.control('handle-rotate', { dur: 500 }),
        { capKey: 'help.fig.gspin_2', press: true, dur: 300 },
        { press: false, dur: 400, on: spin },
      ]
      : [
        { keys: ROTATE_KEYS, dur: 600 },
        { capKey: 'help.fig.gspin_2', dur: 400, on: spin },
      ];
    return [
      { capKey: 'help.fig.gspin_1', move: [68, 100], pointer: 'select', dur: 700 },
      ...turn,
      { dur: 900 },
      { keys: null, capKey: 'help.fig.gspin_3', dur: 1400 },
    ];
  },
};

/** The plaza refusing, twice over: a group delete keeps it and says what it kept, and a delete aimed
 *  at it alone comes back with the rule's own words. Both run the delete every surface takes
 *  (`editor/editing/group-edit.ts:deleteSelection`), reported as it reports. */
const locked: HelpScene = {
  // The plaza's south-west corner, which is the only part of the slab a readable crop can hold.
  stage: PLAZA_EDGE,
  plot: { x1: 73, y1: 88, x2: 86, y2: 99 },
  run: (ctx, _t, form = MOUSE_FORM) => {
    freshSession(ctx);
    const { world } = ctx;
    world.place(CABIN, 73, 93);
    for (const p of [{ x: 81, y: 94 }, { x: 84, y: 96 }]) world.place(TREE, p.x, p.y);
    const hand = new Hand(form, true);
    const plazaAt: Point = [82, 90];
    const removeAll: SceneStep['on'] = (c) => { c.world.deleteSelection(); sayNotice(c); };
    // A mouse reader deletes by key; a touch reader with the multi-select bar's Delete, which runs
    // the same command.
    const remove: SceneStep[] = form.touch
      ? [hand.control('multi-select-delete', { dur: 450 }), { press: true, dur: 300 }, { press: false, dur: 200, on: removeAll }]
      : [{ keys: DELETE_KEYS, dur: 600 }, { press: true, dur: 200, on: removeAll }, { press: false, keys: null, dur: 200 }];
    // What the group delete leaves selected is the plaza alone. A mouse reader presses Delete again;
    // a touch reader ends Multi-select with the bar's Done, which clears the selection, and deletes
    // the plaza from its long-press menu.
    const removePlaza: SceneStep[] = form.touch
      ? [
        hand.control('multi-select-done', { dur: 450 }),
        { press: true, dur: 200 },
        { press: false, dur: 200, on: ({ world: w }) => { w.clearSelection(); } },
        hand.glide(plazaAt[0], plazaAt[1], { capKey: 'help.fig.locked_3', dur: 700 }),
        hand.hold({ dur: 800 }),
        hand.release({ dur: 200, realToast: true, on: ({ world: w }) => { w.menuDelete(); } }),
      ]
      : [
        hand.glide(plazaAt[0], plazaAt[1], { capKey: 'help.fig.locked_3', dur: 700 }),
        // Delete on one object unrolls its confirmation, whose press deletes it.
        { keys: DELETE_KEYS, dur: 600 },
        { press: true, dur: 200, realToast: true, on: ({ world: w }) => { const [id] = w.selectedIds(); if (id) w.deleteConfirmed(id); } },
        { press: false, keys: null, dur: 200 },
      ];
    return [
      // The plaza joins the selection like anything else the band touched; its ring is its whole
      // footprint, most of which stands outside this crop.
      ...bandSteps(hand, form, {
        from: [79, 88], to: [86.5, 97.5], holdAt: [81.5, 94.5],
        caps: { hold: 'help.fig.select_multi_touch', drag: 'help.fig.locked_1', done: 'help.fig.locked_2' },
        dur: { drag: 750, done: 1000 },
        release: ctrlHeld(form, false),
      }),
      // The delete takes what it can and keeps what it cannot: the trees go, the plaza stands.
      ...remove,
      { keys: null, dur: 1700 },
      { toastKey: null, dur: 300 },
      ...removePlaza,
      { keys: null, dur: 1400 },
    ];
  },
};


export const BUILD_OBJECT_SCENES: Record<string, HelpScene> = { water, road, objects, rotate, ramp, spacing, smartpatch, delight, select, grouprotate, locked };
