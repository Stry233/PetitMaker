/** The Help Center's Getting started scenes. */
import { removeObjectCommand } from '../../../../core/model/command-build';
import { TerrainType } from '../../../../core/model/types';
import { PAN_HOLD_KEYS, row, CABIN, CABIN2, TREE, FLOWER, COAST, PLAZA_EDGE, type HelpScene } from './common';


const welcome: HelpScene = {
  stage: COAST,
  strip: { kind: 'shelf', items: [CABIN2, FLOWER] },
  run: ({ world, view }) => {
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
    const from = { x: 66, y: 116 };
    const to = { x: 62, y: 120 };
    return [
      // The editor's own move gesture: a click selects, and only a drag on the selected object
      // moves it (a drag from anywhere else pans). The open hand shows over the selection.
      { capKey: 'help.fig.welcome_1', move: [from.x, from.y], pointer: 'select', dur: 650 },
      { press: true, dur: 180, on: () => { view.selection(from.x, from.y, 1, 1); } },
      { press: false, pointer: 'hand-open', dur: 400 },
      {
        press: true, pointer: 'hand-closed', dur: 240,
        on: ({ world: w }) => {
          const tree = w.objectAt(TREE, from.x, from.y);
          if (tree) { view.poof(tree.id); w.execute(removeObjectCommand(tree)); }
          view.clearSelection();
        },
      },
      {
        move: [to.x, to.y], dur: 800,
        during: (_ctx, k) => {
          view.groupGhost([{ catalogId: TREE, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, rotation: 0, elevation: 0 }]);
        },
      },
      {
        press: false, pointer: 'select', dur: 500,
        on: ({ world: w }) => {
          view.clearGhost();
          w.place(TREE, to.x, to.y, { plop: view.plop });
          view.selection(to.x, to.y, 1, 1);
        },
      },
      {
        capKey: 'help.fig.welcome_2', move: { strip: 0 }, pointer: 'clickable', dur: 650,
        on: () => { view.clearSelection(); },
      },
      { press: true, strip: 0, follow: { catalogId: CABIN2 }, dur: 240 },
      { press: false, pointer: 'place', move: [65.5, 114.5], dur: 900 },
      {
        press: true, follow: null, strip: null, dur: 240,
        on: ({ world: w }) => { w.place(CABIN2, 65, 114, { plop: view.plop }); },
      },
      { press: false, capKey: 'help.fig.welcome_3', checklist: true, dur: 2200 },
    ];
  },
};

const camera: HelpScene = {
  stage: PLAZA_EDGE,
  run: ({ world }) => {
    world.beginStroke();
    world.paint(row(94, 76, 78), TerrainType.Mountain, 1);
    world.paint(row(95, 76, 78), TerrainType.Mountain, 1);
    world.paint([{ x: 77, y: 94 }], TerrainType.Mountain, 2);
    world.commit();
    world.place(CABIN, 86, 92);
    world.place(TREE, 81, 96);
    return [
      // A drag-pan carries the map with the hand: the camera shifts by exactly the pointer's own
      // travel, opposite sign, so the grabbed cell stays under the pointer the whole way. The live
      // pan cursor is `move` (the hands belong to grabbing objects; see cursor-controller.ts).
      { capKey: 'help.fig.camera_1', move: [81, 92], dur: 500 },
      { press: true, pointer: 'move', dur: 150 },
      { move: [85, 94], cam: { dx: -4, dy: -2 }, dur: 800 },
      { press: false, pointer: 'select', dur: 300 },
      // The zoom anchors where the pointer stands; the demo camera zooms about the view's centre,
      // so the pointer walks there first and the caption's claim is what the frame shows.
      { capKey: 'help.fig.camera_2', move: [80, 90.5], dur: 400 },
      { cam: { z: 1.35 }, dur: 550 },
      { cam: { z: 1 }, dur: 550 },
      { keys: PAN_HOLD_KEYS, capKey: 'help.fig.camera_3', move: [85, 94], dur: 400 },
      { press: true, pointer: 'move', dur: 150 },
      { move: [81, 92], cam: { dx: 0, dy: 0 }, dur: 700 },
      { press: false, keys: null, pointer: 'select', dur: 700 },
    ];
  },
};


export const START_SCENES: Record<string, HelpScene> = { welcome, camera };
