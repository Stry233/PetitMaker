/**
 * The Help Center's scenes for copy and paste and for placing many objects. Each selection, copy,
 * paste and Paint stroke goes through the editor's own code: the map's press rule and the selection
 * it writes, the copy and paste verbs over `tools/objects/arrangement.ts` with the notices they say,
 * and the placer's Paint stroke (`tools/pointer/objects/paint-stroke.ts`) driven by the pictured
 * pointer through the sandbox's tool manager.
 */
import { ToolType } from '../../../../state/editing/vocabulary';
import type { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import type { MacroCoord } from '../../../../core/model/types';
import type { TokenSpec } from '../../hints/catalogue';
import { bandSteps, ctrlHeld } from './build-objects';
import {
  CABIN, CTRL_KEYS, FLOWER, Hand, INTERIOR, TREE, armItem, freshSession, placeThrough, sayNotice,
  type HelpScene, type SceneForm, type SceneStep,
} from './common';

const COPY_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.copy' }];
const PASTE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.paste' }];

/** The small arrangement every copy scene starts from: a tree between two flowers. */
function sowArrangement(world: SandboxWorld): void {
  world.beginStroke();
  world.place(FLOWER, 65, 100);
  world.place(TREE, 66, 99);
  world.place(FLOWER, 67, 100);
  world.commit();
}

/** Selecting the arrangement: a Ctrl band over it with a mouse; with a finger, Multi-select from the
 *  tree's long-press menu (EDIT-43) and a band drawn across it. */
function selectSteps(hand: Hand, form: SceneForm): SceneStep[] {
  return bandSteps(hand, form, {
    from: [64.2, 98.2], to: [68.8, 101.2], holdAt: [66.5, 99.5],
    caps: { hold: 'help.fig.copy_multi_touch', drag: form.touch ? undefined : 'help.fig.select_1', done: undefined },
    dur: { drag: 800, done: 700 },
    release: ctrlHeld(form, false),
  });
}

/** The copy beat: Ctrl+C with a mouse, multi-select's Copy by finger; the toast is what the copy
 *  says. A finger then ends Multi-select with the plate's Done, since a hold under the latch opens no
 *  menu. */
function copySteps(hand: Hand, form: SceneForm): SceneStep[] {
  const copy: NonNullable<SceneStep['on']> = (ctx) => { ctx.world.copySelection(); sayNotice(ctx); };
  if (form.touch) {
    return [
      hand.control('multi-select-copy', { capKey: 'help.fig.copy_card_touch', dur: 500 }),
      { press: true, dur: 200 },
      { press: false, dur: 1100, on: copy },
      hand.control('multi-select-done', { dur: 450 }),
      { press: true, dur: 200 },
      { press: false, toastKey: null, dur: 200, on: ({ world }) => { world.clearSelection(); } },
    ];
  }
  return [
    { capKey: 'help.fig.copy_keys', keys: COPY_KEYS, dur: 1300, on: copy },
    { keys: null, toastKey: null, dur: 300 },
  ];
}

/** Aiming a paste at the block under (x, y): a mouse clicks it, which picks it, and presses Ctrl+V; a
 *  finger holds it, which opens the map's menu, and chooses Paste. `paste` rides on the paste beat. */
function pasteSteps(hand: Hand, form: SceneForm, x: number, y: number, paste: SceneStep): SceneStep[] {
  const put: NonNullable<SceneStep['on']> = (ctx) => {
    if (form.touch) ctx.world.menuPaste();
    else ctx.world.pasteKey();
    sayNotice(ctx);
  };
  return form.touch
    ? [
      hand.glide(x, y, { capKey: 'help.fig.paste_hold_touch', dur: 900 }),
      hand.hold({ dur: 800 }),
      hand.release({ dur: 300 }),
      { ...paste, capKey: 'help.fig.paste_menu_touch', on: put },
    ]
    : [
      hand.glide(x, y, { capKey: 'help.fig.paste_pick', dur: 900 }),
      ...hand.tap({ dur: 160 }, { dur: 700 }),
      { ...paste, capKey: 'help.fig.paste_keys', keys: PASTE_KEYS, on: put },
    ];
}

/** Copy, pick a block, paste: the whole loop of EDIT-53 and EDIT-54. */
const copypaste: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 64, y1: 98, x2: 76, y2: 102 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    sowArrangement(ctx.world);
    const hand = new Hand(form, true);
    return [
      ...selectSteps(hand, form),
      ...copySteps(hand, form),
      ...pasteSteps(hand, form, 74.5, 101.5, { dur: 1800 }),
      { keys: null, toastKey: null, capKey: 'help.fig.paste_done', dur: 1400 },
    ];
  },
};

