/*
 * The pointer gestures the brushes share, as state machines over cells: the curve's anchor chain
 * and the drag-out shape. A tool feeds them its presses and draws what they hold; the map is never
 * touched here.
 */
import type { MacroCoord } from '../../../core/model/types';
import type { RowSpan } from '../../../core/grid/cell-spans';
import type { CurveAnchor } from '../../../core/base/spline';
import {
  brushCells, dragShapeCells, dragShapeSpans, expandLine, line4, snapShapeEnd, splineCells, type DragShapeKind,
} from '../../../core/grid/shapes';
import type { BuildShape } from '../../../state/editing/vocabulary';

/** Two clicks on one cell whose releases fall inside this window finish a chain. */
const CHAIN_DOUBLE_CLICK_MS = 400;

const same = (a: MacroCoord, b: MacroCoord): boolean => a.x === b.x && a.y === b.y;

/** What a release did to the chain: finished it (the caller lays `points`), or left it standing. */
export type ChainRelease = 'finish' | 'standing';

/**
 * A chain of anchors a curve runs through. A press drops an anchor, or picks up one already placed
 * (a drag moves it; a press that never travels is still a click); a press dragged out from the
 * first anchor drops the second where it lands; two clicks on one cell finish the chain once it has
 * two anchors.
 */
export class AnchorChain {
  private anchors: CurveAnchor[] = [];
  private dragIndex: number | null = null;
  private dragMoved = false;
  /** Whether the press in progress dropped the newest anchor, which a cancelled press takes back. */
  private pressAdded = false;
  /** The last click (a press that did not become a drag), for the double-click test. */
  private lastClick: { at: MacroCoord; time: number } | null = null;

  /** `now` stands in for a release's own time when the caller has none. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  get points(): readonly CurveAnchor[] { return this.anchors; }
  get length(): number { return this.anchors.length; }
  /** Whether the press in progress holds a placed anchor. */
  get dragging(): boolean { return this.dragIndex !== null; }

  down(at: MacroCoord): void {
    const hit = this.anchors.findIndex((a) => same(a, at));
    if (hit >= 0) {
      // A press on an anchor must not stack a second one on the same cell; whether it drags or
      // clicks is known only on release.
      this.dragIndex = hit;
      this.dragMoved = false;
      return;
    }
    this.anchors.push({ x: at.x, y: at.y });
    this.pressAdded = true;
  }

  /** Moves a held anchor to `at`; false when no anchor is held. */
  move(at: MacroCoord): boolean {
    if (this.dragIndex === null) return false;
    if (!same(this.anchors[this.dragIndex]!, at)) this.dragMoved = true;
    this.anchors[this.dragIndex] = { x: at.x, y: at.y };
    return true;
  }

  /** `time` is the release event's timestamp (`Event.timeStamp`), so a handler that runs late on a
   *  busy device does not stretch the gap between two taps past the window. */
  up(at: MacroCoord, time: number = this.now()): ChainRelease {
    this.pressAdded = false;
    const first = this.anchors[0];
    if (this.anchors.length === 1 && first && !same(first, at)) {
      this.anchors.push({ x: at.x, y: at.y });
      this.lastClick = null;
      return 'standing';
    }
    if (this.dragIndex !== null) {
      const moved = this.dragMoved;
      this.dragIndex = null;
      // A drag is not a click: it must not count toward the double-click that finishes.
      if (moved) { this.lastClick = null; return 'standing'; }
    }
    // The release says a press was a click; recording it on the press would let one click's own
    // release read it as the second of a pair.
    const prev = this.lastClick;
    if (prev && time - prev.time <= CHAIN_DOUBLE_CLICK_MS && same(prev.at, at) && this.anchors.length >= 2) {
      return 'finish';
    }
    this.lastClick = { at: { x: at.x, y: at.y }, time };
    return 'standing';
  }

  /** The press never happened: the anchor it dropped goes, the anchors before it stay. */
  cancelPress(): void {
    if (this.pressAdded) this.anchors.pop();
    this.pressAdded = false;
    this.dragIndex = null;
    this.dragMoved = false;
  }

  /** Takes back the newest anchor; false when there is none. */
  undoStep(): boolean {
    if (this.anchors.length === 0) return false;
    this.anchors.pop();
    this.dragIndex = null;
    this.lastClick = null;
    return true;
  }

  clear(): void {
    this.anchors = [];
    this.dragIndex = null;
    this.dragMoved = false;
    this.pressAdded = false;
    this.lastClick = null;
  }
}

