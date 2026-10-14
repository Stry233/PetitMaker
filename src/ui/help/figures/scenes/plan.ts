/** The Help Center's Plan scenes: notes, zones, routes, measurements, undo and the load limit. */
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { fitRoutePath } from '../../../../core/model/annotation/route-fit';
import { addZoneCells, generateAnnotationId, nextZoneNumber, removeZoneCells, type MapAnnotation, type ZoneNote, type RouteNote, type ChipNote } from '../../../../core/model/annotations';
import { ANNOTATION_COLORS } from '../../../../config/annotation-palette';
import { DEFAULT_TAG } from '../../../../config/annotation-tags';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { resizeMeasurement } from '../../../../core/model/annotation/dimensions';
import type { MeasureNote } from '../../../../core/model/annotations';
import { UNDO_KEYS, CTRL_KEYS, rect, chunkFill, CABIN, CABIN2, TREE, FLOWER, INTERIOR, type Stage, type HelpScene } from './common';


/** The plan-notes stage: wide, because annotation ink scales with the map, at a cell size that
 *  keeps one or two notes readable without filling the frame. */
const NOTES_STAGE: Stage = { x1: 50, y1: 92, x2: 104, y2: 118, tile: 8 };

/** Zone cells within `r` of the segment from `a` to `b`, ordered along it, so a stroke reveals
 *  them in the order the brush would lay them. */
function bandCells(a: [number, number], b: [number, number], r: number): MacroCoord[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const out: Array<{ c: MacroCoord; t: number }> = [];
  for (let y = Math.floor(Math.min(a[1], b[1]) - r); y <= Math.ceil(Math.max(a[1], b[1]) + r); y++) {
    for (let x = Math.floor(Math.min(a[0], b[0]) - r); x <= Math.ceil(Math.max(a[0], b[0]) + r); x++) {
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
      if (Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)) <= r) out.push({ c: { x, y }, t });
    }
  }
  out.sort((p, q) => p.t - q.t);
  return out.map((p) => p.c);
}

/** The first `k` share of `cells`, at least one. */
const reveal = (cells: MacroCoord[], k: number): MacroCoord[] => cells.slice(0, Math.max(1, Math.ceil(cells.length * k)));

/** Points every `step` along the segment from `a` to `b`, the way a dragged pointer reports. */
function sampled(a: [number, number], b: [number, number], step = 0.5): MacroCoord[] {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  const out: MacroCoord[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: a[0] + (b[0] - a[0]) * i / n, y: a[1] + (b[1] - a[1]) * i / n });
  return out;
}

/** Replace a note in the world the way the slice does: a new object, so the layer redraws it. */
function replaceNote(world: SandboxWorld, id: string, patch: Partial<MapAnnotation>): void {
  const items = world.state.annotations!.items;
  const i = items.findIndex((n) => n.id === id);
  if (i >= 0) items[i] = { ...items[i]!, ...patch } as MapAnnotation;
}

const notes: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world, view }) => {
    world.place(CABIN, 78, 100);
    world.place(TREE, 66, 110);
    const zoneCells = rect(56, 96, 69, 103);
    const zone: ZoneNote = {
      kind: 'zone', id: generateAnnotationId(), cells: zoneCells,
      color: ANNOTATION_COLORS[0]!, tag: DEFAULT_TAG, num: nextZoneNumber([]), size: 's',
    };
    const raw = [...sampled([70, 108], [80, 105]), ...sampled([80, 105], [90, 109]).slice(1)];
    const half = Math.ceil(raw.length / 2);
    const route: RouteNote = { kind: 'route', id: generateAnnotationId(), points: [], color: ANNOTATION_COLORS[5]!, dashed: true };
    return [
      { capKey: 'help.fig.notes_1', move: [56, 96], pointer: 'place', dur: 450 },
      { press: true, dur: 160 },
      {
        move: [69.5, 103.5], dur: 650,
        during: (_ctx, k) => {
          view.annotations({ ...zone, tag: null, cells: zoneCells.filter((c) => c.x <= 56 + 13 * k + 0.5 && c.y <= 96 + 7 * k + 0.5) });
        },
      },
      { press: false, dur: 700, on: ({ world: w }) => { w.addNote(zone); view.annotations(); } },
      { capKey: 'help.fig.notes_2', move: [70, 108], dur: 500 },
      { press: true, dur: 160, on: () => view.annotations({ ...route, points: fitRoutePath(raw.slice(0, 1)) }) },
      { move: [80, 105], dur: 450, during: (_ctx, k) => view.annotations({ ...route, points: fitRoutePath(raw.slice(0, Math.max(1, Math.round(half * k)))) }) },
      {
        move: [90, 109], dur: 450,
        during: (_ctx, k) => view.annotations({ ...route, points: fitRoutePath(raw.slice(0, Math.max(1, half + Math.round((raw.length - half) * k)))) }),
      },
      {
        press: false, dur: 1500,
        on: ({ world: w }) => {
          const points = fitRoutePath(raw);
          w.addNote({ ...route, points });
          view.annotations(null, [route.id]);
          view.curveHandles(points);
        },
      },
      { dur: 300, on: () => view.curveHandles(null) },
    ];
  },
};

