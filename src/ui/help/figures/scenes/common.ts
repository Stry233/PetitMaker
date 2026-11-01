/** What the Help Center's scenes are written in: the scene and view types, the world helpers they
 *  share, the catalog items they place, and the crops of Hexia they frame. */
import { TerrainType, type MacroCoord, type Rotation } from '../../../../core/model/types';
import { gridCellCentre } from '../../../../core/grid/grids';
import { ToolType } from '../../../../state/editing/vocabulary';
import type { ToolArming } from '../../../../state/editing/arming';
import { CONTENT_GRID } from '../../../../state/editing/edit-mode';
import type { CursorId } from '../../../../assets/cursors/cursor-spec';
import type { GroupRotation } from '../../../../tools/objects';
import type { TokenSpec } from '../../hints/catalogue';
import { SandboxWorld, type SandboxNotice } from '../../../../editor/sandbox/demo-world';
import type { MazeEnds } from '../../../shell/bars/generate/MazeEndpoints';
import { GRIDS } from '../../../../core/game/profile';
import type { Translate, TextKey } from '../../../../i18n/keys';

/** The template rect a scene's view frames, and how many CSS px a cell takes. */
export interface Stage { x1: number; y1: number; x2: number; y2: number; tile: number }

/** A rect of template cells, both corners included. */
export interface Plot { x1: number; y1: number; x2: number; y2: number }

/**
 * What a scene may show beyond the map itself. The player implements this over the app's own
 * overlay layer (plus DOM for the two pieces the overlay does not carry: gate pills, the load
 * disc); the headless proof suite implements it as a recorder. Coordinates are template cells.
 */
export interface DemoView {
  clearGhost(): void;
  /** The real group-drag preview (a lifted set following the pointer). */
  groupGhost(members: Array<{ catalogId: string; x: number; y: number; rotation: number; elevation: number }>): void;
  /** The live brush ghost over stroke cells, exactly as a shape tool previews before release:
   *  the overlay's own cell wash with the surface's own card. `null` clears. */
  paintGhost(cells: MacroCoord[] | null, icon?: 'mountain' | 'water' | 'ground'): void;
  /** The real generation-region tint (white at 12%), or null to clear. */
  region(cells: MacroCoord[] | null): void;
  /** The real maze-walk gold, or null to clear. */
  route(cells: MacroCoord[] | null): void;
  /** The maze's end marks, as the shelf stands them over a landed run (`MazeEndpoints`); null clears. */
  marks(ends: MazeEnds | null): void;
  /** Stand the top-right load meter over the figure's map, reading the region under the pictured
   *  pointer as the live meter reads the one under the mouse; false puts it away. */
  loadMeter(on: boolean): void;
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
  /** Stand `notice` as the app's toast, in its tone, or take the toast down for null. A recorder may
   *  leave it out. */
  notice?(notice: SandboxNotice | null): void;
  /** Redraw the world's plan notes through the real annotation layer, with the notes tool's own
   *  draft and selection; the player's view also redraws on every change the world reports. */
  annotations(): void;
}

export interface DemoCtx { world: SandboxWorld; view: DemoView }

export interface SceneStep {
  dur?: number;
  /** Cursor glide target: template cell coords (a cell's center is x.0), a card of the scene's
   *  shelf strip by index, or the centre of a control the figure pictures over its map (the
   *  selection card's buttons, touch multi-select's) by its test id. */
  move?: [number, number] | { strip: number } | { control: string };
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
  /** A second fingertip at these template cells, for a two-finger beat in a touch reader's figure
   *  (a pinch, a two-finger tap); `null` lifts it. A mouse reader's figure ignores it. */
  second?: [number, number] | null;
  on?: (ctx: DemoCtx) => void;
  during?: (ctx: DemoCtx, k: number) => void;
}

export type Resolver = Translate;

/** A slice of real interface standing beside the map (`figures/previews/strips.tsx`). */
type StripSpec =
  | { kind: 'tools'; active: string; surface?: 'mountain' | 'water' | 'road' }
  /** `smart: true` stands the category's smart-planting card at the row's start, the way the
   *  live shelf leads its trees and plants tabs; it is strip index 0, and the items follow. */
  | { kind: 'shelf'; items: readonly string[]; smart?: boolean };

