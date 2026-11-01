/** The Help Center's Plan scenes: notes, zones, routes, measurements, undo and the load limit. Every
 *  note is laid by the world's live notes tool under the pictured pointer. */
import type { MacroCoord } from '../../../../core/model/types';
import { ANNOTATION_COLORS } from '../../../../config/annotation-palette';
import { DEFAULT_TAG } from '../../../../config/annotation-tags';
import type { NoteTag } from '../../../../core/model/annotations';
import { ToolType } from '../../../../state/editing/vocabulary';
import type { ToolArming } from '../../../../state/editing/arming';
import type { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { Hand, UNDO_KEYS, CTRL_KEYS, CABIN, CABIN2, TREE, FLOWER, INTERIOR, type Stage, type HelpScene, type SceneStep } from './common';
import { MOUSE_FORM } from './build-objects';
import { brushArming, pickTool } from './common';


/** The plan-notes stage: wide, because annotation ink scales with the map, at a cell size that
 *  keeps one or two notes readable without filling the frame. */
const NOTES_STAGE: Stage = { x1: 50, y1: 92, x2: 104, y2: 118, tile: 8 };

/** The cells the route scene clears for the cabin it places at (78, 100), its doorstep included;
 *  the rows above it hold raised ground (layer 2 at x 82) that the clear keeps. */
const NOTES_PLOT = { x1: 76, y1: 100, x2: 82, y2: 105 };

/** The notes tool with `patch` armed, as the notes bar arms it. */
const notesArming = (patch: Partial<ToolArming>): Partial<ToolArming> => ({ tool: ToolType.Annotate, ...patch });

/** The zone brush, freehand at three cells, captions small. */
const ZONE_BRUSH = notesArming({ annotationTool: 'zone', annotationZoneShape: 'free', brushSize: 3, annotationSize: 's' });

/** A route in `color`, dashed as the bar arms a new one. */
const routeArming = (color: string) => notesArming({ annotationTool: 'route', annotationColor: color });

/** The centre of whole cell (x, y), where a note step lands on the cell itself. */
const cell = (x: number, y: number): MacroCoord => ({ x: x + 0.5, y: y + 0.5 });

/** A zone over whole cells `from` to `to`, dragged with the notes tool's rectangle and kept with
 *  Done, for a map that stands with notes before its scene begins. */
function layZone(world: SandboxWorld, from: MacroCoord, to: MacroCoord, look: { color: string; tag: NoteTag }): void {
  world.pick(notesArming({ annotationTool: 'zone', annotationZoneShape: 'rect', annotationColor: look.color, annotationTag: look.tag, annotationSize: 's' }));
  world.pointerDown(cell(from.x, from.y));
  world.pointerMove(cell(to.x, to.y));
  world.pointerUp(cell(to.x, to.y));
  world.doneNotes();
}

/** A press of the selection verb on open ground at `p`, which leaves no note selected. */
function selectNothing(world: SandboxWorld, p: MacroCoord): void {
  world.pick(notesArming({ annotationTool: 'none' }));
  world.click(p);
}

/** One undo: the undo key for a mouse reader, a two-finger tap at `at` for a touch reader (EDIT-44). */
function undoBeat(touch: boolean, at: readonly [number, number], extra: SceneStep, dur: number): SceneStep[] {
  const on: SceneStep['on'] = ({ world }) => { world.undo(); };
  if (!touch) return [{ ...extra, keys: UNDO_KEYS, dur, on }];
  return [
    { ...extra, move: [at[0], at[1]], second: [at[0] + 1.6, at[1]], dur: 350 },
    { press: true, dur: 140, on },
    { press: false, second: null, dur: Math.max(200, dur - 490) },
  ];
}

const notes: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world }, _t, form) => {
    world.place(CABIN, 78, 100);
    world.place(TREE, 66, 110);
    world.pick(notesArming({ annotationTool: 'zone', annotationZoneShape: 'rect', annotationSize: 's' }));
    const hand = new Hand(form);
    const from = cell(56, 96), to = cell(69, 103);
    return [
      hand.hover(from.x, from.y, { capKey: 'help.fig.notes_1', pointer: 'place', dur: 450 }),
      hand.press({ dur: 160 }),
      hand.drag(to.x, to.y, { dur: 650 }),
      hand.release({ dur: 350 }),
      // Done on the notes bar keeps the draft as the zone.
      { dur: 350, on: ({ world: w }) => { w.doneNotes(); } },
      hand.hover(70, 108, { capKey: 'help.fig.notes_2', dur: 500, on: ({ world: w }) => w.pick(routeArming(ANNOTATION_COLORS[5]!)) }),
      hand.press({ dur: 160 }),
      hand.drag(80, 105, { dur: 450 }),
      hand.drag(90, 109, { dur: 450 }),
      hand.release({ dur: 1500 }),
      { dur: 300 },
    ];
  },
};