const undo: HelpScene = {
  // A tight crop: the subject is one cell climbing four layers, which reads only up close.
  stage: { x1: 67, y1: 96, x2: 80, y2: 105, tile: 26 },
  run: () => {
    let level = 0;
    return [
      { capKey: 'help.fig.undo_1', move: [73, 101], pointer: 'mountain', dur: 500 },
      { press: true, dur: 200, on: ({ world }) => { level = 0; world.beginStroke(); } },
      {
        dur: 900,
        during: ({ world }, k) => {
          const target = Math.min(4, 1 + Math.floor(k * 3.6));
          while (level < target) { level++; world.paint([{ x: 73, y: 101 }], TerrainType.Mountain, level); }
        },
      },
      {
        press: false, realToast: true, capKey: 'help.fig.undo_2', dur: 1400,
        on: ({ world }) => { world.commit(); },
      },
      {
        toastKey: null, keys: UNDO_KEYS, capKey: 'help.fig.undo_3', dur: 1100,
        on: ({ world }) => { world.undo(); },
      },
      // A short rebuild closes the loop on a standing stack: the settled end state (the still
      // frame, and every loop's reset beat) must not be an empty map.
      { keys: null, capKey: null, dur: 300 },
      { press: true, dur: 160, on: ({ world }) => { level = 0; world.beginStroke(); } },
      {
        dur: 500,
        during: ({ world }, k) => {
          const target = Math.min(2, 1 + Math.floor(k * 1.8));
          while (level < target) { level++; world.paint([{ x: 73, y: 101 }], TerrainType.Mountain, level); }
        },
      },
      { press: false, dur: 700, on: ({ world }) => { world.commit(); } },
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
    const dense = chunkFill(world, 65, 97);
    const open = chunkFill(world, 83, 107);
    return [
      {
        capKey: 'help.fig.load_1', move: [67, 99], dur: 800,
        on: () => { view.gauge(0); },
        during: (_ctx, k) => { view.gauge(dense * k); },
      },
      { dur: 700 },
      { capKey: 'help.fig.load_2', move: [83, 107], dur: 800 },
      // The real disc steps to the new region's reading over its own short transition.
      { dur: 250, during: (_ctx, k) => { view.gauge(dense + (open - dense) * k); } },
      { dur: 450 },
      // Off the map entirely: the pointer drops below the crop, and the reading holds.
      { capKey: 'help.fig.load_3', move: [85, 111.5], dur: 700 },
      { dur: 1200 },
    ];
  },
};


const notetext: HelpScene = {
  stage: NOTES_STAGE,
  run: () => {
    // Two chips, shaped as the tool's own committed notes and landed through `world.addNote`.
    const label: ChipNote = {
      kind: 'chip', id: generateAnnotationId(), x: 62, y: 98,
      tag: 'landmark', size: 'm', color: ANNOTATION_COLORS[0]!,
    };
    const chip: ChipNote = {
      kind: 'chip', id: generateAnnotationId(), x: 85, y: 108,
      tag: 'entrance', size: 's', color: ANNOTATION_COLORS[2]!,
    };
    return [
      // The text tool wears the annotate tool's `place` cursor.
      { capKey: 'help.fig.notetext_1', move: [label.x, label.y], pointer: 'place', dur: 550 },
      {
        press: true, dur: 200,
        on: ({ world, view }) => { world.addNote(label); view.annotations(); },
      },
      { press: false, dur: 900 },
      { capKey: 'help.fig.notetext_2', move: [chip.x, chip.y], dur: 600 },
      {
        press: true, dur: 200,
        on: ({ world, view }) => { world.addNote(chip); view.annotations(); },
      },
      { press: false, dur: 1800 },
    ];
  },
};


const notezone: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ view }) => {
    const first = bandCells([57, 97], [72, 97], 1.6);
    const second = bandCells([57, 98], [57, 108], 1.6);
    const zone: ZoneNote = {
      kind: 'zone', id: generateAnnotationId(), cells: [],
      color: ANNOTATION_COLORS[0]!, tag: DEFAULT_TAG, num: nextZoneNumber([]), size: 's',
    };
    return [
      { capKey: 'help.fig.notezone_1', move: [57, 97], pointer: 'place', dur: 450 },
      { press: true, dur: 160 },
      { move: [72, 97], dur: 650, during: (_ctx, k) => view.annotations({ ...zone, cells: reveal(first, k) }) },
      { press: false, dur: 500 },
      { capKey: 'help.fig.notezone_2', move: [57, 98], dur: 400 },
      { press: true, dur: 160 },
      { move: [57, 108], dur: 650, during: (_ctx, k) => view.annotations({ ...zone, cells: addZoneCells(first, reveal(second, k)) }) },
      { press: false, dur: 500 },
      {
        capKey: 'help.fig.notezone_3', dur: 1400,
        on: ({ world }) => { world.addNote({ ...zone, cells: addZoneCells(first, second) }); view.annotations(); },
      },
    ];
  },
};