/** The reader's form a scene plays for: in touch mode the player draws fingertips and no key chips,
 *  and a scene whose gesture differs by finger (a modifier key, the wheel) steps the touch gesture
 *  instead; upright, the reader sees the upright shell. */
export interface SceneForm { touch: boolean; upright: boolean }

export interface HelpScene {
  /** Template id; Hexia unless a scene says otherwise. */
  template?: string;
  stage: Stage;
  /** The cells the scene acts on. Given, the scene plays inside a built neighbourhood
   *  (`scenes/context.ts:sceneWorld`) with this plot cleared back to the template; absent, on the
   *  template itself. */
  plot?: Plot;
  /** The scene lays only notes, so it plays on the neighbourhood as it stands, nothing cleared. */
  notesOnly?: true;
  strip?: StripSpec;
  run: (ctx: DemoCtx, t: Resolver, form: SceneForm) => SceneStep[];
}

export const UNDO_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'history.undo' }];
export const PAN_HOLD_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'camera.pan_drag', held: true }];
/** The held constrain command (Shift unless rebound), which snaps a shape drag straight or round. */
const CONSTRAIN_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'tool.constrain', held: true }];
/** The held multi-select command (Ctrl unless rebound). */
export const CTRL_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.multi', held: true }];
export const ROTATE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.rotate_cw' }];
export const DELETE_KEYS: readonly TokenSpec[] = [{ kind: 'cmd', id: 'selection.delete' }];

/** The player's glide: how far along its move the pointer stands at step progress `k`. */
export function ease(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
}

/** Pick a tool for the scene, as a press on its bar cell does: the world's live tool set armed with
 *  `arming` over the editor's initial arming. */
export function pickTool({ world }: DemoCtx, arming: Partial<ToolArming>): void {
  world.pick(arming);
}

/** The terrain brush drawing `shape` on `surface`, at `brushSize` when a beat poses one. */
export function brushArming(shape: ToolArming['shape'], surface: ToolArming['contentType'] = 'mountain', brushSize?: number): Partial<ToolArming> {
  return { tool: ToolType.TerrainBrush, shape, contentType: surface, ...(brushSize === undefined ? {} : { brushSize }) };
}

/** Smart Build's tool with macro `id` armed, as a press on its card arms it, at `brushSize` when a
 *  beat poses the bar's width. */
export function macroArming(id: string, brushSize?: number): Partial<ToolArming> {
  return { tool: ToolType.Macro, armedMacro: id, ...(brushSize === undefined ? {} : { brushSize }) };
}

/** `step` with the world's clock running through it: its `dur` passes on the world's clock as the
 *  player plays the step, so a held Smart Build press bursts on the player's own time. */
export function timed(step: SceneStep): SceneStep {
  const { dur } = step;
  if (dur === undefined) throw new Error('A timed step names its duration');
  let passed = 0;
  return {
    ...step,
    during: (ctx, k) => {
      step.during?.(ctx, k);
      const now = k * dur;
      ctx.world.advance(now - passed);
      passed = now;
    },
  };
}

/** The terrain eraser, freehand. */
export const ERASER: Partial<ToolArming> = { tool: ToolType.Eraser, eraserShape: 'free', contentType: 'mountain' };
/** The manual corner trim. */
export const TRIM: Partial<ToolArming> = { tool: ToolType.EdgeCut };

/**
 * The pictured pointer driving the world's picked tool. Each step it writes glides the pointer the
 * way the player does (`ease`) and hands the tool the map points it passes, so what a figure lays
 * is what the tool lays under that path. Points are template cells (a terrain cell's centre is x.0,
 * which is a placement cell's corner); a step's other fields ride along in `extra`.
 *
 * A hand `onMap` presses the map as the live map does (`SandboxWorld.pressMap`): the press rule
 * decides whether it selects, bands, drags the selection, opens the long-press menu or reaches the
 * tool, so a figure's selection is the editor's own.
 */
export class Hand {
  /** Where the pointer stands on the map; null while it is off the map, on the strip. */
  private at: MacroCoord | null = null;

