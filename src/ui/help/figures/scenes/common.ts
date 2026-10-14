/** What the Help Center's scenes are written in: the scene and view types, the world helpers they
 *  share, the catalog items they place, and the crops of Hexia they frame. */
import { trimTerrainCommand } from '../../../../core/model/command-build';
import { TerrainType, type Corners, type MacroCoord, type TrimCornersCommand, type Rotation } from '../../../../core/model/types';
import { OUTER_TRI } from '../../../../core/domain/edge-cut/cut-validator';
import { SQUARE_CORNERS, copyCorners } from '../../../../core/model/corners';
import type { CursorId } from '../../../../assets/cursors/cursor-spec';
import { getMapStats } from '../../../../state/map-stats';
import { chunkKey } from '../../../../core/grid/rect';
import { mapChunkAt } from '../../../../core/grid/map-chunks';
import type { GroupRotation } from '../../../../tools/objects';
import type { CurveAnchor } from '../../../../core/base/spline';
import type { MapAnnotation } from '../../../../core/model/annotations';
import type { TokenSpec } from '../../hints/catalogue';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { CHUNK_LOAD_LIMIT } from '../../../../core/game/profile';
import type { Translate, TextKey } from '../../../../i18n/keys';

/** The template rect a scene's view frames, and how many CSS px a cell takes. */
export interface Stage { x1: number; y1: number; x2: number; y2: number; tile: number }

/**
 * What a scene may show beyond the map itself. The player implements this over the app's own
 * overlay layer (plus DOM for the two pieces the overlay does not carry: gate pills, the load
 * disc); the headless proof suite implements it as a recorder. Coordinates are template cells.
 */
export interface DemoView {
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
  marks(marks: Array<{ x: number; y: number; labelKey: TextKey }>): void;
  /** Load disc fill 0..1; negative hides it. */
  gauge(v: number): void;
  /** The object layer's own placement squash for the object about to land. */
  plop(id: string): void;
  /** The object layer's own removal poof, called before the remove executes. */
  poof(id: string): void;
  /** The object layer's own rotation tween, called after the rotate landed: a rotate is a
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

export interface DemoCtx { world: SandboxWorld; view: DemoView }

export interface SceneStep {
  dur?: number;
  /** Cursor glide target: template cell coords (a cell's center is x.0), or a card of the scene's
   *  shelf strip by index. */
  move?: [number, number] | { strip: number };
  pointer?: CursorId;
  press?: boolean;
  /** Arm or clear the follow-ghost: the real placement preview rides the cursor, validity asked of
   *  the rules at every cell it crosses, exactly as a picked-up card behaves. `null` clears. */
  follow?: { catalogId: string; rotation?: Rotation } | null;
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
  capKey?: TextKey | null;
  toastKey?: TextKey | null;
  /** Params for `toastKey` (a real app string may carry tokens). */
  toastParams?: Record<string, string | number>;
  /** Show the world's own last refusal as the toast (read after `on` runs). */
  realToast?: boolean;
  /** Camera against the stage frame: offset in cells and a zoom factor (1 = the stage fit). */
  cam?: Partial<{ dx: number; dy: number; z: number }>;
  on?: (ctx: DemoCtx) => void;
  during?: (ctx: DemoCtx, k: number) => void;
}

export type Resolver = Translate;

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

export const UNDO_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'history.undo' }];
export const PAN_HOLD_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'camera.pan_drag', held: true }];
export const SHIFT_KEYS: readonly TokenSpec[] = [{ kind: 'key', label: 'Shift' }];
export const CTRL_KEYS: readonly TokenSpec[] = [{ kind: 'key', label: 'Ctrl' }];
export const ROTATE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.rotate_cw' }];
export const DELETE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.delete' }];

