/*
 * scenes.ts — the Help Center's demo timelines, written against a real editor world on a real
 * planet template.
 *
 * A scene names a CROP of Hexia (`stage`, template cell coords) and a `run(ctx, t)` factory: it
 * authors the opening state with real commands, then returns this run's steps — closures over the
 * world, so every loop starts clean (the player rewinds the world through the real undo stack
 * between loops). Steps mutate the world through the same doors the live tools use (`paint`,
 * `applyMacro`, `generateDesigned`, `generateMaze`, the stencil
 * pipeline, placement and trim commands), and every mark they show goes through `DemoView` — which
 * the player maps onto the app's own overlay layer (real hover box, real ghost, real selection
 * ring, real band, real region tint, real route gold), so a demo is a proof, never a drawing.
 *
 * Step timings sit beside each other the way a beat sheet does: they are only meaningful as a
 * sequence.
 */
import { TerrainType, type MacroCoord } from '../../../../../core/model/types';
import type { CursorId } from '../../../../../core/runtime/cursor-spec';
import { getMapStats } from '../../../../../state/map-stats';
import { chunkKey, isBuildableZone } from '../../../../../core/model/grid-model';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE, PLAZA_ID } from '../../../../../core/model/constants';
import { CommandType, type Command, type TrimCornersCommand, type Corners } from '../../../../../core/model/types';
import { OUTER_TRI, validateCut } from '../../../../../core/edge-cut/cut-validator';
import { CORNER_INDEX } from '../../../../../core/edge-cut/corner-index';
import { CANONICAL_ROAD_STATES, canonicalToActual, cornersMatch, detectRoadConn } from '../../../../../core/edge-cut/road-cut-states';
import { roadLookup } from '../../../../../state/object-index';
import { removeObjectCommand } from '../../../../../tools/objects/object-placer';
import { rotateObject } from '../../../../../tools/objects/actions';
import { deleteGroup, rotateGroup } from '../../../../../tools/objects/group-actions';
import type { GroupRotation } from '../../../../../canvas/group-arc';
import { peelCommand } from '../../../../../tools/paint/terrain-peel';
import { circleCells, rectCells, splineCells, type CurveAnchor } from '../../../../../tools/paint/shapes';
import { brushCells } from '../../../../../tools/paint/drawing-tool';
import { generateDesigned } from '../../../../../tools/generation/designer/pipeline';
import { applyMacro, detachCommand, previewMacro } from '../../../../../tools/macros';
import { generateMaze } from '../../../../../tools/generation/maze/maze-generator';
import { addZoneCells, generateAnnotationId, nextZoneNumber, removeZoneCells, simplifyPath, ANNOTATION_COLORS, type MapAnnotation, type ZoneNote, type RouteNote, type ChipNote } from '../../../../../core/model/annotations';
import type { TokenSpec } from '../../../../hints/catalogue';
import { DemoWorld } from './demo-world';
import { resizeMeasurement } from '../../../../../core/model/annotation-dimensions';
import type { MeasureNote } from '../../../../../core/model/annotations';

/** The template rect a scene's view frames, and how many CSS px a cell takes. */
export interface Stage { x1: number; y1: number; x2: number; y2: number; tile: number }

/**
 * What a scene may SHOW beyond the map itself. The player implements this over the app's own
 * overlay layer (plus DOM for the two pieces the overlay does not carry: gate pills, the load
 * disc); the headless proof suite implements it as a recorder. Coordinates are template cells.
 */
export interface DemoView {
  /** The real placement preview: cell wash + translucent sprite, validity from the rules.
   *  `cells` overrides the footprint where the preview is a detected span (a bridge's deck). */
  ghost(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270, ok: boolean, cells?: MacroCoord[]): void;
  clearGhost(): void;
  /** The real group-drag preview (a lifted set following the pointer). */
  groupGhost(members: Array<{ catalogId: string; x: number; y: number; rotation: number; elevation: number }>): void;
  /** The real selection ring; `append` adds a member ring the way group select does. */
  selection(x: number, y: number, w: number, h: number, append?: boolean): void;
  clearSelection(): void;
  /** The real marquee band over a cell rect, or null to clear. */
  band(rect: { x: number; y: number; w: number; h: number } | null): void;
  /** The live brush ghost over stroke cells, exactly as a shape tool previews before release:
   *  the overlay's own cell wash with the surface's own card. `null` clears. */
  paintGhost(cells: MacroCoord[] | null, icon?: 'mountain' | 'water' | 'ground'): void;
  /** The real generation-region tint (white at 12%), or null to clear. */
  region(cells: MacroCoord[] | null): void;
  /** The real maze-walk gold, or null to clear. */
  route(cells: MacroCoord[] | null): void;
  /** Maze gate pills (localized), replacing the previous set. */
  marks(marks: Array<{ x: number; y: number; labelKey: string }>): void;
  /** Load disc fill 0..1; negative hides it. */
  gauge(v: number): void;
  /** The object layer's own placement squash for the object about to land. */
  plop(id: string): void;
  /** The object layer's own removal poof, called before the remove executes. */
  poof(id: string): void;
  /** The object layer's own rotation tween, called AFTER the rotate landed: a rotate is a
   *  remove+place, so the wrapper already stands at the new angle and the tween replays the turn. */
  spin(id: string, fromDeg: number, toDeg: number): void;
  /** The object layer's own one-body group turn, handed the spec `rotateGroup` reports once every
   *  member has landed. */
  groupSpin(turn: GroupRotation): void;
  /** Redraw plan notes from `world.state.annotations` through the real annotation layer; a draft
   *  rides along the way the live tool's in-progress figure does, and `selection` wears the marks. */
  annotations(draft?: MapAnnotation | null, selection?: readonly string[]): void;
  /** The adjust handles a finished curve leaves standing: anchor grabs and tangent knobs at these
   *  anchors, wearing the live controls' own faces (`CurveHandles.tsx`). `null` puts them away. */
  curveHandles(anchors: readonly CurveAnchor[] | null): void;
}

export interface DemoCtx { world: DemoWorld; view: DemoView }

export interface SceneStep {
  dur?: number;
  /** Cursor glide target: template cell coords (a cell's center is x.0), or a card of the scene's
   *  shelf strip by index. */
  move?: [number, number] | { strip: number };
  pointer?: CursorId;
  press?: boolean;
  /** Arm or clear the follow-ghost: the real placement preview rides the cursor, validity asked of
   *  the rules at every cell it crosses, exactly as a picked-up card behaves. `null` clears. */
  follow?: { catalogId: string; rotation?: 0 | 90 | 180 | 270 } | null;
  /** Which strip card shows as picked up (`null` clears). */
  strip?: number | null;
  /** Re-arm the tools strip on another cell mid-scene (`null` returns to the scene's own). */
  tool?: string | null;
  /** Pose the strip's brush-size reading (the pictured slider), for a beat that talks width. */
  stripSize?: number;
  /** Show the built-pieces card, computed live from the world (`false` hides). */
  checklist?: boolean;
  /** Key chips resolved through the live keymap; `null` clears. */
  keys?: readonly TokenSpec[] | null;
  capKey?: string | null;
  toastKey?: string | null;
  /** Params for `toastKey` (a real app string may carry tokens). */
  toastParams?: Record<string, string | number>;
  /** Show the world's own last refusal as the toast (read after `on` runs). */
  realToast?: boolean;
  /** Camera against the stage frame: offset in cells and a zoom factor (1 = the stage fit). */
  cam?: Partial<{ dx: number; dy: number; z: number }>;
  on?: (ctx: DemoCtx) => void;
  during?: (ctx: DemoCtx, k: number) => void;
}

