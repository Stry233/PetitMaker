/** The Help Center's Build scenes for terrain: the brush, its width, lines, curves, shapes and the
 *  auto-trim, each drawn by the world's live tool under the pictured pointer. */
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { type CurveAnchor } from '../../../../core/base/spline';
import {
  Hand, armItem, brushArming, constrainHeld, pickTool, trimAt, ERASER, row, column, rect, CABIN, CABIN2, TREE, FLOWER, INTERIOR, COAST,
  type SceneStep, type HelpScene,
} from './common';


const terrain: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 65, y1: 100, x2: 74, y2: 103 },
  // Opens on a neighbour cell so the first click visibly arms the brush: the plate grows, the
  // name lands, and the auto-trim chip the brush carries reveals, as the real bar does.
  strip: { kind: 'tools', active: 'rect' },
  run: (_ctx, _t, form) => {
    const hand = new Hand(form);
    return [
      hand.strip(0, { capKey: 'help.fig.terrain_1', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'draw', dur: 500, on: (c) => pickTool(c, brushArming('free')) },
      // The free brush goes where the hand goes: one held stroke that turns several times, so the
      // painted trail is plainly the hand's own path and never a ruled line.
      hand.glide(65, 100, { press: false, pointer: 'mountain', dur: 500 }),
      hand.press({ dur: 160 }),
      hand.drag(66, 100, { dur: 180 }),
      hand.drag(66, 101, { dur: 180 }),
      hand.drag(68, 101, { dur: 320 }),
      hand.drag(68, 100, { dur: 180 }),
      hand.drag(69, 100, { dur: 180 }),
      // One held stroke raises a cell once; stacking the next layer is a second stroke, which
      // retraces part of the first so the stack stands on the map.
      hand.release({ dur: 350 }),
      hand.press({ dur: 160 }),
      hand.drag(68, 100, { dur: 200 }),
      hand.drag(68, 101, { dur: 200 }),
      hand.drag(67, 101, { dur: 250 }),
      hand.release({ dur: 400 }),
      // The straight line is the line tool's; the constrain key snaps its drag to horizontal,
      // vertical or 45 degrees, and the tool lays the whole row on release.
      hand.strip(3, { capKey: 'help.fig.terrain_2', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'line', dur: 220, on: (c) => pickTool(c, brushArming('line')) },
      hand.glide(65, 103, { press: false, pointer: 'mountain', dur: 450 }),
      hand.press({ dur: 160, ...constrainHeld(form, true) }),
      hand.drag(74, 103, { dur: 800 }),
      hand.release({ dur: 900, ...constrainHeld(form, false) }),
    ];
  },
};

const brushfree: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 70, y1: 99, x2: 74, y2: 105 },
  strip: { kind: 'tools', active: 'draw' },
  run: (ctx, _t, form) => {
    const { world } = ctx;
    // A standing two-layer hill, built and dressed before the brush arrives: rounded outer
    // corners and a tree on top read as ground that was already there, so the demo is plainly
    // about the fringe the brush adds at its foot, not about raising the block itself.
    world.beginStroke();
    world.paint(rect(70, 99, 74, 102), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(70, 99, 74, 102), TerrainType.Mountain, 2);
    world.commit();
    // The trim clicked once at the hill's two northern vertices rounds each outer corner.
    trimAt(ctx, 69.5, 98.5);
    trimAt(ctx, 74.5, 98.5);
    world.place(TREE, 71, 100, { elevation: 2 });
    const hand = new Hand(form);
    // One wandering stroke along the block's own foot, changing direction several times: down,
    // right, down, right, up, right. A straight fringe would read as the line tool's; this is what
    // the free brush leaves when the hand doubles back on itself.
    return [
      hand.strip(0, { capKey: 'help.fig.brushfree_1', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'draw', dur: 400, on: (c) => pickTool(c, brushArming('free')) },
      hand.glide(70, 103, { press: false, pointer: 'mountain', dur: 500 }),
      hand.press({ dur: 160 }),
      hand.drag(70, 104, { dur: 200 }),
      hand.drag(71, 104, { capKey: 'help.fig.brushfree_2', dur: 200 }),
      hand.drag(71, 105, { dur: 200 }),
      hand.drag(73, 105, { dur: 320 }),
      hand.drag(73, 104, { dur: 200 }),
      hand.drag(74, 104, { dur: 220 }),
      hand.release({ dur: 1300 }),
    ];
  },
};

