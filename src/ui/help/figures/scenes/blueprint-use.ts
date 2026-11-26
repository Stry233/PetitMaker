/** The Help Center's scenes for a placed blueprint (BLUE-07): selected whole, narrowed to one kind,
 *  turned and moved, copied with its ground or as objects alone, and taken back. */
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import type { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import {
  DELETE_KEYS, ROTATE_KEYS, Hand, freshSession, rect, sayNotice, FLOWER, TREE,
  type DemoCtx, type HelpScene, type Resolver, type SceneForm, type SceneStep, type Stage,
} from './common';
import { ctrlHeld } from './build-objects';

/** The figures' blueprint, as object-grid cells: a terrace of one layer under two trees, and a
 *  flower on the ground before it. */
const GARDEN = { w: 6, h: 4 } as const;

/** Where the figures' blueprint stands on flat ground, its frame's top-left. */
const HOME: MacroCoord = { x: 66, y: 99 };

/** The raised ground the copies and the deletion stand on, terrain cells at layer 1. */
const TERRACE = { x1: 74, y1: 100, x2: 81, y2: 106 } as const;
/** The terrace's frame top-left for a blueprint standing on it. */
const ON_TERRACE: MacroCoord = { x: 75, y: 101 };

/**
 * The figures' blueprint built at `at` on ground of layer `base`, captured as the save step captures
 * it, the build undone, and placed there as a press with it armed places it, so the scene opens on a
 * placement selected whole, as the live editor leaves one.
 */
function layGarden({ world }: DemoCtx, t: Resolver, at: MacroCoord, base = 0): void {
  const { x, y } = at;
  world.beginStroke();
  world.paint(rect(x + 2, y + 1, x + 5, y + 3), TerrainType.Mountain, base + 1);
  world.place(TREE, x + 2, y + 1, { elevation: base + 1 });
  world.place(TREE, x + 4, y + 2, { elevation: base + 1 });
  world.place(FLOWER, x, y + 3, { elevation: base });
  world.commit();
  const body = world.captureFrame({ x, y, ...GARDEN });
  world.undo();
  if (body) world.placeBody(body, at, t('help.bpgroups.fig_name'));
}

/** A crop of the planet's interior around every plot here, wide enough that the neighbourhood built
 *  past each plot's cleared ground stands in it; the camera frames the plot itself. */
function around(tile: number): Stage {
  return { x1: 58, y1: 93, x2: 90, y2: 111, tile };
}

/** The scene's world in Blueprint mode on a fresh session. */
function blueprintSession(ctx: DemoCtx): SandboxWorld {
  freshSession(ctx);
  ctx.world.blueprintMode = true;
  return ctx.world;
}

/** The terrace the copies and the deletion land on. */
function raiseTerrace(world: SandboxWorld): void {
  world.beginStroke();
  world.paint(rect(TERRACE.x1, TERRACE.y1, TERRACE.x2, TERRACE.y2), TerrainType.Mountain, 1);
  world.commit();
}

/** A press on the pictured card's control `testId`, the press acting through `on`. */
function pressControl(hand: Hand, testId: string, on: NonNullable<SceneStep['on']>, extra: SceneStep = {}): SceneStep[] {
  return [
    hand.control(testId, { dur: 550, ...extra }),
    { press: true, dur: 200 },
    { press: false, dur: 500, on },
  ];
}

const bpwhole: HelpScene = {
  stage: around(19),
  plot: { x1: 65, y1: 98, x2: 73, y2: 104 },
  run: (ctx, t, form) => {
    blueprintSession(ctx);
    layGarden(ctx, t, HOME);
    ctx.world.clearSelection(false);
    const hand = new Hand(form, true);
    // Open ground inside the frame, beside the terrace: no object or laid cell stands under it.
    const inside = [HOME.x + 1.5, HOME.y + 0.5] as const;
    return [
      hand.glide(65, 104, { dur: 400 }),
      hand.hover(inside[0], inside[1], { capKey: 'help.bpgroups.fig_whole_1', dur: 900 }),
      ...hand.tap({ dur: 200 }, { capKey: 'help.bpgroups.fig_whole_2', dur: 2200 }),
    ];
  },
};

const bpnarrow: HelpScene = {
  // Taller than the others, the pointer coming in from its foot, so the card stands under the
  // placement with room for its details open.
  stage: { ...around(19), y1: 88, y2: 115 },
  plot: { x1: 65, y1: 98, x2: 77, y2: 104 },
  run: (ctx, t, form) => {
    const world = blueprintSession(ctx);
    layGarden(ctx, t, HOME);
    const hand = new Hand(form, true);
    const tree = [HOME.x + 2.5, HOME.y + 1.5] as const;
    return [
      hand.glide(HOME.x + 3, 115, { dur: 400 }),
      ...pressControl(hand, 'selection-details', () => { world.showCardDetails(true); }, { capKey: 'help.bpgroups.fig_narrow_1' }),
      // The trees are the group's most numerous kind, so theirs is the details' first row.
      ...pressControl(hand, 'selection-kind', () => { world.narrowTo(TREE); }, { capKey: 'help.bpgroups.fig_narrow_2' }),
      { dur: 600 },
      hand.glide(tree[0], tree[1], { capKey: 'help.bpgroups.fig_narrow_3', pointer: 'hand-open', dur: 600 }),
      hand.press({ pointer: 'hand-closed', dur: 200 }),
      hand.drag(tree[0] + 6, tree[1], { dur: 900 }),
      hand.release({ pointer: 'select', dur: 1600 }),
    ];
  },
};

const bpgroupturn: HelpScene = {
  stage: around(17),
  plot: { x1: 65, y1: 97, x2: 77, y2: 105 },
  run: (ctx, t, form) => {
    const world = blueprintSession(ctx);
    layGarden(ctx, t, HOME);
    const hand = new Hand(form, true);
    const turn: SceneStep['on'] = () => { world.rotateSelection(90); };
    // A mouse turns it by key; a finger with the card's Rotate.
    const turnSteps: SceneStep[] = form.touch
      ? pressControl(hand, 'handle-rotate', turn, { capKey: 'help.bpgroups.fig_turn_1' })
      : [{ keys: ROTATE_KEYS, capKey: 'help.bpgroups.fig_turn_1', dur: 700 }, { dur: 600, on: turn }, { keys: null, dur: 300 }];
    // A cell of the terrace both before and after the turn, so the drag starts inside the frame.
    const grab = [HOME.x + 2.5, HOME.y + 1.5] as const;
    return [
      { move: [HOME.x + 3, HOME.y + 2], pointer: 'select', dur: 500 },
      ...turnSteps,
      { dur: 700 },
      hand.glide(grab[0], grab[1], { capKey: 'help.bpgroups.fig_turn_2', pointer: 'hand-open', dur: 600 }),
      hand.press({ pointer: 'hand-closed', dur: 200 }),
      hand.drag(grab[0] + 5, grab[1], { dur: 900 }),
      hand.release({ pointer: 'select', dur: 1600 }),
    ];
  },
};

/** The copy pair's crop: the blueprint on flat ground and the terrace beside it, narrow enough that
 *  two stand side by side in the page column, the neighbourhood showing above and below. */
const PAIR_STAGE: Stage = { x1: 63, y1: 93, x2: 82, y2: 112, tile: 15 };
const PAIR_PLOT = { x1: 65, y1: 98, x2: 81, y2: 107 } as const;

/** A copy of the selection onto the terrace: a mouse Ctrl+drags it from `grab`; a finger presses
 *  Copy on the card, then holds the terrace and chooses Paste. */
function copySteps(hand: Hand, form: SceneForm, world: SandboxWorld, grab: readonly [number, number]): SceneStep[] {
  const dx = ON_TERRACE.x - HOME.x, dy = ON_TERRACE.y - HOME.y;
  if (form.touch) {
    return [
      ...pressControl(hand, 'handle-copy', (ctx) => { world.copySelection(); sayNotice(ctx); }),
      { toastKey: null, dur: 200 },
      hand.glide(ON_TERRACE.x + 0.5, ON_TERRACE.y + 0.5, { dur: 600 }),
      hand.hold({ dur: 800 }),
      hand.release({ dur: 300 }),
      { dur: 1600, on: (ctx) => { world.menuPaste(); sayNotice(ctx); } },
    ];
  }
  return [
    hand.glide(grab[0], grab[1], { ...ctrlHeld(form, true), pointer: 'move', dur: 700 }),
    hand.press({ dur: 200 }),
    hand.drag(grab[0] + dx, grab[1] + dy, { dur: 1000 }),
    hand.release({ ...ctrlHeld(form, false), pointer: 'select', dur: 1800 }),
  ];
}

/** The whole group copied: its terrace comes with it and stands on the raised ground. */
const bpcopywhole: HelpScene = {
  stage: PAIR_STAGE,
  plot: PAIR_PLOT,
  run: (ctx, t, form) => {
    const world = blueprintSession(ctx);
    raiseTerrace(world);
    layGarden(ctx, t, HOME);
    const hand = new Hand(form, true);
    // A cell of its terrace with no object on it: a Ctrl press there carries the whole group.
    return [{ dur: 500 }, ...copySteps(hand, form, world, [HOME.x + 3.5, HOME.y + 1.5])];
  },
};

/** The group narrowed to its trees, then copied: the trees go alone, with no ground. */
const bpcopykind: HelpScene = {
  stage: PAIR_STAGE,
  plot: PAIR_PLOT,
  run: (ctx, t, form) => {
    const world = blueprintSession(ctx);
    raiseTerrace(world);
    layGarden(ctx, t, HOME);
    world.narrowTo(TREE);
    const hand = new Hand(form, true);
    return [{ dur: 500 }, ...copySteps(hand, form, world, [HOME.x + 2.5, HOME.y + 1.5])];
  },
};

/** The group standing on the terrace taken back whole: the terrace stays as it stood before. */
const bpdelete: HelpScene = {
  stage: around(17),
  plot: { x1: 73, y1: 99, x2: 81, y2: 107 },
  run: (ctx, t, form) => {
    const world = blueprintSession(ctx);
    raiseTerrace(world);
    layGarden(ctx, t, ON_TERRACE, 1);
    const hand = new Hand(form, true);
    const remove: NonNullable<SceneStep['on']> = () => { world.deleteSelection(); };
    const deleteSteps: SceneStep[] = form.touch
      ? pressControl(hand, 'handle-delete', remove, { capKey: 'help.bpgroups.fig_delete_1' })
      : [{ keys: DELETE_KEYS, capKey: 'help.bpgroups.fig_delete_1', dur: 800 }, { dur: 500, on: remove }, { keys: null, dur: 200 }];
    return [
      { move: [ON_TERRACE.x + 3, ON_TERRACE.y + 5], pointer: 'select', dur: 700 },
      ...deleteSteps,
      { capKey: 'help.bpgroups.fig_delete_2', dur: 2000 },
    ];
  },
};

export const BLUEPRINT_USE_SCENES: Record<string, HelpScene> = { bpwhole, bpnarrow, bpgroupturn, bpcopywhole, bpcopykind, bpdelete };