type Resolver = (key: string) => string;

/** A slice of real interface standing beside the map (`figures/previews/strips.tsx`). */
export type StripSpec =
  | { kind: 'tools'; active: string; surface?: 'mountain' | 'water' | 'road' }
  /** `smart: true` stands the category's smart-planting card at the row's start, the way the
   *  live shelf leads its trees and plants tabs; it is strip index 0, and the items follow. */
  | { kind: 'shelf'; items: readonly string[]; smart?: boolean };

export interface HelpScene {
  /** Template id; Hexia unless a scene says otherwise. */
  template?: string;
  stage: Stage;
  strip?: StripSpec;
  run: (ctx: DemoCtx, t: Resolver) => SceneStep[];
}

const UNDO_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'history.undo' }];
const PAN_HOLD_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'camera.pan_drag', held: true }];
const SHIFT_KEYS: readonly TokenSpec[] = [{ kind: 'key', label: 'Shift' }];
const CTRL_KEYS: readonly TokenSpec[] = [{ kind: 'key', label: 'Ctrl' }];
const ROTATE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.rotate_cw' }];
const DELETE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.delete' }];

/** Progressive stroke: paints `cells` one by one as `k` advances, each exactly once. */
function stroke(cells: MacroCoord[], type: TerrainType, elevation: number) {
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const n = Math.min(cells.length, Math.floor(k * cells.length + 1e-6));
    for (; done < n; done++) world.paint([cells[done]!], type, elevation);
    if (k >= 1) for (; done < cells.length; done++) world.paint([cells[done]!], type, elevation);
  };
}

/** Progressive coating stroke: lays one `catalogId` object per cell as `k` advances, the way the
 *  paving brush places a coating under each cell it crosses. */
function coatStroke(cells: MacroCoord[], catalogId: string) {
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const n = Math.min(cells.length, Math.floor(k * cells.length + 1e-6));
    for (; done < n; done++) world.place(catalogId, cells[done]!.x, cells[done]!.y);
    if (k >= 1) for (; done < cells.length; done++) world.place(catalogId, cells[done]!.x, cells[done]!.y);
  };
}

/** One eraser dab: peels exactly one terrain layer at `c`, the same command the live eraser issues
 *  per cell it crosses. */
function eraseCell(world: DemoWorld, c: MacroCoord, convertWater: boolean): void {
  const cell = world.state.cells[c.y]?.[c.x] ?? null;
  const cmd = peelCommand(c.x, c.y, cell, convertWater);
  if (cmd) world.executor.execute(cmd);
}

/** Progressive eraser drag: peels one cell's top layer per cell in `cells`, in order, as `k`
 *  advances — a second pass over the same cells (a fresh call) peels the layer under that. */
function eraseStroke(cells: MacroCoord[], convertWater: boolean) {
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const n = Math.min(cells.length, Math.floor(k * cells.length + 1e-6));
    for (; done < n; done++) eraseCell(world, cells[done]!, convertWater);
    if (k >= 1) for (; done < cells.length; done++) eraseCell(world, cells[done]!, convertWater);
  };
}

function row(y: number, x0: number, x1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

function column(x: number, y0: number, y1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) cells.push({ x, y });
  return cells;
}