/** A picked block with no room for the whole copy: it lands on the nearest ground that fits, and
 *  the paste says so (EDIT-57). */
const pasteblock: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 65, y1: 99, x2: 78, y2: 102 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    const { world } = ctx;
    sowArrangement(world);
    world.beginStroke();
    world.place(CABIN, 74, 99);
    world.commit();
    // The story starts from a copy taken: the arrangement selected by the map's own Ctrl band and
    // copied, the selection left standing, as it is after Ctrl+C.
    world.held.multiSelect = true;
    world.pressMap({ x: 64.2, y: 98.2 });
    world.moveMap({ x: 68.8, y: 101.2 });
    world.releaseMap({ x: 68.8, y: 101.2 });
    world.held.multiSelect = false;
    world.copySelection();
    if (form.touch) world.clearSelection();
    const hand = new Hand(form, true);
    return [
      hand.glide(66, 99.5, { capKey: 'help.fig.pasteblock_1', pointer: 'select', dur: 900 }),
      // The copy is three cells wide, so beside the house it would cross the house's wall.
      ...pasteSteps(hand, form, 72.5, 100.5, { dur: 2200 }),
      { keys: null, toastKey: null, capKey: 'help.fig.pasteblock_2', dur: 1400 },
    ];
  },
};

/** Ctrl+drag from a selected member drags out a copy and leaves the originals (EDIT-60). */
const copydrag: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 64, y1: 98, x2: 77, y2: 101 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    sowArrangement(ctx.world);
    const hand = new Hand(form, true);
    if (form.touch) {
      // By finger the copy comes from Copy, then Paste from the map's menu where the next one should go.
      return [
        ...selectSteps(hand, form),
        ...copySteps(hand, form),
        ...[70, 75].flatMap((x) => pasteSteps(hand, form, x + 0.5, 99.5, { dur: 1100 })),
        { toastKey: null, capKey: 'help.fig.copydrag_2', dur: 1400 },
      ];
    }
    // The map's own press with Ctrl held on a selected member: its drag carries a copy (EDIT-60).
    const steps = (from: MacroCoord, to: MacroCoord): SceneStep[] => [
      hand.glide(from.x + 0.5, from.y + 0.5, { ...ctrlHeld(form, true), capKey: 'help.fig.copydrag_1', pointer: 'move', dur: 800 }),
      hand.press({ dur: 200 }),
      hand.drag(to.x + 0.5, to.y + 0.5, { dur: 1000 }),
      hand.release({ ...ctrlHeld(form, false), pointer: 'select', dur: 900 }),
    ];
    return [
      ...selectSteps(hand, form),
      ...steps({ x: 66, y: 99 }, { x: 70, y: 99 }),
      ...steps({ x: 70, y: 99 }, { x: 74, y: 99 }),
      { capKey: 'help.fig.copydrag_2', dur: 1400 },
    ];
  },
};


/** The placer armed with `picks` and Paint chosen, as the brush bar arms it. */
function armPaint(world: SandboxWorld, picks: readonly string[], spacing: number): void {
  world.pick({
    tool: ToolType.ObjectPlacer, armedItem: picks[0] ?? null, picks,
    objectBrush: 'paint', objectPaintShape: 'free', objectPaintSpacing: spacing,
  });
}