const notegrow: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world, view }) => {
    const base = rect(58, 96, 67, 101);
    const zone: ZoneNote = {
      kind: 'zone', id: generateAnnotationId(), cells: base,
      color: ANNOTATION_COLORS[0]!, tag: DEFAULT_TAG, num: nextZoneNumber([]), size: 's',
    };
    world.addNote(zone);
    // A stroke down from inside the zone hangs a leg on it; the eraser then takes the right end
    // of the top back, so the L reads as the zone's new shape.
    const grow = bandCells([61, 100], [61, 110], 1.6);
    const bite = bandCells([67, 96], [67, 101], 1.2);
    const grown = addZoneCells(base, grow);
    return [
      { capKey: 'help.fig.notegrow_1', move: [61, 100], pointer: 'place', dur: 450, on: () => view.annotations() },
      { press: true, dur: 160 },
      { move: [61, 110], dur: 650, during: (_ctx, k) => { replaceNote(world, zone.id, { cells: addZoneCells(base, reveal(grow, k)) }); view.annotations(); } },
      { press: false, dur: 600 },
      { capKey: 'help.fig.notegrow_2', move: [67, 96], pointer: 'eraser', dur: 450 },
      { press: true, dur: 160 },
      {
        move: [67, 101], dur: 600,
        during: (_ctx, k) => { replaceNote(world, zone.id, { cells: removeZoneCells(grown, reveal(bite, k)) }); view.annotations(); },
      },
      { press: false, dur: 600 },
      { capKey: 'help.fig.notegrow_3', move: [61, 104], pointer: 'place', dur: 450 },
      { press: true, dur: 140 },
      { press: false, dur: 1200, on: () => view.annotations(null, [zone.id]) },
    ];
  },
};