function rect(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

/** A path widened to `size` the way a dragged brush stroke actually would be: the real per-point
 *  footprint (`drawing-tool.ts:brushCells`), unioned along every point of the path rather than a
 *  hand-rolled rectangle, so a bent path widens exactly as the live brush leaves it. */
function widenPath(path: readonly MacroCoord[], size: number): MacroCoord[] {
  const seen = new Set<string>();
  const cells: MacroCoord[] = [];
  for (const p of path) {
    for (const c of brushCells(p.x, p.y, size)) {
      const key = `${c.x},${c.y}`;
      if (!seen.has(key)) { seen.add(key); cells.push(c); }
    }
  }
  return cells;
}

/** The real load reading for the chunk under (x, y): the meter's own formula. */
function chunkFill(world: DemoWorld, x: number, y: number): number {
  const key = chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
  const load = getMapStats(world.state).chunks.get(key)?.load ?? 0;
  return Math.min(1, load / CHUNK_LOAD_LIMIT);
}

const CABIN = 'building-forest-cabin';
const CABIN2 = 'building-sunset-cabin';
const TREE = 'tree-apple';
const FLOWER = 'flower-daisy';
const BRIDGE = 'bridge-plank';
const RAMP = 'ramp-park-steps';
const ROAD_TILE = 'path-cobblestone';

/* The two press seeds the set-piece roll answers with a shape (`delights.ts:delightRoll`), pinned
 * here so the delight figure shows the pieces themselves. */
const RING_SEED = 13;
const HEART_SEED = 43;

/* Stages on Hexia. The interior is open grass south of the plaza; the south coast crop holds
 * grass rows over the boundary line, the beach ring and open sea. */
const INTERIOR: Stage = { x1: 62, y1: 96, x2: 85, y2: 108, tile: 17 };
const COAST: Stage = { x1: 60, y1: 114, x2: 83, y2: 126, tile: 17 };
const PLAZA_EDGE: Stage = { x1: 70, y1: 80, x2: 93, y2: 92, tile: 17 };

/* ───────────────────────────── start ───────────────────────────── */

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
      // The editor's own move gesture: a click SELECTS, and only a drag on the selected object
      // moves it (a drag from anywhere else pans). The open hand shows over the selection.
      { capKey: 'help.fig.welcome_1', move: [from.x, from.y], pointer: 'select', dur: 650 },
      { press: true, dur: 180, on: () => { view.selection(from.x, from.y, 1, 1); } },
      { press: false, pointer: 'hand-open', dur: 400 },
      {
        press: true, pointer: 'hand-closed', dur: 240,
        on: ({ world: w }) => {
          const tree = w.objectAt(TREE, from.x, from.y);
          if (tree) { view.poof(tree.id); w.executor.execute(removeObjectCommand(tree)); }
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
      { press: false, pointer: 'place', move: [67, 115.5], dur: 900 },
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
    world.paint(row(88, 74, 76), TerrainType.Mountain, 1);
    world.paint(row(89, 74, 76), TerrainType.Mountain, 1);
    world.paint([{ x: 75, y: 88 }], TerrainType.Mountain, 2);
    world.commit();
    world.place(CABIN, 84, 86);
    world.place(TREE, 79, 90);
    return [
      // A drag-pan carries the map WITH the hand: the camera shifts by exactly the pointer's own
      // travel, opposite sign, so the grabbed cell stays under the pointer the whole way. The live
      // pan cursor is `move` (the hands belong to grabbing objects; see cursor-controller.ts).
      { capKey: 'help.fig.camera_1', move: [79, 86], dur: 500 },
      { press: true, pointer: 'move', dur: 150 },
      { move: [83, 88], cam: { dx: -4, dy: -2 }, dur: 800 },
      { press: false, pointer: 'select', dur: 300 },
      // The zoom anchors where the pointer stands; the demo camera zooms about the view's centre,
      // so the pointer walks there first and the caption's claim is what the frame shows.
      { capKey: 'help.fig.camera_2', move: [78, 84.5], dur: 400 },
      { cam: { z: 1.35 }, dur: 550 },
      { cam: { z: 1 }, dur: 550 },
      { keys: PAN_HOLD_KEYS, capKey: 'help.fig.camera_3', move: [83, 88], dur: 400 },
      { press: true, pointer: 'move', dur: 150 },
      { move: [79, 86], cam: { dx: 0, dy: 0 }, dur: 700 },
      { press: false, keys: null, pointer: 'select', dur: 700 },
    ];
  },
};

/* ───────────────────────────── build ───────────────────────────── */

const terrain: HelpScene = {
  stage: INTERIOR,
  // Opens on a NEIGHBOUR cell so the first click visibly arms the brush: the plate grows, the
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
      // One held stroke raises a cell once; stacking the next layer is a SECOND stroke.
      { press: false, dur: 350, on: ({ world }) => { world.commit(); } },
      { press: true, dur: 160, on: ({ world }) => world.beginStroke() },
      { move: [68, 101], dur: 400, during: stroke(stack.slice(0, 3), TerrainType.Mountain, 2) },
      { move: [67, 101], dur: 250, during: stroke(stack.slice(3, 4), TerrainType.Mountain, 2) },
      { press: false, dur: 400, on: ({ world }) => { world.commit(); } },
      // The straight line is the LINE tool's; Shift snaps its drag to horizontal/vertical/45.
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
    world.executor.execute(trimCmd(world, 70, 99, CORNER_INDEX.TL, 1));
    world.executor.execute(trimCmd(world, 74, 99, CORNER_INDEX.TR, 1));
    world.place(TREE, 71, 100, { elevation: 2 });
    // ONE wandering stroke along the block's own foot, changing direction several times: down,
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
    const wide = widenPath(path2, 3);
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
    // (`tools/paint/shapes.ts:splineCells`), never hand-drawn.
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
    // An uneven shoulder standing before the rect arrives, with an existing cabin to one side.
    world.place(CABIN, 63, 100);
    world.beginStroke();
    world.paint(column(74, 99, 104), TerrainType.Mountain, 1);
    world.paint(row(104, 69, 74), TerrainType.Mountain, 1);
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
    const caps = ['help.fig.autotrim_1', 'help.fig.autotrim_2', 'help.fig.autotrim_3'];
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

const water: HelpScene = {
  stage: INTERIOR,
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
function trimCmd(world: DemoWorld, x: number, y: number, cornerIdx: number, digit: 0 | 1 | 2): TrimCornersCommand {
  const cell = world.state.cells[y]?.[x]?.terrain;
  const before = cell?.corners ? [...cell.corners] as Corners : undefined;
  const next: Corners = before ? [...before] : ['square', 'square', 'square', 'square'];
  next[cornerIdx] = digit === 1 ? 'fan' : digit === 2 ? OUTER_TRI[cornerIdx]! : 'square';
  return {
    type: CommandType.TrimCorners, timestamp: Date.now(),
    x, y, layer: 'terrain', beforeCorners: before, afterCorners: next,
  };
}

const trim: HelpScene = {
  stage: { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 },
  strip: { kind: 'tools', active: 'draw' },
  run: ({ world }) => {
    world.beginStroke();
    const block = rect(71, 100, 72, 101);
    world.paint(block, TerrainType.Mountain, 1);
    world.paint(block, TerrainType.Mountain, 2);
    world.commit();
    return [
      { move: { strip: 2 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'trim', dur: 500 },
      { press: false, capKey: 'help.fig.trim_1', move: [72.9, 101.9], pointer: 'edge-cut', dur: 550 },
      { press: true, dur: 160, on: ({ world: w }) => { w.executor.execute(trimCmd(w, 72, 101, CORNER_INDEX.BR, 1)); } },
      { press: false, dur: 800 },
      { capKey: 'help.fig.trim_2', press: true, dur: 160, on: ({ world: w }) => { w.executor.execute(trimCmd(w, 72, 101, CORNER_INDEX.BR, 2)); } },
      { press: false, dur: 800 },
      { capKey: 'help.fig.trim_3', press: true, dur: 160, on: ({ world: w }) => { w.executor.execute(trimCmd(w, 72, 101, CORNER_INDEX.BR, 0)); } },
      { press: false, dur: 900 },
    ];
  },
};

/** The stage both trim figures share with the page's lead: close enough that one corner reads. */
const TRIM_STAGE: Stage = { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 };

/** A diagonal pinch: two blocks meeting corner to corner, so ONE intersection carries two cut
 *  sites. Every click here goes through the real tool (`DemoWorld.trimClick`), which is what makes
 *  the combinations the figure walks the live cycle's own. */
const trimmulti: HelpScene = {
  stage: TRIM_STAGE,
  run: ({ world }) => {
    world.beginStroke();
    world.paint(rect(68, 99, 69, 100), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(70, 101, 71, 102), TerrainType.Mountain, 1);
    world.commit();
    // The vertex the two blocks share: the tool gathers both their corners there.
    const pinch = { x: 69, y: 100 };
    const click = (capKey: string | null): SceneStep[] => [
      { capKey, press: true, dur: 170, on: ({ world: w }) => { w.trimClick(pinch.x, pinch.y); } },
      { press: false, dur: 850 },
    ];
    return [
      { capKey: 'help.fig.trimmulti_1', move: [pinch.x + 0.9, pinch.y + 0.9], pointer: 'edge-cut', dur: 700 },
      ...click('help.fig.trimmulti_2'),
      ...click(null),
      ...click('help.fig.trimmulti_3'),
      ...click(null),
      { dur: 900 },
    ];
  },
};

/** A concave corner hard against terrain one layer taller: the click rounds the TALLER block, and
 *  what it leaves in the hollow is a cosmetic patch rather than ground to build on. */
const trimnotch: HelpScene = {
  stage: TRIM_STAGE,
  run: ({ world }) => {
    world.beginStroke();
    world.paint(rect(72, 99, 74, 101), TerrainType.Mountain, 1);
    world.commit();
    // An L at the upper tier, its inside angle around the one cell left a layer lower.
    world.beginStroke();
    world.paint([{ x: 72, y: 99 }, { x: 73, y: 99 }, { x: 74, y: 99 }, { x: 72, y: 100 }, { x: 72, y: 101 }], TerrainType.Mountain, 2);
    world.commit();
    const notch = { x: 72, y: 99 };
    return [
      { capKey: 'help.fig.trimnotch_1', move: [notch.x + 0.9, notch.y + 0.9], pointer: 'edge-cut', dur: 750 },
      { press: true, dur: 170, on: ({ world: w }) => { w.trimClick(notch.x, notch.y); } },
      { press: false, capKey: 'help.fig.trimnotch_2', dur: 1300 },
      { press: true, dur: 170, on: ({ world: w }) => { w.trimClick(notch.x, notch.y); } },
      { press: false, capKey: 'help.fig.trimnotch_3', dur: 1800 },
    ];
  },
};

/** The next cut for a CONNECTED road tile, exactly as the live tool cycles it: the canonical
 *  state table walked in order, each candidate held to `validateCut` for the tile's own seam, the
 *  first legal one landed as the command (`afterCorners` stays canonical; the renderer rotates by
 *  connection side). */
function roadTrimClick(world: DemoWorld, tile: { x: number; y: number }): void {
  const roads = roadLookup(world.state);
  const roadObj = roads(tile.x, tile.y);
  if (!roadObj) return;
  const conn = detectRoadConn(roads, roadObj);
  let currentIdx = 0;
  for (let i = 0; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(roadObj.corners, CANONICAL_ROAD_STATES[i])) { currentIdx = i; break; }
  }
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    const nextIdx = (currentIdx + i) % CANONICAL_ROAD_STATES.length;
    const canonical = CANONICAL_ROAD_STATES[nextIdx];
    const corners: Corners = canonical ? [...canonical] : ['square', 'square', 'square', 'square'];
    if (!validateCut(world.state, roads, tile.x, tile.y, 'road', canonicalToActual(corners, conn))) continue;
    world.executor.execute({
      type: CommandType.TrimCorners, timestamp: Date.now(),
      x: tile.x, y: tile.y, layer: 'road', objectId: roadObj.id,
      beforeCorners: roadObj.corners ? [...roadObj.corners] as Corners : undefined,
      afterCorners: corners,
    } as TrimCornersCommand);
    return;
  }
}

const roadtrim: HelpScene = {
  stage: { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 },
  strip: { kind: 'tools', active: 'draw', surface: 'road' },
  run: ({ world }) => {
    world.place(ROAD_TILE, 71, 101);
    world.place(ROAD_TILE, 72, 101);
    world.place(ROAD_TILE, 73, 101);
    const end = { x: 73, y: 101 };
    return [
      { move: { strip: 2 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'trim', dur: 500 },
      { press: false, capKey: 'help.fig.roadtrim_1', move: [73.9, 101.9], pointer: 'edge-cut', dur: 550 },
      { press: true, dur: 160, on: ({ world: w }) => { roadTrimClick(w, end); } },
      { press: false, dur: 900 },
      { capKey: 'help.fig.roadtrim_2', press: true, dur: 160, on: ({ world: w }) => { roadTrimClick(w, end); } },
      { press: false, dur: 900 },
      { capKey: 'help.fig.roadtrim_3', press: true, dur: 160, on: ({ world: w }) => { roadTrimClick(w, end); } },
      { press: false, dur: 1100 },
    ];
  },
};

const objects: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'shelf', items: [BRIDGE, TREE] },
  run: ({ world, view }) => {
    // A mountain-walled pond, filled through the rules so the water genuinely stands. Oblong on
    // purpose: the short way across is under the bridge's span, so only one orientation stands.
    world.beginStroke();
    world.paint(row(99, 70, 73), TerrainType.Mountain, 1);
    world.paint(row(104, 70, 73), TerrainType.Mountain, 1);
    for (let y = 100; y <= 103; y++) world.paint([{ x: 70, y }, { x: 73, y }], TerrainType.Mountain, 1);
    for (let y = 100; y <= 103; y++) world.paint(row(y, 71, 72), TerrainType.Water, 1);
    world.commit();
    return [
      { capKey: 'help.fig.objects_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, follow: { catalogId: BRIDGE }, dur: 240 },
      { press: false, pointer: 'place', move: [72, 101], dur: 800 },
      { capKey: 'help.fig.objects_2', move: [71, 101], dur: 900 },
      // The card stays in hand after a placement; clicking its shelf card puts it away.
      {
        press: true, dur: 240,
        on: ({ world: w }) => { w.place(BRIDGE, 71, 101, { plop: view.plop }); },
      },
      { press: false, move: [72, 102.5], dur: 500 },
      { move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, follow: null, strip: null, dur: 240 },
      { press: false, dur: 300 },
      { capKey: 'help.fig.objects_3', move: { strip: 1 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 1, follow: { catalogId: TREE }, dur: 240 },
      { press: false, pointer: 'place', move: [64, 99], dur: 700 },
      {
        press: true, dur: 240,
        on: ({ world: w }) => { w.place(TREE, 64, 99, { plop: view.plop }); },
      },
      // The card stays in hand after a placement, exactly as the shelf arms it.
      { press: false, move: [65, 100], dur: 550 },
      { capKey: 'help.fig.objects_4', move: [66, 103], dur: 600 },
      {
        press: true, follow: null, strip: null, dur: 240,
        on: ({ world: w }) => { view.clearGhost(); w.place(TREE, 66, 103, { plop: view.plop }); },
      },
      { press: false, dur: 900 },
    ];
  },
};

const rotate: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    world.place(CABIN, 68, 98);
    return [
      { capKey: 'help.fig.rotate_1', move: [70, 99.5], pointer: 'select', dur: 700 },
      {
        press: true, dur: 200,
        on: ({ world: w }) => {
          const c = w.objectAt(CABIN, 68, 98);
          if (c) view.selection(c.position.x, c.position.y, 5, 4);
        },
      },
      { press: false, dur: 600 },
      { capKey: 'help.fig.rotate_2', keys: ROTATE_KEYS, dur: 500 },
      {
        dur: 1000,
        on: ({ world: w }) => {
          const c = w.objectAt(CABIN, 68, 98);
          if (!c) return;
          const res = rotateObject(w.executor, w.state, c, 90, { from: 0, to: 90 });
          if (res.ok && res.spin) view.spin(c.id, res.spin.from, res.spin.to);
          // The footprint transposes with the turn, and the ring follows it the way the live one does.
          view.selection(68, 98, 4, 5);
        },
      },
      { capKey: 'help.fig.rotate_3', dur: 500 },
      {
        dur: 1000,
        on: ({ world: w }) => {
          const c = w.objectAt(CABIN, 68, 98);
          if (!c) return;
          const res = rotateObject(w.executor, w.state, c, 180, { from: 90, to: 180 });
          if (res.ok && res.spin) view.spin(c.id, res.spin.from, res.spin.to);
          view.selection(68, 98, 5, 4);
        },
      },
      { keys: null, dur: 800 },
    ];
  },
};

const ramp: HelpScene = {
  stage: { x1: 64, y1: 94, x2: 81, y2: 105, tile: 20 },
  strip: { kind: 'shelf', items: [RAMP] },
  run: ({ world, view }) => {
    // A terrace exactly one layer high; the heightDrop rule reads the drop off the lip itself and
    // snaps the piece's rotation and elevation, so the scene never poses either.
    world.beginStroke();
    world.paint(rect(68, 95, 77, 98), TerrainType.Mountain, 1);
    world.commit();
    return [
      { capKey: 'help.fig.ramp_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, follow: { catalogId: RAMP }, dur: 240 },
      { press: false, pointer: 'place', move: [72.5, 99.5], dur: 1000 },
      {
        capKey: 'help.fig.ramp_2', press: true, follow: null, strip: null, dur: 240,
        on: ({ world: w }) => { view.clearGhost(); w.place(RAMP, 72, 98, { plop: view.plop }); },
      },
      { press: false, dur: 1800 },
    ];
  },
};

const spacing: HelpScene = {
  stage: { x1: 62, y1: 96, x2: 75, y2: 104, tile: 24 },
  strip: { kind: 'shelf', items: [TREE] },
  run: ({ world }) => {
    world.place(TREE, 67, 100);
    return [
      { capKey: 'help.fig.plant_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, follow: { catalogId: TREE }, dur: 240 },
      { press: false, pointer: 'place', move: [68, 101], dur: 800 },
      // The press asks the rules; the refusal that comes back is the app's own toast, word for word.
      { press: true, dur: 240, on: ({ world: w }) => { w.place(TREE, 68, 101); } },
      { press: false, realToast: true, capKey: 'help.fig.plant_2', dur: 1700 },
      { toastKey: null, move: [69.5, 102.5], dur: 700 },
      {
        press: true, follow: null, strip: null, dur: 240,
        on: (ctx) => { ctx.view.clearGhost(); ctx.world.place(TREE, 69, 102, { plop: ctx.view.plop }); },
      },
      { press: false, capKey: 'help.fig.plant_3', dur: 1200 },
    ];
  },
};

/** The smart-planting card the trees tab leads with: one press plants a varied patch through the
 *  real macro, and a second press elsewhere draws a different combination from the same grammar. */
const smartpatch: HelpScene = {
  stage: { x1: 61, y1: 95, x2: 78, y2: 106, tile: 20 },
  strip: { kind: 'shelf', items: [TREE], smart: true },
  run: () => [
    { capKey: 'help.fig.smartpatch_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
    { press: true, strip: 0, dur: 240 },
    { press: false, pointer: 'place', move: [66, 100], dur: 700 },
    // Radius 4 is the bar's own smallest setting, the same floor `smart1` poses.
    { press: true, dur: 260, on: ({ world }) => { applyMacro(world.kit, 'patch-tree', { seed: 11, at: { x: 66, y: 100 }, radius: 4 }); } },
    { press: false, dur: 1300 },
    { capKey: 'help.fig.smartpatch_2', move: [73, 102], dur: 600 },
    { press: true, dur: 260, on: ({ world }) => { applyMacro(world.kit, 'patch-tree', { seed: 12, at: { x: 73, y: 102 }, radius: 4 }); } },
    { press: false, dur: 1800 },
  ],
};

/** The rare set piece: two presses of the planting card whose seeds the roll answers with a shape,
 *  so the figure shows the pieces themselves rather than the odds of getting one. */
const delight: HelpScene = {
  stage: { x1: 60, y1: 95, x2: 81, y2: 107, tile: 18 },
  strip: { kind: 'shelf', items: [FLOWER], smart: true },
  run: () => {
    const ring = { x: 66, y: 101 };
    const heart = { x: 76, y: 101 };
    return [
      { capKey: 'help.fig.delight_1', move: { strip: 0 }, pointer: 'clickable', dur: 600 },
      { press: true, strip: 0, dur: 240 },
      { press: false, pointer: 'place', move: [ring.x, ring.y], dur: 700 },
      {
        press: true, dur: 280,
        on: ({ world }) => { applyMacro(world.kit, 'patch-flora', { seed: RING_SEED, at: ring, radius: 4 }); },
      },
      { press: false, capKey: 'help.fig.delight_2', dur: 1600 },
      { move: [heart.x, heart.y], dur: 700 },
      {
        press: true, dur: 280,
        on: ({ world }) => { applyMacro(world.kit, 'patch-flora', { seed: HEART_SEED, at: heart, radius: 4 }); },
      },
      { press: false, capKey: 'help.fig.delight_3', dur: 1900 },
    ];
  },
};

const select: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    world.place(TREE, 64, 98);
    world.place(TREE, 66, 99);
    world.place(FLOWER, 64, 102);
    world.place(CABIN, 75, 99);
    const picked = [
      { catalogId: TREE, x: 64, y: 98 },
      { catalogId: TREE, x: 66, y: 99 },
      { catalogId: FLOWER, x: 64, y: 102 },
    ];
    const ringPicked = () => {
      for (const [i, p] of picked.entries()) view.selection(p.x, p.y, 1, 1, i > 0);
    };
    return [
      { keys: CTRL_KEYS, capKey: 'help.fig.select_1', move: [63.2, 97.2], dur: 500 },
      { press: true, pointer: 'marquee', dur: 160 },
      {
        move: [67.8, 103.6], dur: 700,
        during: (_ctx, k) => { view.band({ x: 63.2, y: 97.2, w: 4.6 * k, h: 6.4 * k }); },
      },
      {
        press: false, pointer: 'select', capKey: 'help.fig.select_2', dur: 900,
        on: () => {
          view.band(null);
          ringPicked();
        },
      },
      // Ctrl's second job, membership: still held, a click brings the cabin in, another lets it go.
      { capKey: 'help.fig.select_ctrl', move: [77.5, 101], dur: 550 },
      { press: true, dur: 180, on: () => { view.selection(75, 99, 5, 4, true); } },
      { press: false, dur: 700 },
      { press: true, dur: 180, on: () => { ringPicked(); } },
      { press: false, keys: null, dur: 500 },
      { capKey: 'help.fig.select_3', move: [65, 100.5], pointer: 'hand-open', dur: 450 },
      {
        press: true, pointer: 'hand-closed', dur: 180,
        on: ({ world: w }) => {
          for (const p of picked) {
            const obj = w.objectAt(p.catalogId, p.x, p.y);
            if (obj) { view.poof(obj.id); w.executor.execute(removeObjectCommand(obj)); }
          }
          view.clearSelection();
        },
      },
      {
        move: [69, 101.5], dur: 800,
        during: (_ctx, k) => {
          view.groupGhost(picked.map((p) => ({ catalogId: p.catalogId, x: p.x + 4 * k, y: p.y + 1 * k, rotation: 0, elevation: 0 })));
        },
      },
      {
        press: false, pointer: 'select', dur: 1000,
        on: ({ world: w }) => {
          view.clearGhost();
          for (const [i, p] of picked.entries()) {
            w.place(p.catalogId, p.x + 4, p.y + 1, { plop: view.plop });
            view.selection(p.x + 4, p.y + 1, 1, 1, i > 0);
          }
        },
      },
    ];
  },
};

const grouprotate: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    const members = [
      { catalogId: TREE, x: 66, y: 98 },
      { catalogId: TREE, x: 70, y: 98 },
      { catalogId: FLOWER, x: 66, y: 102 },
    ];
    const ids: string[] = [];
    for (const m of members) {
      const id = world.place(m.catalogId, m.x, m.y);
      if (id) ids.push(id);
    }
    const ringAll = (w: DemoWorld) => {
      let first = true;
      for (const id of ids) {
        const o = w.state.objects.get(id);
        if (o) { view.selection(o.position.x, o.position.y, 1, 1, !first); first = false; }
      }
    };
    return [
      {
        capKey: 'help.fig.gspin_1', move: [68, 100], pointer: 'select', dur: 700,
        on: ({ world: w }) => { ringAll(w); },
      },
      { keys: ROTATE_KEYS, dur: 600 },
      {
        capKey: 'help.fig.gspin_2', dur: 400,
        on: ({ world: w }) => {
          view.clearSelection();
          rotateGroup(w.executor, w.state, ids, 1, (turn) => view.groupSpin(turn));
        },
      },
      { dur: 900, on: ({ world: w }) => { ringAll(w); } },
      { keys: null, capKey: 'help.fig.gspin_3', dur: 1400 },
    ];
  },
};

