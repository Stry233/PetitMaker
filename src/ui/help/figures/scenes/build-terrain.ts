/** The Help Center's Build scenes for terrain: the brush, its width, lines, curves, shapes and the auto-trim. */
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { CORNER_INDEX } from '../../../../core/model/corners';
import { circleCells, expandLine, rectCells, splineCells } from '../../../../core/grid/shapes';
import { type CurveAnchor } from '../../../../core/base/spline';
import { SHIFT_KEYS, stroke, eraseCell, eraseStroke, row, column, rect, CABIN, CABIN2, TREE, FLOWER, INTERIOR, COAST, type SceneStep, trimCmd, type HelpScene } from './common';


const terrain: HelpScene = {
  stage: INTERIOR,
  // Opens on a neighbour cell so the first click visibly arms the brush: the plate grows, the
  // name lands, and the auto-trim chip the brush carries reveals, as the real bar does.
  strip: { kind: 'tools', active: 'rect' },
  run: () => {
    // The free brush goes where the hand goes: one held stroke that turns several times, so the
    // painted trail is plainly the hand's own path and never a ruled line.
    const wander: MacroCoord[] = [
      { x: 65, y: 100 }, { x: 66, y: 100 }, { x: 66, y: 101 }, { x: 67, y: 101 },
      { x: 68, y: 101 }, { x: 68, y: 100 }, { x: 69, y: 100 },
    ];
    // The second stroke retraces part of the first, so the stacking claim is visible on the map.
    const stack: MacroCoord[] = [
      { x: 69, y: 100 }, { x: 68, y: 100 }, { x: 68, y: 101 }, { x: 67, y: 101 },
    ];
    const line = row(103, 65, 74);
    return [
      { capKey: 'help.fig.terrain_1', move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'draw', dur: 500 },
      { press: false, move: [65, 100], pointer: 'mountain', dur: 500 },
      { press: true, dur: 160, on: ({ world }) => world.beginStroke() },
      { move: [66, 101], dur: 350, during: stroke(wander.slice(0, 3), TerrainType.Mountain, 1) },
      { move: [68, 101], dur: 320, during: stroke(wander.slice(3, 5), TerrainType.Mountain, 1) },
      { move: [69, 100], dur: 320, during: stroke(wander.slice(5, 7), TerrainType.Mountain, 1) },
      // One held stroke raises a cell once; stacking the next layer is a second stroke.
      { press: false, dur: 350, on: ({ world }) => { world.commit(); } },
      { press: true, dur: 160, on: ({ world }) => world.beginStroke() },
      { move: [68, 101], dur: 400, during: stroke(stack.slice(0, 3), TerrainType.Mountain, 2) },
      { move: [67, 101], dur: 250, during: stroke(stack.slice(3, 4), TerrainType.Mountain, 2) },
      { press: false, dur: 400, on: ({ world }) => { world.commit(); } },
      // The straight line is the line tool's; Shift snaps its drag to horizontal/vertical/45.
      { capKey: 'help.fig.terrain_2', move: { strip: 3 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'line', dur: 220 },
      { press: false, move: [65, 103], pointer: 'mountain', dur: 450 },
      { keys: SHIFT_KEYS, press: true, dur: 160, on: ({ world }) => world.beginStroke() },
      { move: [74, 103], dur: 800 },
      // The line tool lays its whole row on release.
      {
        press: false, keys: null, dur: 900,
        on: ({ world }) => { world.paint(line, TerrainType.Mountain, 1); world.commit(); },
      },
    ];
  },
};

const brushfree: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'draw' },
  run: ({ world }) => {
    // A standing two-layer hill, built and dressed before the brush arrives: rounded outer
    // corners and a tree on top read as ground that was already there, so the demo is plainly
    // about the fringe the brush adds at its foot, not about raising the block itself.
    world.beginStroke();
    world.paint(rect(70, 99, 74, 102), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(70, 99, 74, 102), TerrainType.Mountain, 2);
    world.commit();
    world.execute(trimCmd(world, 70, 99, CORNER_INDEX.TL, 1));
    world.execute(trimCmd(world, 74, 99, CORNER_INDEX.TR, 1));
    world.place(TREE, 71, 100, { elevation: 2 });
    // One wandering stroke along the block's own foot, changing direction several times: down,
    // right, down, right, right, up, right. A straight fringe would read as the line tool's; this
    // is what the free brush actually leaves when the hand doubles back on itself.
    const wiggle: MacroCoord[] = [
      { x: 70, y: 103 }, { x: 70, y: 104 }, { x: 71, y: 104 }, { x: 71, y: 105 },
      { x: 72, y: 105 }, { x: 73, y: 105 }, { x: 73, y: 104 }, { x: 74, y: 104 },
    ];
    return [
      { capKey: 'help.fig.brushfree_1', move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'draw', dur: 400 },
      { press: false, move: [wiggle[0]!.x, wiggle[0]!.y], pointer: 'mountain', dur: 500 },
      // One held stroke, several short glides: the cells paint continuously under the cursor as
      // it goes, the same drag from press to release the whole way through.
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [wiggle[1]!.x, wiggle[1]!.y], dur: 260, during: stroke(wiggle.slice(0, 2), TerrainType.Mountain, 1) },
      {
        capKey: 'help.fig.brushfree_2', move: [wiggle[3]!.x, wiggle[3]!.y], dur: 380,
        during: stroke(wiggle.slice(2, 4), TerrainType.Mountain, 1),
      },
      { move: [wiggle[6]!.x, wiggle[6]!.y], dur: 500, during: stroke(wiggle.slice(4, 7), TerrainType.Mountain, 1) },
      { move: [wiggle[7]!.x, wiggle[7]!.y], dur: 260, during: stroke(wiggle.slice(7, 8), TerrainType.Mountain, 1) },
      { press: false, dur: 1300, on: ({ world: w }) => { w.commit(); } },
    ];
  },
};

