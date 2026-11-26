/**
 * The Help Center's scenes for saving and placing blueprints. A frame is drawn with the region brush
 * under Blueprint's own frame request, and a blueprint is captured from ground and objects the scene
 * built through real commands, armed in the blueprint tool and laid by a press of it, so the ghost,
 * the surface it lands on, what it skips and the notice it says are the editor's own.
 */
import { TerrainType } from '../../../../core/model/types';
import { wholeCellsInRegion } from '../../../../core/grid/footprint';
import type { Rect } from '../../../../core/grid/rect';
import { BLUEPRINT_FRAME_REQUEST } from '../../../../editor/editing/blueprint';
import type { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import {
  CABIN, FLOWER, Hand, INTERIOR, ROTATE_KEYS, TREE, freshSession, placeThrough, rect, sayNotice,
  type DemoCtx, type HelpScene, type SceneStep, type Stage,
} from './common';

/** The crop a pair of side-by-side figures frames: the target ground with a margin of open grass. */
const PAIR: Stage = { x1: 63, y1: 95, x2: 83, y2: 107, tile: 17 };

/** The piece every scene saves, in placement cells from its frame's top-left: a 5 by 4 frame holding
 *  a one-layer mound with a tree on its top and a flower on the grass beside it. */
const PIECE = { w: 5, h: 4 } as const;

/** Lays the piece with its frame's top-left at (x, y) through real commands: the mound, then its objects. */
function buildPiece(world: SandboxWorld, x: number, y: number): void {
  world.beginStroke();
  world.paint(rect(x + 1, y + 1, x + 3, y + 3), TerrainType.Mountain, 1);
  world.commit();
  world.beginStroke();
  world.place(TREE, x + 1, y + 1, { elevation: 1 });
  world.place(FLOWER, x + 4, y + 3);
  world.commit();
}

const pieceFrame = (x: number, y: number): Rect => ({ x, y, w: PIECE.w, h: PIECE.h });

/** The blueprint the place scenes start from: the piece built and its frame armed, as saving it and
 *  choosing its card arm it, then the piece taken back off the map, so the scene opens on the ground
 *  it places onto. */
function armSavedPiece(world: SandboxWorld): void {
  buildPiece(world, PLACE_AT.x, PLACE_AT.y);
  world.armFrame(pieceFrame(PLACE_AT.x, PLACE_AT.y));
  while (world.undo()) { /* the piece goes; the armed blueprint stays */ }
}

/** Where the place scenes lay the piece's frame, and the map point a press there aims at: the
 *  blueprint tool holds a frame by its centre cell, left of and above the middle on an even side. */
const PLACE_AT = { x: 71, y: 99 } as const;
const AIM: readonly [number, number] = [PLACE_AT.x + Math.floor((PIECE.w - 1) / 2) + 0.5, PLACE_AT.y + Math.floor((PIECE.h - 1) / 2) + 0.5];
/** Where the pointer comes in from, on the cleared ground below and left of the aim. */
const START: readonly [number, number] = [AIM[0] - 3, AIM[1] + 2.5];

/** The region brush under Blueprint's frame request, as New blueprint opens it, drawn through the
 *  view's region wash. */
function armFrameBrush({ world, view }: DemoCtx): void {
  world.selectRegion({ tool: 'rect', request: BLUEPRINT_FRAME_REQUEST, show: (cells) => view.region(cells.length ? [...cells] : null) });
}

/** A rectangle dragged from terrain cell `from` to `to`, the drag ending just inside the far cell's
 *  corner as a hand does. */
function frameDrag(hand: Hand, from: readonly [number, number], to: readonly [number, number], first: SceneStep): SceneStep[] {
  return [
    hand.hover(from[0], from[1], { pointer: 'marquee', dur: 600, ...first, on: (c) => { first.on?.(c); armFrameBrush(c); } }),
    hand.press({ dur: 160 }),
    hand.drag(to[0] + 0.45, to[1] + 0.45, { dur: 900 }),
    hand.release({ dur: 500 }),
  ];
}

/** Done on the frame step and Save on the save panel, then the new card picked: the frame the brush
 *  drew is captured and armed. */
function saveFramed({ world, view }: DemoCtx): void {
  const frame = wholeCellsInRegion(world.region);
  world.endRegionSelection();
  view.region(null);
  if (frame) world.armFrame(frame);
}

/** The overview's crop: room for a piece, the house beside it and a copy of the piece. */
const WIDE: Stage = { x1: 61, y1: 95, x2: 88, y2: 109, tile: 15 };

/** Frame a piece with a house across the frame's edge, save it and place it again: the copy brings
 *  the mound, the tree and the flower, and the house stays behind. */
const bploop: HelpScene = {
  stage: WIDE,
  plot: { x1: 62, y1: 99, x2: 81, y2: 105 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    const { world } = ctx;
    buildPiece(world, 63, 99);
    world.beginStroke();
    world.place(CABIN, 68, 99);
    world.commit();
    const hand = new Hand(form);
    return [
      ...frameDrag(hand, [63, 99], [70, 103], { capKey: 'help.blueprint.fig_frame' }),
      { capKey: 'help.blueprint.fig_save', dur: 1300, on: saveFramed },
      ...placeThrough(hand, form, [[77.5, 101.5, { capKey: 'help.blueprint.fig_place', pointer: 'place', dur: 1200 }]], { dur: 200 }, {
        capKey: 'help.blueprint.fig_left', pointer: 'move', dur: 2200,
      }),
    ];
  },
};

/** Save as blueprint on the selection card frames the selection with its ground; a drag reframes it. */
const bpsavesel: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 66, y1: 98, x2: 75, y2: 104 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    buildPiece(ctx.world, 68, 99);
    const onMap = new Hand(form, true);
    const hand = new Hand(form);
    return [
      onMap.glide(69.5, 100.5, { capKey: 'help.bpsave.fig_select', pointer: 'select', dur: 800 }),
      ...onMap.tap({ dur: 160 }, { dur: 600 }),
      onMap.control('handle-save-blueprint', { capKey: 'help.bpsave.fig_save_as', dur: 700 }),
      { press: true, dur: 200 },
      { press: false, capKey: 'help.bpsave.fig_framed', dur: 1800, on: ({ world, view }) => { world.frameSelection((cells) => view.region(cells.length ? [...cells] : null)); } },
      hand.hover(68, 99, { capKey: 'help.bpsave.fig_reframe', pointer: 'marquee', dur: 700 }),
      hand.press({ dur: 160 }),
      hand.drag(73.45, 103.45, { dur: 900 }),
      hand.release({ dur: 1600, on: ({ world }) => { world.endRegionSelection(); } }),
    ];
  },
};