const measurement: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world, view }) => {
    const note: MeasureNote = {
      kind: 'measure', id: generateAnnotationId(),
      points: [{ x: 59, y: 104 }, { x: 78, y: 104 }], color: ANNOTATION_COLORS[0]!,
    };
    return [
      { capKey: 'help.fig.measure_1', keys: [{ kind: 'cmd', id: 'tool.measure' }], move: [59, 104], pointer: 'place', dur: 450 },
      { press: true, dur: 160 },
      {
        move: [78, 104], dur: 1000,
        during: (_ctx, k) => view.annotations({ ...note, points: resizeMeasurement(note.points, 1, { x: 59 + Math.round(19 * k), y: 104 }) }),
      },
      { press: false, keys: null, dur: 1500, on: () => { world.addNote(note); view.annotations(null, [note.id]); } },
      { capKey: 'help.fig.measure_2', dur: 1800, on: () => { replaceNote(world, note.id, { flipped: true }); view.annotations(null, [note.id]); } },
      { capKey: 'help.fig.measure_3', move: [78, 104], pointer: 'select', dur: 450 },
      { press: true, dur: 160 },
      { move: [88, 104], dur: 1000, during: (_ctx, k) => {
        replaceNote(world, note.id, { points: resizeMeasurement(note.points, 1, { x: 78 + Math.round(10 * k), y: 104 }) });
        view.annotations(null, [note.id]);
      } },
      { press: false, dur: 1600 },
    ];
  },
};

const noteroute: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world, view }) => {
    world.place(CABIN, 78, 100);
    const raw = [...sampled([58, 110], [72, 104]), ...sampled([72, 104], [88, 110]).slice(1)];
    const half = Math.ceil(raw.length / 2);
    const route: RouteNote = { kind: 'route', id: generateAnnotationId(), points: [], color: ANNOTATION_COLORS[5]!, dashed: true };
    return [
      { capKey: 'help.fig.noteroute_1', move: [58, 110], pointer: 'place', dur: 450 },
      { press: true, dur: 160, on: () => view.annotations({ ...route, points: fitRoutePath(raw.slice(0, 1)) }) },
      { move: [72, 104], dur: 500, during: (_ctx, k) => view.annotations({ ...route, points: fitRoutePath(raw.slice(0, Math.max(1, Math.round(half * k)))) }) },
      {
        move: [88, 110], dur: 500,
        during: (_ctx, k) => view.annotations({ ...route, points: fitRoutePath(raw.slice(0, Math.max(1, half + Math.round((raw.length - half) * k)))) }),
      },
      {
        press: false, capKey: 'help.fig.noteroute_2', dur: 1500,
        on: () => {
          const points = fitRoutePath(raw);
          world.addNote({ ...route, points });
          view.annotations(null, [route.id]);
          view.curveHandles(points);
        },
      },
      { dur: 400, on: () => view.curveHandles(null) },
    ];
  },
};

const noteselect: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world, view }) => {
    const homes: ZoneNote = {
      kind: 'zone', id: generateAnnotationId(), cells: rect(56, 95, 65, 100),
      color: ANNOTATION_COLORS[0]!, tag: DEFAULT_TAG, num: 1, size: 's',
    };
    const farm: ZoneNote = {
      kind: 'zone', id: generateAnnotationId(), cells: rect(76, 106, 86, 112),
      color: ANNOTATION_COLORS[5]!, tag: 'farm', num: 2, size: 's',
    };
    const chip: ChipNote = { kind: 'chip', id: generateAnnotationId(), x: 88, y: 97, tag: 'plaza', size: 's', color: ANNOTATION_COLORS[2]! };
    world.addNote(homes);
    world.addNote(farm);
    world.addNote(chip);
    const moveBy = (dy: number): void => {
      replaceNote(world, homes.id, { cells: homes.cells.map((c) => ({ x: c.x, y: c.y + dy })) });
      view.annotations(null, [homes.id]);
    };
    return [
      { capKey: 'help.fig.noteselect_1', move: [60, 97], pointer: 'select', dur: 450, on: () => view.annotations() },
      { press: true, dur: 140 },
      { press: false, dur: 600, on: () => view.annotations(null, [homes.id]) },
      { capKey: 'help.fig.noteselect_2', press: true, dur: 160 },
      { move: [60, 104], dur: 600, during: (_ctx, k) => moveBy(Math.round(7 * k)) },
      { press: false, dur: 600 },
      { keys: CTRL_KEYS, capKey: 'help.fig.noteselect_3', move: [80, 109], dur: 500 },
      { press: true, dur: 140 },
      { press: false, dur: 1200, on: () => view.annotations(null, [homes.id, farm.id]) },
      { keys: null, dur: 200 },
    ];
  },
};


export const PLAN_SCENES: Record<string, HelpScene> = { notes, undo, load, notetext, notezone, notegrow, measurement, noteroute, noteselect };