/** The plaza refusing, twice over: a group delete keeps it and reports what it kept, and a delete
 *  aimed at it alone comes back with the rule's own words. Both go through the real doors — the
 *  group verb `deleteGroup` and the plain removal command every delete surface issues. */
const locked: HelpScene = {
  // The plaza's south-west corner, which is the only part of a 20x27 slab a readable crop can hold.
  stage: PLAZA_EDGE,
  run: ({ world, view }) => {
    world.place(CABIN, 71, 87);
    const trees = [{ x: 79, y: 88 }, { x: 82, y: 90 }];
    const ids: string[] = [];
    for (const p of trees) {
      const id = world.place(TREE, p.x, p.y);
      if (id) ids.push(id);
    }
    const plaza = world.state.objects.get(PLAZA_ID);
    const ringPlaza = () => {
      if (plaza) view.selection(plaza.position.x, plaza.position.y, plaza.width ?? 1, plaza.height ?? 1);
    };
    const band = { x: 77, y: 82, w: 7.5, h: 9.5 };
    return [
      { keys: CTRL_KEYS, capKey: 'help.fig.locked_1', move: [band.x, band.y], pointer: 'marquee', dur: 550 },
      { press: true, dur: 160 },
      {
        move: [band.x + band.w, band.y + band.h], dur: 750,
        during: (_ctx, k) => { view.band({ x: band.x, y: band.y, w: band.w * k, h: band.h * k }); },
      },
      // The plaza joins the selection like anything else the band touched; its ring is its whole
      // footprint, most of which stands outside this crop.
      {
        press: false, keys: null, pointer: 'select', capKey: 'help.fig.locked_2', dur: 1000,
        on: ({ world: w }) => {
          view.band(null);
          ringPlaza();
          for (const p of trees) {
            const obj = w.objectAt(TREE, p.x, p.y);
            if (obj) view.selection(obj.position.x, obj.position.y, 1, 1, true);
          }
        },
      },
      { keys: DELETE_KEYS, dur: 600 },
      // The group verb takes what it can and keeps what it cannot: the trees go, the plaza stands.
      {
        press: true, dur: 200,
        on: ({ world: w }) => {
          deleteGroup(w.executor, w.state, ids, (obj) => view.poof(obj.id));
          view.clearSelection();
          ringPlaza();
        },
      },
      // The app's own count for a group delete that kept a locked member.
      { press: false, keys: null, toastKey: 'toast.group_delete_kept_one', toastParams: { n: 1 }, dur: 1700 },
      { toastKey: null, capKey: 'help.fig.locked_3', move: [80, 84], dur: 700 },
      { keys: DELETE_KEYS, dur: 600 },
      // The same removal command every delete surface issues, and the rule's own refusal comes back.
      {
        press: true, realToast: true, dur: 240,
        on: ({ world: w }) => {
          const p = w.state.objects.get(PLAZA_ID);
          if (p) w.executor.execute(removeObjectCommand(p));
        },
      },
      { press: false, keys: null, dur: 1600 },
    ];
  },
};