/** New blueprint's frame: one rectangle over the piece, then Done. */
const bpframe: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 66, y1: 98, x2: 75, y2: 104 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    buildPiece(ctx.world, 68, 99);
    const hand = new Hand(form);
    return [
      ...frameDrag(hand, [68, 99], [73, 103], { capKey: 'help.bpsave.fig_frame' }),
      // Done ends the frame step with the frame still drawn, and the loop's rewind reaches the map.
      { capKey: 'help.bpsave.fig_done', dur: 1800, on: ({ world }) => { world.endRegionSelection(); } },
    ];
  },
};

/** A press with the blueprint armed lays it once and puts it down. */
const bpplace: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 69, y1: 98, x2: 77, y2: 104 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    armSavedPiece(ctx.world);
    const hand = new Hand(form);
    return [
      hand.glide(START[0], START[1], { capKey: 'help.bpplace.fig_pick', pointer: 'place', dur: 700 }),
      ...placeThrough(hand, form, [[AIM[0], AIM[1], { dur: 1000 }]], { dur: 200 }, { capKey: 'help.bpplace.fig_once', pointer: 'move', dur: 1900 }),
    ];
  },
};

/** The same blueprint laid on flat grass and on a raised plain: its ground follows the surface. */
function surfaceScene(raised: boolean): HelpScene {
  return {
    stage: PAIR,
    plot: { x1: 69, y1: 98, x2: 77, y2: 104 },
    run: (ctx, _t, form) => {
      freshSession(ctx);
      armSavedPiece(ctx.world);
      if (raised) {
        ctx.world.beginStroke();
        ctx.world.paint(rect(69, 98, 77, 104), TerrainType.Mountain, 1);
        ctx.world.commit();
      }
      const hand = new Hand(form);
      return [
        hand.glide(START[0], START[1], { pointer: 'place', dur: 500 }),
        ...placeThrough(hand, form, [[AIM[0], AIM[1], { dur: 900 }]], { dur: 200 }, { pointer: 'move', dur: 2000 }),
      ];
    },
  };
}

/** A tree standing where the blueprint's mound and tree go: the ghost marks those parts, the press
 *  skips them, and the notice counts them. */
const bpskip: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 69, y1: 98, x2: 77, y2: 104 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    armSavedPiece(ctx.world);
    ctx.world.beginStroke();
    ctx.world.place(TREE, PLACE_AT.x + 2, PLACE_AT.y + 2);
    ctx.world.commit();
    const hand = new Hand(form);
    return [
      hand.glide(START[0], START[1], { pointer: 'place', dur: 500 }),
      // A mouse holds still at the aim so the marks on its preview stand before the press; a finger
      // has no preview before it lands.
      ...placeThrough(hand, form, form.touch
        ? [[AIM[0], AIM[1], { dur: 1000 }]]
        : [[AIM[0], AIM[1], { capKey: 'help.bpplace.fig_marked', dur: 1000 }], [AIM[0], AIM[1] + 0.01, { dur: 1300 }]], { dur: 200 }, {
        capKey: 'help.bpplace.fig_counted', pointer: 'move', dur: 2200, on: sayNotice,
      }),
      { toastKey: null, dur: 300 },
    ];
  },
};

/** E turns the armed blueprint a quarter before it is laid. A finger has no key, so the figure is
 *  the mouse's (`HelpFigure.form`). */
const bpturn: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 69, y1: 97, x2: 77, y2: 105 },
  run: (ctx, _t, form) => {
    freshSession(ctx);
    armSavedPiece(ctx.world);
    const hand = new Hand(form);
    return [
      hand.glide(START[0], START[1], { capKey: 'help.bpplace.fig_turn', pointer: 'place', dur: 500 }),
      hand.hover(AIM[0], AIM[1], { dur: 1000 }),
      { dur: 700 },
      // The live pointer re-samples on a turn, so the preview turns where it stands.
      { keys: ROTATE_KEYS, dur: 1200, on: ({ world }) => { world.turnArmedBlueprint(90); world.pointerMove({ x: AIM[0], y: AIM[1] }); } },
      { keys: null, dur: 400 },
      ...hand.tap({ dur: 200 }, { pointer: 'move', dur: 1800 }),
    ];
  },
};

export const BLUEPRINT_SCENES: Record<string, HelpScene> = {
  bploop, bpframe, bpsavesel, bpplace, bpflat: surfaceScene(false), bpraised: surfaceScene(true), bpskip, bpturn,
};