const brushwidth: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 64, y1: 99, x2: 79, y2: 106 },
  strip: { kind: 'tools', active: 'draw' },
  run: (ctx, _t, form) => {
    const { world } = ctx;
    // A hill stands to the side for context; the demo itself paints nothing onto it.
    world.beginStroke();
    world.paint(rect(76, 99, 79, 102), TerrainType.Mountain, 1);
    world.commit();
    // The same short bend, laid twice: once at the slider's smallest reading, once after the
    // slider moves to 3, the wide pass beside the narrow one rather than over it. The pictured
    // slider and the brush the stroke runs read the same size at every beat.
    const [narrow, wide] = [1, 3];
    pickTool(ctx, brushArming('free', 'mountain', narrow));
    const bend = (dy: number): SceneStep[] => [
      hand.press({ dur: 160 }),
      hand.drag(67, 100 + dy, { dur: 350 }),
      hand.drag(67, 101 + dy, { dur: 150 }),
      hand.drag(68, 101 + dy, { dur: 200 }),
    ];
    const hand = new Hand(form);
    return [
      hand.glide(65, 100, { capKey: 'help.fig.brushwidth_1', stripSize: narrow, pointer: 'mountain', dur: 550 }),
      ...bend(0),
      hand.release({ dur: 700 }),
      hand.glide(65, 104, {
        capKey: 'help.fig.brushwidth_2', stripSize: wide, dur: 550,
        on: (c) => pickTool(c, brushArming('free', 'mountain', wide)),
      }),
      ...bend(4),
      hand.release({ dur: 1500 }),
    ];
  },
};

const eraseline: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 65, y1: 99, x2: 80, y2: 106 },
  strip: { kind: 'tools', active: 'erase' },
  run: ({ world }, _t, form) => {
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
    const hand = new Hand(form);
    return [
      hand.strip(1, { capKey: 'help.fig.eraseline_1', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'erase', dur: 400, on: (c) => pickTool(c, ERASER) },
      // One click peels only the top layer here, leaving a shorter notch: the eraser sculpts as
      // much as it clears.
      hand.glide(73, 104, { press: false, pointer: 'eraser', dur: 500 }),
      hand.press({ dur: 200 }),
      hand.release({ dur: 900 }),
      // The whole pass loses its top layer first, both cells at once.
      hand.glide(73, 105, { capKey: 'help.fig.eraseline_2', dur: 500 }),
      hand.press({ dur: 160 }),
      hand.drag(73, 106, { dur: 500 }),
      hand.release({ capKey: 'help.fig.eraseline_3', dur: 900 }),
      // The second pass over the same cells takes the layer under that, down to open ground.
      hand.press({ dur: 160 }),
      hand.drag(73, 105, { dur: 500 }),
      hand.release({ dur: 1300 }),
    ];
  },
};

const lineridge: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 65, y1: 99, x2: 78, y2: 104 },
  strip: { kind: 'tools', active: 'line' },
  run: ({ world }, _t, form) => {
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
    const hand = new Hand(form);
    return [
      hand.strip(3, { capKey: 'help.fig.lineridge_1', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'line', dur: 400, on: (c) => pickTool(c, brushArming('line')) },
      hand.glide(68, 101, { press: false, pointer: 'mountain', dur: 500 }),
      // One press at the near bank's foot, one drag to the far one, the constrain key holding the run
      // level. Nothing paints while the button is down: the tool's ghost promises the whole run,
      // and only the release lays it, converting the water it crosses to the same layer.
      hand.press({ dur: 160, ...constrainHeld(form, true) }),
      hand.drag(75, 101, { dur: 800 }),
      hand.release({ capKey: 'help.fig.lineridge_2', dur: 1600, ...constrainHeld(form, false) }),
    ];
  },
};