const brushwidth: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'draw' },
  run: ({ world }) => {
    // A hill stands to the side for context; the demo itself paints nothing onto it.
    world.beginStroke();
    world.paint(rect(76, 99, 79, 102), TerrainType.Mountain, 1);
    world.commit();
    // The same short bend, laid twice: once at the slider's smallest reading, once after the
    // slider is moved to 3 — the wide pass sits beside the narrow one rather than over it.
    const path: MacroCoord[] = [{ x: 65, y: 100 }, { x: 66, y: 100 }, { x: 67, y: 100 }, { x: 67, y: 101 }, { x: 68, y: 101 }];
    const path2 = path.map((p) => ({ x: p.x, y: p.y + 4 }));
    const wide = expandLine(path2, 3);
    return [
      {
        capKey: 'help.fig.brushwidth_1', stripSize: 1, move: [path[0]!.x, path[0]!.y], pointer: 'mountain', dur: 550,
      },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      {
        move: [path[path.length - 1]!.x, path[path.length - 1]!.y], dur: 700,
        during: stroke(path, TerrainType.Mountain, 1),
      },
      { press: false, dur: 700, on: ({ world: w }) => { w.commit(); } },
      // The slider moves to 3 with nothing armed; the next stroke is what carries it.
      { capKey: 'help.fig.brushwidth_2', stripSize: 3, move: [path2[0]!.x, path2[0]!.y], dur: 550 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      {
        move: [path2[path2.length - 1]!.x, path2[path2.length - 1]!.y], dur: 900,
        during: stroke(wide, TerrainType.Mountain, 1),
      },
      { press: false, dur: 1500, on: ({ world: w }) => { w.commit(); } },
    ];
  },
};

