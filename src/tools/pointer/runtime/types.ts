import type { MacroCoord, Command, ValidationError } from '../../../core/model/types';
import type { CommandSink } from '../../../core/model/command-sink';
import type { ToolType } from '../../../state/editing/vocabulary';
import type { Translate } from '../../../i18n/keys';
import type { ToolArming } from '../../../state/editing/arming';
import type { GridCell, GridId, MapPoint } from '../../../core/grid/grids';
import type { Rect } from '../../../core/grid/rect';
import type { ToolOverlay, ViewProjection } from './view-seam';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import type { Stroke } from '../../../core/commands/command-executor';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';

/** Whether the held modifier commands are down, read at the moment a tool asks. Constrain snaps a
 *  shape drag straight, square or round; multi-select turns a click into a membership toggle. */
export interface ToolModifiers {
  readonly constrain: boolean;
  readonly multiSelect: boolean;
}

/** How a tool's message reads: a refusal is a warning, a note on what a build did is info. */
export type NoticeTone = 'error' | 'info' | 'warning';

/**
 * The editor as a tool reaches it: the map, the command doors, the view on screen and the channels
 * a tool speaks through, built by `host.ts:createToolHost`. `viewport` and `overlay` read the view
 * on screen at each access, so a tool holding the host draws in the view a 2D/3D switch brings up;
 * every other member stays the same for the host's life.
 */
export interface ToolHost extends CommandSink {
  /** Null on a host with no view on screen (the Help figures, a headless test). */
  readonly viewport: ViewProjection | null;
  readonly overlay: ToolOverlay;
  /** Begin a stroke group at the current history depth: a gesture's commands commit, roll back or
   *  fold into one undo step through the handle. */
  beginStroke: () => Stroke;
  validateCommand: (cmd: Command) => ValidationError[];
  /** The pre-command rules themselves, for asking about a hypothetical grid rather than the live
   *  one: the auto-trim ghost runs the trim pass over a scratch copy before the click.
   *  `validateCommand` is this bound to `state` and the open stroke. */
  registry: RuleDispatcher;
  /** How many entries the undo history holds, for a tool that notices history moving under it. */
  historyDepth: () => number;
  t: Translate;
  /** Show a message the way every surface does: a toast in the app. */
  notify: (text: string, tone: NoticeTone) => void;
  modifiers: ToolModifiers;
  /** Set the layer-panel highlight while auto-stacking (null → follow the
   *  selected layer). Does not change the build floor (ctx.elevation). */
  setDisplayLayer: (layer: number | null) => void;
  /** Trigger a placement "plop" (squash + dust) on a freshly point-placed object once its sprite
   *  exists; no-op for bulk adds and without a view. */
  plopObject: (id: string) => void;
  /** A ground stroke asked for cells beyond the canvas edge, the planet's size limit. Omitted where
   *  nothing presents it. */
  reportGroundClipped?: () => void;
}

export interface ToolContext extends ToolHost {
  /** The map point under the pointer, in cells and unrounded (`ViewProjection.screenToPoint`), and
   *  the on-screen size of a cell there in css px, both written by `pointer.ts:resolvePointer` for
   *  the same screen point immediately before a tool method runs. A half-step item's ghost and
   *  click read the point's half-cell sub-position, a freehand note line the point itself.
   *  Undefined in a headless context, where such readers fall back to the whole cell. */
  point?: MapPoint;
  cellPixels?: number;
  /** Undefined uses planar caption tests; null is a rendered-label miss. */
  annotationLabelHit?: string | null;
  /** The timestamp (`Event.timeStamp`, on the `performance.now()` clock) of the pointer event the
   *  call answers; undefined where no event carries one, and readers then take the current time. */
  eventTime?: number;

  /** What the bar has armed (`state/editing/arming.ts:armingOf`), replaced with a fresh snapshot
   *  before each tool call. A curve's adjust phase keeps the snapshot it was drawn with. */
  arming: ToolArming;
}

/** A tool whose pointer cells lie on grid `G` (a tool that switches grid with its arming is a `Tool<GridId>`),
 *  called with `C`: the base context plus the host channels it reads (`host.ts:ToolChannels`). */