const curvebank: HelpScene = {
  stage: COAST,
  plot: { x1: 64, y1: 115, x2: 81, y2: 121 },
  strip: { kind: 'tools', active: 'curve' },
  run: (_ctx, _t, form) => {
    // Three anchors along the coastline; the path between them is the curve tool's own.
    const [a1, a2, a3] = [{ x: 64, y: 115 }, { x: 72, y: 117 }, { x: 80, y: 115 }] as [CurveAnchor, CurveAnchor, CurveAnchor];
    /** Where the reshape drags the middle anchor: seaward, so the bow is plain at a glance. */
    const moved: CurveAnchor = { x: 72, y: 120 };
    const width = 2;
    const hand = new Hand(form);
    return [
      // The pictured slider reads the width the curve is about to lay, as the live bar would.
      hand.strip(4, { capKey: 'help.fig.curvebank_1', pointer: 'clickable', stripSize: width, dur: 550 }),
      { press: true, tool: 'curve', dur: 400, on: (c) => pickTool(c, brushArming('curve', 'mountain', width)) },
      hand.glide(a1.x, a1.y, { press: false, pointer: 'mountain', dur: 500 }),
      // Click 1 drops the first anchor. Nothing is laid yet: a curve is a chain of clicks, and the
      // map holds nothing until it is finished.
      hand.press({ dur: 160 }),
      hand.release({ dur: 220 }),
      // The ghost bends through the anchors already down and wherever the pointer travels next.
      hand.hover(a2.x, a2.y, { dur: 600 }),
      hand.press({ dur: 160 }),
      hand.release({ dur: 220 }),
      hand.hover(a3.x, a3.y, { dur: 600 }),
      // The finishing double click: the first click drops the third anchor, and the second, on that
      // same cell inside the double-click window, ends the curve and lays the whole thing.
      hand.press({ dur: 130 }),
      hand.release({ dur: 130 }),
      hand.press({ capKey: 'help.fig.curvebank_2', dur: 130 }),
      hand.release({ dur: 1000 }),
      // The finished curve leaves its anchors standing as adjust handles, the live controls' own
      // grab-and-knob faces.
      { capKey: 'help.fig.curvebank_3', dur: 1100 },
      // Dragging a grab reshapes: the tool's ghost previews the path through the moved anchor while
      // the laid curve stands, and only the release lays it again, one tweak one undo step.
      hand.glide(a2.x, a2.y, { pointer: 'clickable', dur: 500 }),
      { press: true, dur: 160 },
      hand.carry(moved.x, moved.y, (c, at) => { c.world.dragAnchor(1, at, false); }, { capKey: 'help.fig.curvebank_4', dur: 700 }),
      { press: false, dur: 1600, on: (c) => { c.world.dragAnchor(1, moved, true); } },
    ];
  },
};

const rectpad: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 63, y1: 99, x2: 74, y2: 105 },
  strip: { kind: 'tools', active: 'rect' },
  run: ({ world }, _t, form) => {
    // A shoulder standing before the rect arrives, with an existing cabin to one side. The
    // shoulder's two rows below the pad are the doorstep the second cabin's door needs.
    world.place(CABIN, 63, 100);
    world.beginStroke();
    world.paint(column(74, 99, 105), TerrainType.Mountain, 1);
    world.paint(row(104, 69, 74), TerrainType.Mountain, 1);
    world.paint(row(105, 69, 74), TerrainType.Mountain, 1);
    world.commit();
    const hand = new Hand(form);
    return [
      hand.strip(5, { capKey: 'help.fig.rectpad_1', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'rect', dur: 400, on: (c) => pickTool(c, brushArming('rect')) },
      hand.glide(69, 100, { press: false, pointer: 'mountain', dur: 500 }),
      // Nothing paints while the button is down: the tool's ghost shows the rectangle between the
      // press and wherever the drag has reached.
      hand.press({ dur: 160 }),
      hand.drag(73, 103, { dur: 800 }),
      // One drag, one flat layer: the rect lands the whole platform at once.
      hand.release({ capKey: 'help.fig.rectpad_2', dur: 1400 }),
      // The second cabin, armed as its shelf card arms it, stands on the platform through the placer.
      hand.hover(71.5, 101.5, { pointer: 'place', dur: 600, on: (c) => armItem(c, CABIN2) }),
      ...hand.tap({ dur: 240 }, { dur: 1400 }),
    ];
  },
};