  constructor(private readonly form: SceneForm, private readonly onMap = false) {}

  /** Glide to (x, y) between beats, the tool hearing nothing. */
  glide(x: number, y: number, extra: SceneStep = {}): SceneStep {
    this.at = { x, y };
    return { ...extra, move: [x, y] };
  }

  /** Glide to card `i` of the strip, off the map. */
  strip(i: number, extra: SceneStep = {}): SceneStep {
    this.at = null;
    return { ...extra, move: { strip: i } };
  }

  /** Glide to the pictured control `testId` over the map, off the map itself (`SceneStep.move`). */
  control(testId: string, extra: SceneStep = {}): SceneStep {
    this.at = null;
    return { ...extra, move: { control: testId } };
  }

  /** Glide to (x, y) with no button down: a mouse reports the hover to the tool, which previews from
   *  it (a curve runs on to the pointer); a finger off the glass reports nothing. */
  hover(x: number, y: number, extra: SceneStep = {}): SceneStep {
    if (!this.form.touch) return this.travel(x, y, extra);
    return this.glide(x, y, extra);
  }

  /** Press where the pointer stands. */
  press(extra: SceneStep = {}): SceneStep {
    const at = this.here();
    const down = (ctx: DemoCtx) => (this.onMap ? ctx.world.pressMap(at, this.form.touch) : ctx.world.pointerDown(at));
    return { ...extra, press: true, on: (ctx) => { extra.on?.(ctx); down(ctx); } };
  }

  /** Press where the pointer stands and hold it past the hold time, which a finger's press runs as
   *  its hold (the long-press menu); release it with `release`. */
  hold(extra: SceneStep = {}): SceneStep {
    const step = this.press(extra);
    return { ...step, during: (ctx, k) => { extra.during?.(ctx, k); if (k >= 1) ctx.world.holdMap(); } };
  }

  /** Glide to (x, y) with the button down, the tool hearing every point on the way. */
  drag(x: number, y: number, extra: SceneStep = {}): SceneStep {
    return this.travel(x, y, extra);
  }

  /** Release where the pointer stands. */
  release(extra: SceneStep = {}): SceneStep {
    const at = this.here();
    const up = (ctx: DemoCtx) => (this.onMap ? ctx.world.releaseMap(at) : ctx.world.pointerUp(at));
    return { ...extra, press: false, on: (ctx) => { up(ctx); extra.on?.(ctx); } };
  }

  /** A press and its release where the pointer stands, each beat its own step. */
  tap(down: SceneStep = {}, up: SceneStep = {}): SceneStep[] {
    return [this.press(down), this.release(up)];
  }

  /** Glide to (x, y), handing every point on the way to `reach` rather than to the tool: a press on
   *  something above the map (a curve handle) that moves it. */
  carry(x: number, y: number, reach: (ctx: DemoCtx, at: MacroCoord) => void, extra: SceneStep = {}): SceneStep {
    return this.travel(x, y, extra, reach);
  }

  /** Where the pointer stands. */
  here(): MacroCoord {
    if (!this.at) throw new Error('The pointer is off the map');
    return this.at;
  }