const undo: HelpScene = {
  // A tight crop: the subject is one cell climbing four layers, which reads only up close.
  stage: { x1: 67, y1: 96, x2: 80, y2: 105, tile: 26 },
  run: (_ctx, _t, form = MOUSE_FORM) => {
    const hand = new Hand(form);
    return [
      // Layer 4 picked in the layer panel: one click fills the bare cell up to it, every layer in
      // the one stroke.
      hand.hover(73, 101, {
        capKey: 'help.fig.undo_1', pointer: 'mountain', dur: 500,
        on: (c) => pickTool(c, { ...brushArming('free'), floor: 4, layerPinned: true }),
      }),
      hand.press({ dur: 1100 }),
      hand.release({ realToast: true, capKey: 'help.fig.undo_2', dur: 1400 }),
      // A touch reader undoes with a two-finger tap (EDIT-44).
      ...undoBeat(form.touch, [73, 103.5], { toastKey: null, capKey: 'help.fig.undo_3' }, 1100),
      // A short rebuild closes the loop on a standing stack: the settled end state (the still
      // frame, and every loop's reset beat) must not be an empty map. At the editor's own floor
      // each click raises the cell one layer, one stroke each.
      hand.hover(73, 101, { keys: null, capKey: null, dur: 300, on: (c) => pickTool(c, brushArming('free')) }),
      hand.press({ dur: 160 }),
      hand.release({ dur: 340 }),
      hand.press({ dur: 160 }),
      hand.release({ dur: 700 }),
    ];
  },
};

const load: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    // The cluster sits inside one 16-cell chunk (x 64..79, y 96..111), so the disc reads it whole.
    world.place(CABIN, 65, 97);
    world.place(CABIN2, 71, 97);
    world.place(TREE, 66, 103);
    world.place(TREE, 69, 104);
    world.place(FLOWER, 72, 103);
    return [
      // The live meter reads the region under the pointer and steps to a new region's over its own
      // transition.
      { capKey: 'help.fig.load_1', move: [67, 99], dur: 800, on: () => { view.loadMeter(true); } },
      { dur: 700 },
      { capKey: 'help.fig.load_2', move: [83, 107], dur: 800 },
      { dur: 700 },
      // Off the map entirely: the pointer drops below the crop, and the reading holds.
      { capKey: 'help.fig.load_3', move: [85, 111.5], dur: 700 },
      { dur: 1200 },
    ];
  },
};



const notetext: HelpScene = {
  stage: NOTES_STAGE,
  notesOnly: true,
  run: ({ world }, _t, form) => {
    const chip = (tag: NoteTag, size: ToolArming['annotationSize'], color: string) =>
      notesArming({ annotationTool: 'chip', annotationTag: tag, annotationSize: size, annotationColor: color });
    world.pick(chip('landmark', 'm', ANNOTATION_COLORS[0]!));
    const hand = new Hand(form);
    return [
      hand.hover(62, 98, { capKey: 'help.fig.notetext_1', pointer: 'place', dur: 550 }),
      hand.press({ dur: 200 }),
      hand.release({ dur: 900 }),
      hand.hover(85, 108, { capKey: 'help.fig.notetext_2', dur: 600, on: ({ world: w }) => w.pick(chip('entrance', 's', ANNOTATION_COLORS[2]!)) }),
      hand.press({ dur: 200 }),
      hand.release({ dur: 1800 }),
    ];
  },
};


const notezone: HelpScene = {
  stage: NOTES_STAGE,
  notesOnly: true,
  run: ({ world }, _t, form) => {
    world.pick(ZONE_BRUSH);
    const hand = new Hand(form);
    return [
      hand.hover(57.5, 97.5, { capKey: 'help.fig.notezone_1', pointer: 'place', dur: 450 }),
      hand.press({ dur: 160 }),
      hand.drag(72.5, 97.5, { dur: 650 }),
      hand.release({ dur: 500 }),
      // A stroke on open ground grows the standing draft rather than starting a zone of its own.
      hand.hover(57.5, 98.5, { capKey: 'help.fig.notezone_2', dur: 400 }),
      hand.press({ dur: 160 }),
      hand.drag(57.5, 108.5, { dur: 650 }),
      hand.release({ dur: 500 }),
      { capKey: 'help.fig.notezone_3', dur: 1400, on: ({ world: w }) => { w.doneNotes(); } },
    ];
  },
};

const notegrow: HelpScene = {
  stage: NOTES_STAGE,
  notesOnly: true,
  run: ({ world }, _t, form) => {
    layZone(world, { x: 58, y: 96 }, { x: 67, y: 101 }, { color: ANNOTATION_COLORS[0]!, tag: DEFAULT_TAG });
    selectNothing(world, cell(80, 110));
    world.pick(ZONE_BRUSH);
    const hand = new Hand(form);
    // A stroke down from inside the zone hangs a leg on it; the eraser then takes the right end
    // of the top back, so the L reads as the zone's new shape.
    return [
      hand.hover(61.5, 100.5, { capKey: 'help.fig.notegrow_1', pointer: 'place', dur: 450 }),
      hand.press({ dur: 160 }),
      hand.drag(61.5, 110.5, { dur: 650 }),
      hand.release({ dur: 600 }),
      hand.hover(67.5, 96.5, {
        capKey: 'help.fig.notegrow_2', pointer: 'eraser', dur: 450,
        on: ({ world: w }) => w.pick(notesArming({ annotationTool: 'erase', eraserShape: 'free', brushSize: 3 })),
      }),
      hand.press({ dur: 160 }),
      hand.drag(67.5, 101.5, { dur: 600 }),
      hand.release({ dur: 600 }),
      hand.hover(61.5, 104.5, { capKey: 'help.fig.notegrow_3', pointer: 'place', dur: 450, on: ({ world: w }) => w.pick(ZONE_BRUSH) }),
      hand.press({ dur: 140 }),
      hand.release({ dur: 1200 }),
    ];
  },
};