/** Progressive stroke: paints `cells` one by one as `k` advances, each exactly once. */
export function stroke(cells: MacroCoord[], type: TerrainType, elevation: number) {
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const n = Math.min(cells.length, Math.floor(k * cells.length + 1e-6));
    for (; done < n; done++) world.paint([cells[done]!], type, elevation);
    if (k >= 1) for (; done < cells.length; done++) world.paint([cells[done]!], type, elevation);
  };
}

/** Progressive coating stroke: lays one `catalogId` object per cell as `k` advances, the way the
 *  paving brush places a coating under each cell it crosses. */
export function coatStroke(cells: MacroCoord[], catalogId: string) {
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const n = Math.min(cells.length, Math.floor(k * cells.length + 1e-6));
    for (; done < n; done++) world.place(catalogId, cells[done]!.x, cells[done]!.y);
    if (k >= 1) for (; done < cells.length; done++) world.place(catalogId, cells[done]!.x, cells[done]!.y);
  };
}

/** One eraser dab: peels exactly one terrain layer at `c`, the same command the live eraser issues
 *  per cell it crosses. */
export function eraseCell(world: SandboxWorld, c: MacroCoord, waterEraser: boolean): void {
  world.peel(c, waterEraser);
}

/** Progressive eraser drag: peels one cell's top layer per cell in `cells`, in order, as `k`
 *  advances — a second pass over the same cells (a fresh call) peels the layer under that. */
export function eraseStroke(cells: MacroCoord[], convertWater: boolean) {
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const n = Math.min(cells.length, Math.floor(k * cells.length + 1e-6));
    for (; done < n; done++) eraseCell(world, cells[done]!, convertWater);
    if (k >= 1) for (; done < cells.length; done++) eraseCell(world, cells[done]!, convertWater);
  };
}

export function row(y: number, x0: number, x1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

export function column(x: number, y0: number, y1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) cells.push({ x, y });
  return cells;
}

export function rect(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}


/** The real load reading for the chunk under (x, y): the meter's own formula. */
export function chunkFill(world: SandboxWorld, x: number, y: number): number {
  const { cx, cy } = mapChunkAt(world.state.template, x, y);
  const key = chunkKey(cx, cy);
  const load = getMapStats(world.state).chunks.get(key)?.load ?? 0;
  return Math.min(1, load / CHUNK_LOAD_LIMIT);
}

export const CABIN = 'building-forest-cabin';
export const CABIN2 = 'building-sunset-cabin';
export const TREE = 'tree-apple';
export const FLOWER = 'flower-daisy';
export const BRIDGE = 'bridge-plank';
export const RAMP = 'ramp-park-steps';
export const ROAD_TILE = 'path-cobblestone';

/* The two press seeds the set-piece roll answers with a shape (`delights.ts:delightRoll`), pinned
 * here so the delight figure shows the pieces themselves. */
export const RING_SEED = 13;
export const HEART_SEED = 43;

/* Stages on Hexia. The interior is open grass south of the plaza; the south coast crop holds
 * grass rows over the boundary line, the beach ring and open sea. */
export const INTERIOR: Stage = { x1: 62, y1: 96, x2: 85, y2: 108, tile: 17 };
export const COAST: Stage = { x1: 60, y1: 114, x2: 83, y2: 126, tile: 17 };
export const PLAZA_EDGE: Stage = { x1: 72, y1: 86, x2: 95, y2: 98, tile: 17 };

/** One corner trim, as the trim tool issues it, from the cell's own corners. */
export function trimCmd(world: SandboxWorld, x: number, y: number, cornerIdx: number, digit: 0 | 1 | 2): TrimCornersCommand {
  const cell = world.state.cells[y]?.[x]?.terrain;
  const before = cell?.corners ? copyCorners(cell.corners) : undefined;
  const next: Corners = before ? [...before] : [...SQUARE_CORNERS];
  next[cornerIdx] = digit === 1 ? 'fan' : digit === 2 ? OUTER_TRI[cornerIdx]! : 'square';
  return trimTerrainCommand(x, y, next);
}