/** A figure dragged out from its press: a line, or a rectangle or circle from its corner or centre. */
class DragShape {
  private origin: MacroCoord | null = null;

  get active(): boolean { return this.origin !== null; }

  begin(at: MacroCoord): void { this.origin = at; }

  /** The end the pointer gives, snapped straight, square or round while constrain is held. */
  end(pointer: MacroCoord, shape: DragShapeKind, constrain: boolean): MacroCoord {
    return this.origin && constrain ? snapShapeEnd(this.origin, pointer, shape) : pointer;
  }

  /** The figure's cells to `end`; `brushSize` widens a line only. */
  cells(shape: DragShapeKind, end: MacroCoord, brushSize: number): MacroCoord[] {
    return this.origin ? dragShapeCells(shape, this.origin, end, brushSize) : [];
  }

  spans(shape: 'rect' | 'circle', end: MacroCoord): RowSpan[] {
    return this.origin ? dragShapeSpans(shape, this.origin, end) : [];
  }

  clear(): void { this.origin = null; }
}

/** What the pointer shows over the map: the cells, or the row spans of a dragged rectangle or circle,
 *  and the cell whose answer the preview card carries. */
export type GestureGhost =
  | { readonly cells: MacroCoord[]; readonly at: MacroCoord }
  | { readonly spans: RowSpan[]; readonly at: MacroCoord };

const isFigure = (shape: BuildShape): shape is DragShapeKind => shape === 'line' || shape === 'rect' || shape === 'circle';

/**
 * The five-shape gesture the build brush and the eraser both run: a freehand press sampled into a
 * band, a dragged line, rectangle or circle, and the curve's anchor chain. It holds the press and
 * says what a move shows and what a release lays; each tool decides what laying means and when its
 * stroke opens. The map is never touched here.
 */
export class ShapeGesture {
  readonly chain: AnchorChain;
  readonly drag = new DragShape();
  /** The freehand press's last sample, null while no freehand press is down. */
  private last: MacroCoord | null = null;

  constructor(now?: () => number) { this.chain = new AnchorChain(now); }

  /** Whether a freehand press is down. */
  get freehand(): boolean { return this.last !== null; }

  /** Begin a freehand press at `at`; its first dab is the caller's. */
  beginFree(at: MacroCoord): void { this.last = at; }

  /** The band the freehand press swept from its last sample to `at`, filled with a 4-connected line
   *  so a fast drag stays edge-connected; null when no press is down or the pointer is still on the
   *  last sample's cell. */
  sweep(at: MacroCoord, brushSize: number): MacroCoord[] | null {
    const from = this.last;
    if (!from || same(from, at)) return null;
    this.last = at;
    return expandLine(line4(from.x, from.y, at.x, at.y), brushSize);
  }

  /** Ends the freehand press and returns its last sample, or null when none was down. */
  endFree(): MacroCoord | null {
    const last = this.last;
    this.last = null;
    return last;
  }

  /** The ghost a move to `at` shows for `shape`: a moved anchor's curve, the standing curve run on
   *  to the pointer, the figure dragged so far, or the footprint the next press would lay (a cell for
   *  a rectangle or circle, the brush for every other shape). */
  ghost(at: MacroCoord, shape: BuildShape, brushSize: number, constrain: boolean): GestureGhost {
    if (shape === 'curve') {
      if (this.chain.move(at)) return { cells: splineCells(this.chain.points, brushSize), at };
      if (this.chain.length > 0) return { cells: splineCells([...this.chain.points, at], brushSize), at };
    }
    if (isFigure(shape) && this.drag.active) {
      const end = this.drag.end(at, shape, constrain);
      return shape === 'line' ? { cells: this.drag.cells('line', end, brushSize), at: end } : { spans: this.drag.spans(shape, end), at: end };
    }
    return { cells: shape === 'rect' || shape === 'circle' ? [at] : brushCells(at.x, at.y, brushSize), at };
  }

  /** A dragged figure released at `at`: its cells and its end, the drag cleared; null when no figure
   *  was being dragged. */
  releaseFigure(at: MacroCoord, shape: DragShapeKind, brushSize: number, constrain: boolean): { cells: MacroCoord[]; end: MacroCoord } | null {
    if (!this.drag.active) return null;
    const end = this.drag.end(at, shape, constrain);
    const cells = this.drag.cells(shape, end, brushSize);
    this.drag.clear();
    return { cells, end };
  }

  clear(): void {
    this.last = null;
    this.drag.clear();
    this.chain.clear();
  }
}