/* ─────────────────────────── generate ──────────────────────────── */

const smart1: HelpScene = {
  stage: { x1: 63, y1: 97, x2: 82, y2: 107, tile: 19 },
  run: ({ world, view }) => {
    const at = { x: 72, y: 102 };
    const opts = { seed: 4, at, radius: 4, steepness: 'steep' as const, footing: 0 };
    const grow = (stage: number) => applyMacro(world.kit, 'raise', { ...opts, stage,
      heldCells: circleCells(at, 6, 6).filter(c => world.kit.state.cells[c.y]?.[c.x]?.terrain)
        .map(c => c.y * world.kit.state.template.width + c.x),
    });
    return [
    { capKey: 'help.fig.smart1_1', move: [72, 102], pointer: 'place', dur: 1100,
      on: () => view.paintGhost(previewMacro(world.kit, 'raise', opts).added, 'mountain'),
    },
    {
      press: true, capKey: 'help.fig.smart1_2', dur: 260,
      on: () => { view.paintGhost(null); grow(1); },
    },
    {
      press: true, dur: 700, on: () => grow(2),
    },
    {
      press: true, dur: 700, on: () => grow(3),
    },
    { press: false, dur: 1500 },
  ];
  },
};

/** An endpoint-guided river through terraces, built by the same macro as the editor. */
const stream: HelpScene = {
  stage: COAST,
  run: ({ world, view }) => {
    world.beginStroke();
    world.paint(rect(64, 114, 78, 119), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(66, 114, 76, 118), TerrainType.Mountain, 2);
    world.commit();
    world.beginStroke();
    world.paint(rect(68, 114, 74, 116), TerrainType.Mountain, 3);
    world.commit();
    // A tarn on the top terrace, walled by that terrace on every side: the press the copy describes
    // is a press on standing water.
    world.beginStroke();
    world.paint([{ x: 71, y: 115 }], TerrainType.Water, 3);
    world.commit();
    const from = { x: 71, y: 115 };
    const at = { x: 80, y: 120 }, opts = { seed: 5, from, at, width: 1 };
    return [
      { capKey: 'help.fig.stream_1', move: [from.x, from.y], pointer: 'place', dur: 700 },
      {
        press: true, move: [at.x, at.y], dur: 850,
        on: () => view.paintGhost(previewMacro(world.kit, 'stream', opts).added, 'water'),
      },
      { press: false, capKey: 'help.fig.stream_2', dur: 2000,
        on: () => { view.paintGhost(null); applyMacro(world.kit, 'stream', opts); },
      },
    ];
  },
};