const eraseline: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'erase' },
  run: ({ world }) => {
    // A ridge dividing a cabin (west, open ground) from a pond (east, banked on every other side):
    // the ridge's own east face is the pond's west wall, and its lower cells never touch the water.
    world.beginStroke();
    world.paint(column(73, 99, 106), TerrainType.Mountain, 1);
    world.paint(row(99, 74, 80), TerrainType.Mountain, 1);
    world.paint(row(103, 74, 80), TerrainType.Mountain, 1);
    world.paint(column(80, 99, 103), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(column(73, 99, 106), TerrainType.Mountain, 2);
    world.commit();
    world.beginStroke();
    world.paint(rect(74, 100, 79, 102), TerrainType.Water, 1);
    world.commit();
    world.place(CABIN, 65, 101);
    const notch = { x: 73, y: 104 };
    const pass = [{ x: 73, y: 105 }, { x: 73, y: 106 }];
    return [
      { capKey: 'help.fig.eraseline_1', move: { strip: 1 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'erase', dur: 400 },
      { press: false, move: [notch.x, notch.y], pointer: 'eraser', dur: 500 },
      // One click peels only the top layer here, leaving a shorter notch — the eraser sculpts as
      // much as it clears.
      {
        press: true, dur: 200,
        on: ({ world: w }) => { w.beginStroke(); eraseCell(w, notch, false); w.commit(); },
      },
      { press: false, dur: 900 },
      { capKey: 'help.fig.eraseline_2', move: [pass[0]!.x, pass[0]!.y], dur: 500 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [pass[1]!.x, pass[1]!.y], dur: 500, during: eraseStroke(pass, false) },
      // The whole pass loses its top layer first, both cells at once.
      {
        press: false, capKey: 'help.fig.eraseline_3', dur: 900,
        on: ({ world: w }) => { w.commit(); },
      },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [pass[0]!.x, pass[0]!.y], dur: 500, during: eraseStroke(pass, false) },
      // The second pass over the same cells takes the layer under that, down to open ground.
      { press: false, dur: 1300, on: ({ world: w }) => { w.commit(); } },
    ];
  },
};