/** A freehand Paint drag from `from` to `to`, through the placer's own stroke as the pointer moves. */
function paintDrag(from: [number, number], to: [number, number], capKey: SceneStep['capKey']): SceneStep[] {
  return [
    { move: from, pointer: 'place', dur: 600 },
    { capKey, press: true, dur: 200, on: ({ world }) => { world.pointerDown({ x: from[0], y: from[1] }); } },
    {
      move: to, dur: 1400,
      during: ({ world }, k) => { world.pointerMove({ x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k }); },
    },
    { press: false, dur: 1600, on: ({ world }) => { world.pointerUp({ x: to[0], y: to[1] }); } },
  ];
}

/** Paint lays trees along a drag, a Spacing apart (EDIT-65, EDIT-66). */
const objpaint: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 66, y1: 101, x2: 73, y2: 101 },
  strip: { kind: 'shelf', items: [TREE, FLOWER] },
  run: () => [
    { capKey: 'help.fig.objpaint_1', move: { strip: 0 }, pointer: 'clickable', dur: 900 },
    { press: true, dur: 160 },
    { press: false, strip: 0, dur: 500, on: ({ world }) => { armPaint(world, [TREE], 1); } },
    ...paintDrag([66.5, 101.5], [73.5, 101.5], 'help.fig.objpaint_2'),
    { capKey: 'help.fig.objpaint_3', dur: 1200 },
    { strip: null, dur: 300, on: ({ world }) => { world.pick({}); } },
  ],
};

/** Several cards picked with Ctrl (or held by finger) take turns along one stroke (EDIT-70). */
const objmix: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 66, y1: 101, x2: 73, y2: 101 },
  strip: { kind: 'shelf', items: [TREE, FLOWER] },
  run: (_ctx, _t, { touch }) => [
    { capKey: touch ? 'help.fig.objmix_1_touch' : 'help.fig.objmix_1', keys: touch ? null : CTRL_KEYS, move: { strip: 0 }, pointer: 'clickable', dur: 900 },
    { press: true, dur: touch ? 700 : 160 },
    { press: false, strip: 0, dur: 400 },
    { move: { strip: 1 }, dur: 600 },
    { press: true, dur: touch ? 700 : 160 },
    { press: false, keys: null, strip: 1, dur: 500, on: ({ world }) => { armPaint(world, [TREE, FLOWER], 1); } },
    ...paintDrag([66.5, 101.5], [73.5, 101.5], 'help.fig.objmix_2'),
    { capKey: 'help.fig.objmix_3', dur: 1200 },
    { strip: null, dur: 300, on: ({ world }) => { world.pick({}); } },
  ],
};


/** The last one a map may hold puts its card down once placed (EDIT-52). */
const objlimit: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 72, y1: 100, x2: 76, y2: 103 },
  strip: { kind: 'shelf', items: [CABIN, TREE] },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    const hand = new Hand(form, true);
    return [
      hand.strip(0, { capKey: 'help.fig.objlimit_1', pointer: 'clickable', dur: 900 }),
      { press: true, dur: 160, on: (c) => armItem(c, CABIN) },
      { press: false, strip: 0, pointer: 'place', dur: 400 },
      // The cabin is one per map, so placing it puts its card down (EDIT-52), as the shelf does.
      ...placeThrough(hand, form, [[74.5, 101.5, { dur: 1000 }]], { dur: 160 }, { dur: 500 }),
      { capKey: 'help.fig.objlimit_2', pointer: 'select', strip: null, dur: 1800 },
      { dur: 500 },
    ];
  },
};

export const BUILD_BATCH_SCENES: Record<string, HelpScene> = { copypaste, pasteblock, copydrag, objpaint, objmix, objlimit };