export interface Tool<G extends GridId = GridId, C extends ToolContext = ToolContext> {
  id: ToolType;
  /** The grid the tool's pointer cells lie on, read only from what it is armed with, so a caller
   *  holding the store's arming asks it without a live context (`tool-set.ts:toolDeclares`). */
  grid(ctx: Pick<C, 'arming'>): G;
  /** Which cursor, not a CSS value: the view layer owns the CSS (ui/design/cursors). Read from
   *  what is armed (the brush's surface, the placer's `place` vs `select`) through
   *  `ToolManager.getActiveCursor()`, which refreshes the context first. */
  cursor(ctx: C): CursorId;
  /**
   * False when acting on this cell would be refused, so the cursor can say so before the
   * click instead of the error flash saying it after. Optional: a tool that cannot answer
   * cheaply omits it and keeps its plain cursor. Must not mutate state.
   */
  canActAt?(cell: GridCell<G>, ctx: C): boolean;
  /**
   * A multi-click gesture in progress (the curve's chain of anchors) that has painted nothing yet.
   * Escape abandons it and Delete takes back its last step, so those keys reach the pending gesture
   * before they reach the selection. Both return whether there was something pending, which is how
   * the keyboard command knows not to fall through. Tools with no such gesture omit them.
   */
  cancelPending?(ctx: C): boolean;
  undoPendingStep?(ctx: C): boolean;
  /** Whether a multi-tap gesture is standing, for a nav tap to end it
   *  (`view/interaction/press/press-plan.ts:resolveNavTap`): a right press that never moved is the
   *  one press with no camera meaning. Takes the context because a pending gesture can live in the
   *  store (the annotate tool's route draft, which the bar can clear without this tool hearing).
   *  Tools with no such gesture omit the hook. */
  hasPending?(ctx: C): boolean;
  /** Whether a plain press here picks up something the tool itself owns, so the drag that follows
   *  moves it (the annotate select state grabbing a note). The machine mirrors an object drag's
   *  cursor while such a drag lasts, and the press-plan keeps the camera off it; where the answer
   *  is no, a bare left drag falls to the camera the way an empty-handed mode pans. */
  grabAt?(coord: MacroCoord, ctx: C): boolean;
  /** Whether the tool is standing in its own select state: its presses pick, toggle and drag
   *  things the tool owns rather than painting. The press-plan gives such a state the map select
   *  mode's own modifier grammar — Ctrl toggles on press and a Ctrl drag is a band. */
  selects?(ctx: C): boolean;
  /** What the tool's select state finds under the pointer, and whether it is already a member of
   *  the tool's own selection — the facts behind the modifier cursor's add/remove badge. */
  selectHit?(coord: MacroCoord, ctx: C): { id: string; selected: boolean } | null;
  /** The tool's own band: adds what `rect` (placement-grid cells) covers to the tool's selection.
   *  A tool with a select state implements it; without it the band selects map objects. */
  bandSelect?(rect: Rect, ctx: C): void;
  /** Whether an unmodified click selects whatever is under it and a press on the selection arms
   *  its drag, the map's select mode (the Hand tool, the placer with nothing armed). */
  selectMode?(arming: ToolArming): boolean;
  /** Whether the press here is a click that uses no drag, so a hand that then pulls is asking to
   *  move the map rather than the tool. */
  clickOnly?(coord: MacroCoord, ctx: C): boolean;
  /** `cell` lies on `grid(ctx)`; `point` is the map point it was resolved from. */
  onPointerDown(cell: GridCell<G>, point: MapPoint, ctx: C): void;
  onPointerMove(cell: GridCell<G>, point: MapPoint, ctx: C): void;
  onPointerUp(cell: GridCell<G>, point: MapPoint, ctx: C): void;
  /** Stop asynchronous stroke work when the browser cancels input or touch becomes navigation. */
  onPointerCancel?(ctx: C): void;
  onActivate(ctx: C): void;
  onDeactivate(ctx: C): void;
}