const measurement: HelpScene = {
  stage: NOTES_STAGE,
  notesOnly: true,
  run: ({ world }, _t, form) => {
    world.pick(notesArming({ annotationTool: 'measure' }));
    const hand = new Hand(form);
    const from = cell(59, 104), to = cell(78, 104), reach = cell(88, 104);
    /** The measurement the drag laid, selected as the tool leaves it. */
    let id = '';
    return [
      hand.hover(from.x, from.y, { capKey: 'help.fig.measure_1', keys: [{ kind: 'cmd', id: 'tool.measure' }], pointer: 'place', dur: 450 }),
      hand.press({ dur: 160 }),
      hand.drag(to.x, to.y, { dur: 1000 }),
      hand.release({ keys: null, dur: 1500, on: ({ world: w }) => { id = w.annotationSelection[0] ?? ''; } }),
      // Flip on the note card.
      { capKey: 'help.fig.measure_2', dur: 1800, on: ({ world: w }) => w.flipNotes([id]) },
      // The far end's handle stands on its cell; dragging it re-lays that end along the measurement.
      hand.glide(to.x, to.y, { capKey: 'help.fig.measure_3', pointer: 'select', dur: 450 }),
      { press: true, dur: 160 },
      hand.carry(reach.x, reach.y, ({ world: w }, at) => w.dragMeasureEnd(id, 1, at), { dur: 1000 }),
      { press: false, dur: 1600, on: ({ world: w }) => w.dragMeasureEnd(id, 1, reach, true) },
    ];
  },
};

const noteroute: HelpScene = {
  stage: NOTES_STAGE,
  plot: NOTES_PLOT,
  run: ({ world }, _t, form) => {
    world.place(CABIN, 78, 100);
    world.pick(routeArming(ANNOTATION_COLORS[5]!));
    const hand = new Hand(form);
    return [
      hand.hover(58, 110, { capKey: 'help.fig.noteroute_1', pointer: 'place', dur: 450 }),
      hand.press({ dur: 160 }),
      hand.drag(72, 104, { dur: 500 }),
      hand.drag(88, 110, { dur: 500 }),
      // The release keeps the route selected with the curve brush's adjust handles on its anchors.
      hand.release({ capKey: 'help.fig.noteroute_2', dur: 1500 }),
      { dur: 400 },
    ];
  },
};

const noteselect: HelpScene = {
  stage: NOTES_STAGE,
  notesOnly: true,
  run: ({ world }, _t, form) => {
    layZone(world, { x: 56, y: 95 }, { x: 65, y: 100 }, { color: ANNOTATION_COLORS[0]!, tag: DEFAULT_TAG });
    layZone(world, { x: 76, y: 106 }, { x: 86, y: 112 }, { color: ANNOTATION_COLORS[5]!, tag: 'farm' });
    world.pick(notesArming({ annotationTool: 'chip', annotationTag: 'plaza', annotationSize: 's', annotationColor: ANNOTATION_COLORS[2]! }));
    world.click({ x: 88, y: 97 });
    selectNothing(world, { x: 70, y: 103 });
    const hand = new Hand(form);
    // Ctrl toggles a note into the set; in touch mode Multi-select does, latched on the bar.
    const multi = (on: boolean): SceneStep => ({
      ...(form.touch ? {} : { keys: on ? CTRL_KEYS : null }),
      on: ({ world: w }) => { w.held.multiSelect = on; },
    });
    return [
      hand.hover(60, 97, { capKey: 'help.fig.noteselect_1', pointer: 'select', dur: 450 }),
      hand.press({ dur: 140 }),
      hand.release({ dur: 600 }),
      // Only a note selected before the press moves; the drag takes it by the pointer's travel.
      hand.press({ capKey: 'help.fig.noteselect_2', dur: 160 }),
      hand.drag(60, 104, { dur: 600 }),
      hand.release({ dur: 600 }),
      hand.hover(80, 109, { ...multi(true), capKey: 'help.fig.noteselect_3', dur: 500 }),
      hand.press({ dur: 140 }),
      hand.release({ dur: 1200 }),
      { ...multi(false), dur: 200 },
    ];
  },
};


export const PLAN_SCENES: Record<string, HelpScene> = { notes, undo, load, notetext, notezone, notegrow, measurement, noteroute, noteselect };