const smart2: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    world.place(CABIN, 64, 97);
    world.place(CABIN2, 75, 104);
    const from = { x: 65, y: 98 }, at = { x: 76, y: 105 }, opts = { seed: 1, from, at, width: 2 };
    return [
      { capKey: 'help.fig.smart2_1', move: [from.x, from.y], pointer: 'place', dur: 550 },
      { press: true, move: [at.x, at.y], dur: 850,
        on: () => view.paintGhost(previewMacro(world.kit, 'road-link', opts).added),
      },
      { press: false, capKey: 'help.fig.smart2_2', dur: 1700,
        on: () => { view.paintGhost(null); applyMacro(world.kit, 'road-link', opts); },
      },
    ];
  },
};

/**
 * A designed run planned once per (scene, region) and replayed on every later loop. The pipeline is
 * deterministic per (seed, config) and the demo world rewinds to the same template between loops,
 * so the recorded command list IS the run — and the planning (hundreds of ms on the main thread,
 * per loop, times a throttle on a weak machine) is paid a single time. Replayed commands are
 * detached: the executor seats a place command's own object into the map, and a shared instance
 * replayed twice would be one object standing in two histories.
 */
const designedRuns = new Map<string, Command[]>();

function runDesigned(world: DemoWorld, key: string, region: MacroCoord[] | null): void {
  const cached = designedRuns.get(key);
  if (cached) {
    for (const cmd of cached) world.executor.execute(detachCommand(cmd));
    return;
  }
  const commands: Command[] = [];
  generateDesigned({
    state: world.state,
    execute: (cmd) => { commands.push(cmd); return world.executor.execute(cmd); },
    reg: world.kit.registry,
    seed: 20260829, richness: 0.7, maxElevation: 4, mode: 'mixed', region,
  });
  designedRuns.set(key, commands);
}

const generate: HelpScene = {
  // The whole planet in frame: a designed run is a planet-scale fact. The cards themselves
  // are the candidates page's figure; this one shows what landing a card does to the map.
  stage: { x1: 0, y1: 0, x2: 168, y2: 139, tile: 2.6 },
  run: () => [
    { capKey: 'help.fig.generate_1', move: [84, 70], dur: 1200 },
    { capKey: 'help.fig.generate_2', dur: 800 },
    {
      dur: 300,
      on: ({ world }) => {
        world.beginStroke();
        runDesigned(world, 'island', null);
        world.commit();
      },
    },
    { dur: 500 },
    { capKey: 'help.fig.generate_3', dur: 1600 },
  ],
};