const circlepond: HelpScene = {
  stage: INTERIOR,
  plot: { x1: 65, y1: 99, x2: 75, y2: 106 },
  strip: { kind: 'tools', active: 'circle', surface: 'water' },
  run: ({ world }, _t, form) => {
    world.place(FLOWER, 65, 99);
    world.place(FLOWER, 75, 99);
    world.place(FLOWER, 65, 106);
    world.place(FLOWER, 75, 106);
    const center = { x: 70, y: 102 };
    const hand = new Hand(form);
    return [
      hand.strip(6, { capKey: 'help.fig.circlepond_1', pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'circle', dur: 400, on: (c) => pickTool(c, brushArming('circle', 'water')) },
      hand.glide(center.x, center.y, { press: false, pointer: 'water', dur: 500 }),
      // The constrain key holds the drag to a perfect circle. Nothing paints until release: the
      // tool's ghost grows with the drag.
      hand.press({ dur: 160, ...constrainHeld(form, true) }),
      hand.drag(center.x + 3, center.y + 3, { dur: 700 }),
      hand.release({ capKey: 'help.fig.circlepond_2', dur: 1700, ...constrainHeld(form, false) }),
    ];
  },
};

/** An L of five cells drawn corner first: down the arm, then along the foot, exactly what the
 *  autotrim demo needs to show a convex tip getting rounded. */
function trimL(x0: number, y0: number): { start: MacroCoord; corner: MacroCoord; end: MacroCoord } {
  return { start: { x: x0, y: y0 }, corner: { x: x0, y: y0 + 2 }, end: { x: x0 + 2, y: y0 + 2 } };
}

const autotrim: HelpScene = {
  // No tools strip: the pictured AutoTrim chip would read the visitor's own live setting, and this
  // scene walks the chip's own three states, one L each; the section's other figure shows the
  // chip's three faces. Each stroke is drawn by hand, corner first, and the release does the trim.
  stage: INTERIOR,
  plot: { x1: 66, y1: 99, x2: 80, y2: 101 },
  run: (ctx, _t, form) => {
    pickTool(ctx, brushArming('free'));
    const ls = [trimL(66, 99), trimL(72, 99), trimL(78, 99)];
    const modes = ['off', 'rect', 'round'] as const;
    const caps = ['help.fig.autotrim_1', 'help.fig.autotrim_2', 'help.fig.autotrim_3'] as const;
    const hand = new Hand(form);
    const steps: SceneStep[] = [];
    ls.forEach(({ start, corner, end }, i) => {
      steps.push(
        hand.glide(start.x, start.y, { capKey: caps[i]!, pointer: 'mountain', dur: i === 0 ? 650 : 500 }),
        hand.press({ dur: 160, on: ({ world: w }) => { w.autoTrim = modes[i]!; } }),
        hand.drag(corner.x, corner.y, { dur: 450 }),
        hand.drag(end.x, end.y, { dur: 450 }),
        hand.release({ dur: i === 2 ? 1700 : 700 }),
      );
    });
    return steps;
  },
};

export const BUILD_TERRAIN_SCENES: Record<string, HelpScene> = {
  terrain, brushfree, brushwidth, eraseline, lineridge, curvebank, rectpad, circlepond, autotrim,
};
