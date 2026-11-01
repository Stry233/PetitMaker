/** The Help Center's Getting started scenes. */
import { TerrainType } from '../../../../core/model/types';
import {
  Hand, PAN_HOLD_KEYS, armItem, freshSession, placeThrough, row, CABIN, CABIN2, TREE, FLOWER, COAST, PLAZA_EDGE, type HelpScene, type SceneStep,
} from './common';
import { MOUSE_FORM } from './build-objects';


const welcome: HelpScene = {
  stage: COAST,
  plot: { x1: 61, y1: 114, x2: 78, y2: 122 },
  strip: { kind: 'shelf', items: [CABIN2, FLOWER] },
  run: (ctx, _t, form = MOUSE_FORM) => {
    freshSession(ctx);
    const { world } = ctx;
    // A corner someone has already lived in: the demo starts from a standing build, rearranges it,
    // and ends on the list the game rebuilds it from — the project's whole story in one loop.
    world.beginStroke();
    world.paint(row(115, 61, 64), TerrainType.Mountain, 1);
    world.paint(row(116, 61, 64), TerrainType.Mountain, 1);
    world.commit();
    world.place(CABIN, 72, 115);
    world.place(TREE, 66, 116);
    world.place(TREE, 68, 120);
    world.place(TREE, 78, 121);
    world.place(FLOWER, 67, 122);
    world.place(FLOWER, 77, 119);
    const hand = new Hand(form, true);
    return [
      // The editor's own move gesture: a click selects, and only a drag on the selected object
      // moves it (a drag from anywhere else pans). The open hand shows over the selection.
      hand.glide(66.5, 116.5, { capKey: 'help.fig.welcome_1', pointer: 'select', dur: 650 }),
      ...hand.tap({ dur: 180 }, { pointer: 'hand-open', dur: 400 }),
      // The map's own drag session moves the selected tree: a preview on each move, one undo step on release.
      hand.press({ pointer: 'hand-closed', dur: 240 }),
      hand.drag(62.5, 120.5, { dur: 800 }),
      hand.release({ pointer: 'select', dur: 500 }),
      hand.strip(0, { capKey: 'help.fig.welcome_2', pointer: 'clickable', dur: 650 }),
      { press: true, strip: 0, dur: 240, on: (c) => armItem(c, CABIN2) },
      // The cabin is one per map, so placing it puts its card down (EDIT-52).
      ...placeThrough(hand, form, [[67.5, 115.5, { press: false, pointer: 'place', dur: 900 }]], { dur: 240 }, {
        strip: null, capKey: 'help.fig.welcome_3', checklist: true, dur: 2200,
      }),
    ];
  },
};

const camera: HelpScene = {
  stage: PLAZA_EDGE,
  run: ({ world }, _t, form = MOUSE_FORM) => {
    world.beginStroke();
    world.paint(row(94, 76, 78), TerrainType.Mountain, 1);
    world.paint(row(95, 76, 78), TerrainType.Mountain, 1);
    world.paint([{ x: 77, y: 94 }], TerrainType.Mountain, 2);
    world.commit();
    world.place(CABIN, 86, 92);
    world.place(TREE, 81, 96);
    // The zoom anchors where the pointer stands; the demo camera zooms about the view's centre,
    // so the pointer walks there first and the caption's claim is what the frame shows. A touch
    // reader pinches there instead of turning the wheel.
    const zoom: SceneStep[] = form.touch
      ? [
        { capKey: 'help.fig.camera_2', move: [79.2, 90], second: [80.8, 91], dur: 400 },
        { press: true, dur: 120 },
        { move: [77.6, 89], second: [82.4, 92], cam: { z: 1.35 }, dur: 550 },
        { move: [79.2, 90], second: [80.8, 91], cam: { z: 1 }, dur: 550 },
        { press: false, second: null, pointer: 'select', dur: 200 },
      ]
      : [
        { capKey: 'help.fig.camera_2', move: [80, 90.5], dur: 400 },
        { cam: { z: 1.35 }, dur: 550 },
        { cam: { z: 1 }, dur: 550 },
      ];
    // Under a tool, a mouse reader holds the pan key and a touch reader drags with two fingers.
    const toolPan: SceneStep[] = form.touch
      ? [
        { capKey: 'help.fig.camera_3', move: [85, 94], second: [86.6, 94], dur: 400 },
        { press: true, pointer: 'move', dur: 150 },
        { move: [81, 92], second: [82.6, 92], cam: { dx: 0, dy: 0 }, dur: 700 },
        { press: false, second: null, pointer: 'select', dur: 700 },
      ]
      : [
        { keys: PAN_HOLD_KEYS, capKey: 'help.fig.camera_3', move: [85, 94], dur: 400 },
        { press: true, pointer: 'move', dur: 150 },
        { move: [81, 92], cam: { dx: 0, dy: 0 }, dur: 700 },
        { press: false, keys: null, pointer: 'select', dur: 700 },
      ];
    return [
      // A drag-pan carries the map with the hand: the camera shifts by exactly the pointer's own
      // travel, opposite sign, so the grabbed cell stays under the pointer the whole way. The live
      // pan cursor is `move` (the hands belong to grabbing objects; see cursor-controller.ts). With
      // nothing armed, one finger pans the same way (EDIT-45).
      { capKey: 'help.fig.camera_1', move: [81, 92], dur: 500 },
      { press: true, pointer: 'move', dur: 150 },
      { move: [85, 94], cam: { dx: -4, dy: -2 }, dur: 800 },
      { press: false, pointer: 'select', dur: 300 },
      ...zoom,
      ...toolPan,
    ];
  },
};


export const START_SCENES: Record<string, HelpScene> = { welcome, camera };