const lineridge: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'line' },
  run: ({ world }) => {
    // A strait between two banks: water contained on every side except where the causeway is
    // about to cross it.
    world.beginStroke();
    world.paint(rect(65, 100, 67, 103), TerrainType.Mountain, 1);
    world.paint(rect(76, 100, 78, 103), TerrainType.Mountain, 1);
    world.paint(row(99, 68, 75), TerrainType.Mountain, 1);
    world.paint(row(104, 68, 75), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(68, 100, 75, 103), TerrainType.Water, 1);
    world.commit();
    const causeway = row(101, 67, 76);
    return [
      { capKey: 'help.fig.lineridge_1', move: { strip: 3 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'line', dur: 400 },
      { press: false, move: [67, 101], pointer: 'mountain', dur: 500 },
      // One press on the near bank, one drag to the far one, Shift holding the run level. Nothing
      // paints while the button is down: the ghost promises the whole run, and only the release
      // lays it.
      { keys: SHIFT_KEYS, press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      {
        move: [76, 101], dur: 800,
        during: ({ view }, k) => { view.paintGhost(row(101, 67, Math.round(67 + (76 - 67) * k)), 'mountain'); },
      },
      // The line lands its whole run on release, converting the water it crosses to the same layer.
      {
        press: false, keys: null, capKey: 'help.fig.lineridge_2', dur: 1600,
        on: ({ world: w, view }) => { view.paintGhost(null); w.paint(causeway, TerrainType.Mountain, 1); w.commit(); },
      },
    ];
  },
};

const curvebank: HelpScene = {
  stage: COAST,
  strip: { kind: 'tools', active: 'curve' },
  run: () => {
    // Three anchors along the coastline; the path between them is the real curve planner's own
    // (`core/grid/shapes.ts:splineCells`), never hand-drawn.
    const [a1, a2, a3] = [{ x: 64, y: 115 }, { x: 72, y: 117 }, { x: 80, y: 115 }] as [CurveAnchor, CurveAnchor, CurveAnchor];
    /** Where the reshape drags the middle anchor: seaward, so the bow is plain at a glance. */
    const moved: CurveAnchor = { x: 72, y: 120 };
    const width = 2;
    return [
      // The pictured slider reads the width the curve is about to lay, as the live bar would.
      { capKey: 'help.fig.curvebank_1', move: { strip: 4 }, pointer: 'clickable', stripSize: width, dur: 550 },
      { press: true, tool: 'curve', dur: 400 },
      { press: false, move: [a1.x, a1.y], pointer: 'mountain', dur: 500 },
      // Click 1: drop the first anchor. Nothing is laid yet — a curve is a chain of clicks, and
      // the map holds nothing until it is finished.
      { press: true, dur: 160, on: ({ world }) => world.beginStroke() },
      { press: false, dur: 220 },
      // The ghost bends through the anchor already down and wherever the cursor travels to next.
      {
        move: [a2.x, a2.y], dur: 600,
        during: ({ view }, k) => {
          view.paintGhost(splineCells([a1, { x: a1.x + (a2.x - a1.x) * k, y: a1.y + (a2.y - a1.y) * k }], width), 'mountain');
        },
      },
      // Click 2: drop the second anchor.
      { press: true, dur: 160 },
      { press: false, dur: 220 },
      {
        move: [a3.x, a3.y], dur: 600,
        during: ({ view }, k) => {
          view.paintGhost(splineCells([a1, a2, { x: a2.x + (a3.x - a2.x) * k, y: a2.y + (a3.y - a2.y) * k }], width), 'mountain');
        },
      },
      // The finishing double click: the first press drops the third anchor, and the second, on
      // that same cell inside the tool's own window, ends the curve and lays the whole thing.
      { press: true, dur: 130 },
      { press: false, dur: 130 },
      { capKey: 'help.fig.curvebank_2', press: true, dur: 130 },
      {
        press: false, dur: 1000,
        on: ({ world, view }) => {
          view.paintGhost(null);
          world.paint(splineCells([a1, a2, a3], width), TerrainType.Mountain, 1);
          world.commit();
        },
      },
      // The finished curve leaves its anchors standing as adjust handles, the live controls' own
      // grab-and-knob faces.
      { capKey: 'help.fig.curvebank_3', dur: 1100, on: ({ view }) => view.curveHandles([a1, a2, a3]) },
      // Dragging a grab reshapes: the ghost previews the path through the moved anchor while the
      // laid curve stands, and only the release lays it again — one tweak, one undo step.
      { move: [a2.x, a2.y], pointer: 'clickable', dur: 500 },
      { press: true, dur: 160 },
      {
        capKey: 'help.fig.curvebank_4', move: [moved.x, moved.y], dur: 700,
        during: ({ view }, k) => {
          const mid = { x: a2.x, y: a2.y + (moved.y - a2.y) * k };
          view.curveHandles([a1, mid, a3]);
          view.paintGhost(splineCells([a1, mid, a3], width), 'mountain');
        },
      },
      {
        press: false, dur: 1600,
        on: ({ world, view }) => {
          view.paintGhost(null);
          world.undo();
          world.beginStroke();
          world.paint(splineCells([a1, moved, a3], width), TerrainType.Mountain, 1);
          world.commit();
          view.curveHandles([a1, moved, a3]);
        },
      },
    ];
  },
};

const rectpad: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'rect' },
  run: ({ world }) => {
    // An uneven shoulder standing before the rect arrives, with an existing cabin to one side. The
    // shoulder's two rows below the pad are the doorstep the second cabin's door needs.
    world.place(CABIN, 63, 100);
    world.beginStroke();
    world.paint(column(74, 99, 105), TerrainType.Mountain, 1);
    world.paint(row(104, 69, 74), TerrainType.Mountain, 1);
    world.paint(row(105, 69, 74), TerrainType.Mountain, 1);
    world.paint([{ x: 70, y: 101 }], TerrainType.Mountain, 1);
    world.commit();
    const pad = rect(69, 100, 73, 103);
    return [
      { capKey: 'help.fig.rectpad_1', move: { strip: 5 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'rect', dur: 400 },
      { press: false, move: [69, 100], pointer: 'mountain', dur: 500 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      // Nothing paints while the button is down: the ghost shows the rectangle between the
      // origin and wherever the drag has reached, real corner-to-corner cells.
      {
        move: [73, 103], dur: 800,
        during: ({ view }, k) => {
          view.paintGhost(rectCells({ x: 69, y: 100 }, { x: Math.round(69 + 4 * k), y: Math.round(100 + 3 * k) }), 'mountain');
        },
      },
      // One drag, one flat layer: the rect lands the whole platform at once, levelling what stood
      // there before.
      {
        press: false, capKey: 'help.fig.rectpad_2', dur: 1400,
        on: ({ world: w, view }) => { view.paintGhost(null); w.paint(pad, TerrainType.Mountain, 1); w.commit(); },
      },
      {
        press: true, dur: 240,
        on: ({ world: w }) => { w.place(CABIN2, 69, 100, { elevation: 1 }); },
      },
      { press: false, dur: 1400 },
    ];
  },
};

const circlepond: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'circle', surface: 'water' },
  run: ({ world }) => {
    world.place(FLOWER, 65, 99);
    world.place(FLOWER, 75, 99);
    world.place(FLOWER, 65, 106);
    world.place(FLOWER, 75, 106);
    const center = { x: 70, y: 102 };
    const pond = circleCells(center, 3, 3);
    return [
      { capKey: 'help.fig.circlepond_1', move: { strip: 6 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'circle', dur: 400 },
      { press: false, move: [center.x, center.y], pointer: 'water', dur: 500 },
      // Shift while dragging holds the drag to a perfect circle. Nothing paints until release:
      // the ghost grows with the drag, the real circle planner's own cells at the radius so far.
      { keys: SHIFT_KEYS, press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      {
        move: [center.x + 3, center.y + 3], dur: 700,
        during: ({ view }, k) => {
          const r = Math.round(3 * k);
          view.paintGhost(circleCells(center, r, r), 'water');
        },
      },
      {
        press: false, keys: null, capKey: 'help.fig.circlepond_2', dur: 1700,
        on: ({ world: w, view }) => { view.paintGhost(null); w.paint(pond, TerrainType.Water, 0); w.commit(); },
      },
    ];
  },
};

/** An L of five cells: a vertical arm and a horizontal arm sharing a corner, exactly what the
 *  autotrim demo needs to show a convex tip getting rounded. */
function trimL(x0: number, y0: number): MacroCoord[] {
  return [{ x: x0, y: y0 }, { x: x0, y: y0 + 1 }, { x: x0, y: y0 + 2 }, { x: x0 + 1, y: y0 + 2 }, { x: x0 + 2, y: y0 + 2 }];
}

const autotrim: HelpScene = {
  // No tools strip: the pictured AutoTrim chip would read the visitor's own live setting, and this
  // scene walks the chip's own three states, one L each; the section's other figure shows the
  // chip's three faces. Each stroke is drawn by hand, corner first, and the release does the trim.
  stage: INTERIOR,
  run: () => {
    const ls = [trimL(66, 99), trimL(72, 99), trimL(78, 99)];
    const modes = ['off', 'rect', 'round'] as const;
    const caps = ['help.fig.autotrim_1', 'help.fig.autotrim_2', 'help.fig.autotrim_3'] as const;
    const steps: SceneStep[] = [];
    ls.forEach((cells, i) => {
      const arm = cells.slice(0, 3);
      const foot = cells.slice(3);
      const corner = cells[2]!;
      const end = cells[cells.length - 1]!;
      steps.push(
        { capKey: caps[i]!, move: [cells[0]!.x, cells[0]!.y], pointer: 'mountain', dur: i === 0 ? 650 : 500 },
        { press: true, dur: 160, on: ({ world: w }) => { w.autoTrim = modes[i]!; w.beginStroke(); } },
        { move: [corner.x, corner.y], dur: 450, during: stroke(arm, TerrainType.Mountain, 1) },
        { move: [end.x, end.y], dur: 450, during: stroke(foot, TerrainType.Mountain, 1) },
        { press: false, dur: i === 2 ? 1700 : 700, on: ({ world: w }) => { w.commit(); } },
      );
    });
    return steps;
  },
};

export const BUILD_TERRAIN_SCENES: Record<string, HelpScene> = {
  terrain, brushfree, brushwidth, eraseline, lineridge, curvebank, rectpad, circlepond, autotrim,
};