const region: HelpScene = {
  stage: INTERIOR,
  run: ({ view }) => {
    const base = rect(65, 100, 69, 104);
    return [
      { capKey: 'help.fig.region_1', move: [65, 100], pointer: 'marquee', dur: 450 },
      { press: true, dur: 160 },
      {
        move: [69.5, 104.5], dur: 750,
        during: (_ctx, k) => {
          view.region(base.filter((c) => c.x <= 65 + 4 * k + 0.5 && c.y <= 100 + 4 * k + 0.5));
        },
      },
      { press: false, dur: 400 },
      // The region's undo unit is the whole drag: one gesture, one stack entry, all of it back.
      {
        keys: UNDO_KEYS, capKey: 'help.fig.region_2', dur: 900,
        on: () => { view.region(null); },
      },
      { keys: null, move: [65, 100], pointer: 'marquee', dur: 400 },
      { press: true, dur: 160 },
      {
        move: [69.5, 104.5], dur: 600,
        during: (_ctx, k) => {
          view.region(base.filter((c) => c.x <= 65 + 4 * k + 0.5 && c.y <= 100 + 4 * k + 0.5));
        },
      },
      { press: false, dur: 400 },
      // The move keeps the tool's own cursor: the region screen has no grab hand.
      { capKey: 'help.fig.region_3', move: [67, 102], dur: 500 },
      { press: true, dur: 160 },
      {
        move: [72, 103], dur: 800,
        during: (_ctx, k) => {
          const dx = Math.round(5 * k);
          const dy = Math.round(1 * k);
          view.region(base.map((c) => ({ x: c.x + dx, y: c.y + dy })));
        },
      },
      { press: false, dur: 1000 },
    ];
  },
};

const maze: HelpScene = {
  stage: INTERIOR,
  run: ({ world, view }) => {
    // The real region-scoped run: with a region marked, the maze fills that frame.
    const zone = rect(63, 97, 84, 107);
    let walk: MacroCoord[] | null = null;
    const runMaze = (gates?: { entrance?: MacroCoord | null; exit?: MacroCoord | null }) => {
      world.beginStroke();
      const out = generateMaze(world.state, 11, 2, 1, zone, (cmd) => world.executor.execute(cmd), gates);
      world.commit();
      walk = out.walk;
      return out.gates;
    };
    const first = runMaze();
    // A mark's word is read from where the end stands (maze-endpoints): on the maze's own wall it
    // is a hole you pass through (In/Out); anywhere inside it is a destination to reach (To).
    const marksOf = (g: { entrance: MacroCoord | null; exit: MacroCoord | null }, entranceInside = false) => {
      const marks: Array<{ x: number; y: number; labelKey: string }> = [];
      if (g.entrance) marks.push({ x: g.entrance.x, y: g.entrance.y, labelKey: entranceInside ? 'gen.gate_to' : 'gen.gate_in' });
      if (g.exit) marks.push({ x: g.exit.x, y: g.exit.y, labelKey: 'gen.gate_out' });
      return marks;
    };
    const from = first.entrance ?? { x: 64, y: 100 };
    // Strictly interior to the zone, so the dropped end resolves as a destination.
    const dropAt = { x: Math.min(82, from.x + 4), y: Math.min(106, from.y + 3) };
    return [
      { capKey: 'help.fig.maze_1', dur: 900, on: () => { view.marks(marksOf(first)); } },
      { capKey: 'help.fig.maze_2', move: [from.x, from.y], dur: 500 },
      { press: true, pointer: 'hand-closed', dur: 160 },
      {
        move: [dropAt.x, dropAt.y], dur: 700,
        during: (_ctx, k) => {
          const m = marksOf(first);
          if (m[0]) m[0] = { ...m[0], x: from.x + (dropAt.x - from.x) * k, y: from.y + (dropAt.y - from.y) * k };
          view.marks(m);
        },
      },
      {
        press: false, pointer: 'select', dur: 900,
        on: ({ world: w }) => {
          w.undo();
          const gates = runMaze({ entrance: dropAt, exit: first.exit });
          view.marks(marksOf(gates));
        },
      },
      {
        capKey: 'help.fig.maze_3', dur: 900,
        during: (_ctx, k) => {
          if (!walk) return;
          view.route(walk.slice(0, Math.floor(walk.length * k)));
        },
      },
      { dur: 1200 },
    ];
  },
};

const stencil: HelpScene = {
  stage: INTERIOR,
  run: ({ view }) => {
    const box = { origin: { x: 67, y: 97 }, width: 14, height: 10 };
    const regionCells = rect(box.origin.x, box.origin.y, box.origin.x + box.width - 1, box.origin.y + box.height - 1);
    // One chain for the async beats (font decode, then each run), so the water rerun always
    // follows the mountain glyph it replaces.
    let job: Promise<void> = Promise.resolve();
    const runGlyph = (world: DemoWorld, terrain: TerrainType) => {
      job = job.then(async () => {
        const { ensureGlyphFonts, rasterizeText } = await import('../../../../shell/bars/stencil-raster');
        const { TEXT_POOL } = await import('../../../../shell/bars/stencil-samples');
        const { generateTerrain } = await import('../../../../../tools/generation/terrain-generator');
        // The glyph is the shelf's own first sample, so the demo writes what the real pool deals.
        const glyph = TEXT_POOL[0]?.text ?? 'A';
        await ensureGlyphFonts(glyph);
        const st = rasterizeText(glyph, box);
        if (!st) return;
        world.beginStroke();
        generateTerrain({
          algorithm: 'stencil', mode: 'mixed', corridorWidth: 1, maxElevation: 3, seed: 1,
          region: null,
          stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain }, stencil: st, origin: box.origin },
        }, world.state, (cmd) => world.executor.execute(cmd));
        world.commit();
      });
    };
    return [
      { capKey: 'help.fig.stencil_1', dur: 900, on: () => { view.region(regionCells); } },
      {
        capKey: 'help.fig.stencil_2', dur: 400,
        on: ({ world }) => { view.region(null); runGlyph(world, TerrainType.Mountain); },
      },
      { dur: 1300 },
      {
        capKey: 'help.fig.stencil_3', dur: 1500,
        on: ({ world }) => {
          job = job.then(() => { world.undo(); });
          runGlyph(world, TerrainType.Water);
        },
      },
      { dur: 700 },
    ];
  },
};

/* ───────────────────────────── plan ────────────────────────────── */

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
function replaceNote(world: DemoWorld, id: string, patch: Partial<MapAnnotation>): void {
  const items = world.state.annotations!.items;
  const i = items.findIndex((n) => n.id === id);
  if (i >= 0) items[i] = { ...items[i]!, ...patch } as MapAnnotation;
  world.touch();
}