  private travel(
    x: number, y: number, extra: SceneStep,
    reach: (ctx: DemoCtx, at: MacroCoord) => void = (ctx, at) => (this.onMap ? ctx.world.moveMap(at) : ctx.world.pointerMove(at)),
  ): SceneStep {
    const from = this.at;
    const to = { x, y };
    this.at = to;
    return {
      ...extra,
      move: [x, y],
      during: (ctx, k) => {
        const e = ease(k);
        // From the strip the pointer crosses no map point the scene knows, so the map hears only its arrival.
        if (from) reach(ctx, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
        else if (k >= 1) reach(ctx, to);
        extra.during?.(ctx, k);
      },
    };
  }
}

/** The constrain command held (`on`) or let go through a shape drag, for a step's own fields: its
 *  key chip and the held state the tool reads. A finger has no key to hold, so a touch reader's
 *  figure drags the shape straight unaided. */
export function constrainHeld(form: SceneForm, on: boolean): Pick<SceneStep, 'keys' | 'on'> {
  if (form.touch) return {};
  return { keys: on ? CONSTRAIN_KEYS : null, on: ({ world }) => { world.held.constrain = on; } };
}

/**
 * The free brush dragged through `cells` in order as `k` advances: the first call presses the
 * world's live brush, armed with `arming`, at the first cell's centre unless a press is already
 * down, and every call moves it on to the cell `k` has reached. The release is
 * `SandboxWorld.commit`.
 */
function brushThrough(cells: readonly MacroCoord[], arming: Partial<ToolArming>) {
  const grid = GRIDS[CONTENT_GRID[arming.contentType ?? 'mountain']];
  let done = 0;
  return ({ world }: DemoCtx, k: number) => {
    const first = cells[0];
    if (!first) return;
    if (!world.pressing) {
      world.pick({ ...arming, tool: ToolType.TerrainBrush, shape: 'free' });
      world.pointerDown(gridCellCentre(grid, first));
      done = 1;
    }
    const reached = Math.min(cells.length, Math.max(1, Math.ceil(k * cells.length - 1e-6)));
    for (; done < reached; done++) world.pointerMove(gridCellCentre(grid, cells[done]!));
  };
}

/** The free brush laying `type` through `cells` with layer `floor` picked in the layer panel
 *  (`brushThrough`), which pins it: water lays at that layer where it can stand. */
export function stroke(cells: MacroCoord[], type: TerrainType, floor = 1) {
  return brushThrough(cells, { contentType: type === TerrainType.Water ? 'water' : 'mountain', floor, layerPinned: true });
}

/** The road brush laying `catalogId` through `cells` (`brushThrough`): each cell takes its paver as
 *  the live road brush lays it, and the release trims the street's corners. */
export function coatStroke(cells: MacroCoord[], catalogId: string) {
  return brushThrough(cells, { contentType: 'road', tileMaterial: catalogId, tileMaterialPicked: true });
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

/** Arm catalog item `catalogId` in the placer, as a press on its shelf card arms it. */
export function armItem({ world }: DemoCtx, catalogId: string): void {
  world.pick({ tool: ToolType.ObjectPlacer, armedItem: catalogId, picks: [catalogId] });
}

/** Put the armed card down, as a second press on it does: the map's select mode is back. */
export function putDown({ world }: DemoCtx): void {
  world.pick({});
}

/** The scene's world back to a fresh session, its feedback played on the scene's view. */
export function freshSession({ world, view }: DemoCtx): void {
  world.restart(view);
}

/** Show the notice the verb just said (`SandboxWorld.notice`), as the live verb toasts it, or none. */
export function sayNotice({ world, view }: DemoCtx): void {
  view.notice?.(world.notice);
}

/**
 * The armed placer aimed through `path` and placed at its end. A mouse hovers each point, the
 * tool's ghost following, and clicks at the last. A finger has no hover: on one point it taps; on
 * several it lands on the first and drags through the rest, the drag carrying the item's preview
 * (`press-plan.ts` `preview-placement`), and lifts to drop it, one press and release of the tool
 * (`carry.ts:dropAt`). `down` and `up` ride on the press and the release.
 */
export function placeThrough(
  hand: Hand, form: SceneForm, path: ReadonlyArray<readonly [number, number, SceneStep?]>, down: SceneStep = {}, up: SceneStep = {},
): SceneStep[] {
  if (!form.touch) return [...path.map(([x, y, extra]) => hand.hover(x, y, extra)), ...hand.tap(down, up)];
  const [first, ...rest] = path;
  if (!first) return [];
  if (rest.length === 0) return [hand.glide(first[0], first[1], first[2]), ...hand.tap(down, up)];
  return [
    hand.glide(first[0], first[1], first[2]),
    hand.press({ dur: 200 }),
    ...rest.map(([x, y, extra], i) => hand.drag(x, y, i === rest.length - 1 ? { ...down, ...extra, press: true } : extra)),
    hand.release(up),
  ];
}

/** One click of the corner trim at map point (x, y), the vertex whose corners it cycles, for ground
 *  a scene dresses before it picks its own tool. */
export function trimAt(ctx: DemoCtx, x: number, y: number): void {
  pickTool(ctx, TRIM);
  ctx.world.click({ x, y });
}