const notes: HelpScene = {
  stage: NOTES_STAGE,
  run: ({ world, view }) => {
    world.place(CABIN, 78, 100);
    world.place(TREE, 66, 110);
    const zoneCells = rect(56, 96, 69, 103);
    const zone: ZoneNote = {
      kind: 'zone', id: generateAnnotationId(), cells: zoneCells,
      color: ANNOTATION_COLORS[0]!, tag: 'homes', num: nextZoneNumber([]), size: 's',
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
      { press: true, dur: 160, on: () => view.annotations({ ...route, points: raw.slice(0, 1) }) },
      { move: [80, 105], dur: 450, during: (_ctx, k) => view.annotations({ ...route, points: raw.slice(0, Math.max(1, Math.round(half * k))) }) },
      { move: [90, 109], dur: 450, during: (_ctx, k) => view.annotations({ ...route, points: raw.slice(0, Math.max(1, half + Math.round((raw.length - half) * k))) }) },
      {
        press: false, dur: 1500,
        on: ({ world: w }) => {
          const points = simplifyPath(raw, 0.35);
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

/* ───────────────────────────── misc ────────────────────────────── */

const faq: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'rect', surface: 'water' },
  run: ({ world }) => {
    world.beginStroke();
    world.paint([{ x: 67, y: 101 }, { x: 71, y: 101 }], TerrainType.Mountain, 1);
    world.commit();
    const capped = row(101, 68, 70);
    const uncapped = [{ x: 72, y: 101 }, { x: 73, y: 101 }];
    return [
      { move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'draw', dur: 500 },
      { press: false, capKey: 'help.fig.faq_1', move: [68, 101], pointer: 'water', dur: 500 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [70, 101], dur: 600, during: stroke(capped, TerrainType.Water, 1) },
      { press: false, dur: 500, on: ({ world: w }) => { w.commit(); } },
      { capKey: 'help.fig.faq_2', move: [72, 101], dur: 500 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [73, 101], dur: 450, during: stroke(uncapped, TerrainType.Water, 1) },
      {
        press: false, realToast: true, capKey: 'help.fig.faq_3', dur: 1600,
        on: ({ world: w }) => { w.commit(); },
      },
      { toastKey: null, dur: 600 },
    ];
  },
};

/* ─────────────── section figures: generate and plan ─────────────── */

/** The scope demo's marked rectangle: open grass south of the plaza, wholly on land. */
const SCOPE_RECT = { x1: 58, y1: 94, x2: 85, y2: 122 } as const;

const scope: HelpScene = {
  // The whole planet in frame, like the lead figure: the point is what the mark does to a
  // planet-scale run — the design is still drawn for the whole planet, and only the piece that
  // falls inside the mark is built.
  stage: { x1: 0, y1: 0, x2: 168, y2: 139, tile: 2.6 },
  run: ({ view }) => {
    const zone = rect(SCOPE_RECT.x1, SCOPE_RECT.y1, SCOPE_RECT.x2, SCOPE_RECT.y2);
    const w = SCOPE_RECT.x2 - SCOPE_RECT.x1;
    const h = SCOPE_RECT.y2 - SCOPE_RECT.y1;
    return [
      { capKey: 'help.fig.scope_1', move: [SCOPE_RECT.x1, SCOPE_RECT.y1], pointer: 'marquee', dur: 700 },
      { press: true, dur: 160 },
      {
        move: [SCOPE_RECT.x2 + 0.5, SCOPE_RECT.y2 + 0.5], dur: 900,
        during: (_ctx, k) => {
          view.region(zone.filter((c) => c.x <= SCOPE_RECT.x1 + w * k + 0.5 && c.y <= SCOPE_RECT.y1 + h * k + 0.5));
        },
      },
      { press: false, pointer: 'select', dur: 500 },
      {
        capKey: 'help.fig.scope_2', dur: 400,
        on: ({ world }) => {
          world.beginStroke();
          runDesigned(world, 'scope', zone);
          world.commit();
          // A landed run takes the scope decal down, exactly as the live shelf does.
          view.region(null);
        },
      },
      { dur: 500 },
      { capKey: 'help.fig.scope_3', dur: 1800 },
    ];
  },
};

const ground: HelpScene = {
  // Deeper south than the shared coast crop: the point is the wash STOPPING, so the frame must
  // show the beach and the open sea the box crosses.
  stage: { x1: 60, y1: 114, x2: 83, y2: 131, tile: 15 },
  run: ({ world, view }) => {
    // The region brush's own eligibility rule: a cell may be scoped only on a buildable zone.
    const takes = (x: number, y: number) => {
      const cell = world.state.cells[y]?.[x];
      return !!cell && isBuildableZone(cell.zone);
    };
    // A box straddling the coast: grass rows on top, then the boundary line, the beach and the sea.
    const box = { x1: 63, y1: 118, x2: 74, y2: 128 };
    const cells = rect(box.x1, box.y1, box.x2, box.y2);
    return [
      { capKey: 'help.fig.ground_1', move: [box.x1, box.y1], pointer: 'marquee', dur: 500 },
      { press: true, dur: 160 },
      {
        move: [box.x2 + 0.5, box.y2 + 0.5], dur: 800,
        during: (_ctx, k) => {
          view.region(cells.filter((c) =>
            c.x <= box.x1 + (box.x2 - box.x1) * k + 0.5
            && c.y <= box.y1 + (box.y2 - box.y1) * k + 0.5
            && takes(c.x, c.y)));
        },
      },
      { press: false, pointer: 'select', dur: 800 },
      { capKey: 'help.fig.ground_2', move: [69, 129.5], dur: 600 },
      { press: true, dur: 200 },
      { press: false, dur: 1300 },
    ];
  },
};

/** The corridor-width pair: one recipe, one zone, the width knob the only difference. */
function mazeWidth(corridorWidth: number): HelpScene {
  return {
    // Small tiles so the pair stands side by side inside the page column.
    stage: { x1: 63, y1: 96, x2: 84, y2: 108, tile: 12 },
    run: ({ world, view }) => {
      const zone = rect(64, 97, 83, 107);
      world.beginStroke();
      const out = generateMaze(world.state, 11, 2, corridorWidth, zone, (cmd) => world.executor.execute(cmd));
      world.commit();
      const walk = out.walk;
      return [
        { dur: 900 },
        {
          dur: 1100,
          during: (_ctx, k) => {
            if (walk) view.route(walk.slice(0, Math.floor(walk.length * k)));
          },
        },
        { dur: 1400 },
      ];
    },
  };
}

const mazew1 = mazeWidth(1);
const mazew2 = mazeWidth(2);

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
      color: ANNOTATION_COLORS[0]!, tag: 'homes', num: nextZoneNumber([]), size: 's',
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
      color: ANNOTATION_COLORS[0]!, tag: 'homes', num: nextZoneNumber([]), size: 's',
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
      { move: [67, 101], dur: 600, during: (_ctx, k) => { replaceNote(world, zone.id, { cells: removeZoneCells(grown, reveal(bite, k)) }); view.annotations(); } },
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
      { move: [78, 104], dur: 1000, during: (_ctx, k) => view.annotations({ ...note, points: resizeMeasurement(note.points, 1, { x: 59 + Math.round(19 * k), y: 104 }) }) },
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
      { press: true, dur: 160, on: () => view.annotations({ ...route, points: raw.slice(0, 1) }) },
      { move: [72, 104], dur: 500, during: (_ctx, k) => view.annotations({ ...route, points: raw.slice(0, Math.max(1, Math.round(half * k))) }) },
      { move: [88, 110], dur: 500, during: (_ctx, k) => view.annotations({ ...route, points: raw.slice(0, Math.max(1, half + Math.round((raw.length - half) * k))) }) },
      {
        press: false, capKey: 'help.fig.noteroute_2', dur: 1500,
        on: () => {
          const points = simplifyPath(raw, 0.35);
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
      color: ANNOTATION_COLORS[0]!, tag: 'homes', num: 1, size: 's',
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

export const HELP_SCENES: Record<string, HelpScene> = {
  welcome, camera, terrain, trim, objects, select,
  brushfree, brushwidth, eraseline, lineridge, curvebank, rectpad, circlepond, autotrim,
  water, road, roadtrim, trimmulti, trimnotch, rotate, ramp, spacing, smartpatch, grouprotate,
  locked, delight,
  smart1, smart2, stream, generate, region, maze, stencil,
  notes, notezone, notegrow, measurement, noteroute, noteselect, undo, load, faq,
  scope, ground, mazew1, mazew2, notetext,
};
