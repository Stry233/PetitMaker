/**
 * The curve's adjust phase: the anchors of the curve that was just drawn, still on the map and
 * still movable.
 *
 * One `CurveSessions` per editor, reached through `ToolHost.curve`: the handles are a React overlay
 * (`ui/chrome/floating/CurveHandles`) that has to read the session every frame of a drag, while the
 * thing that owns the curve is the drawing tool. A subscription is the seam between them, and it
 * keeps a session's bookkeeping, which is not UI state, out of the editor store. Each host that is
 * not handed one gets its own, so a Help figure's curve never closes the editor's.
 *
 * The tool supplies `repaint`: the session never touches the map itself. Every tweak goes back
 * through the tool's own paint path, so an adjusted curve is exactly the curve that would have been
 * drawn at those anchors: same stacking, same reconcile, same auto edge-cut.
 */
import { anchorHandles, type CurveAnchor } from '../../../core/base/spline';
import { createSignal } from '../../../core/base/signal';
import type { GridId } from '../../../core/grid/grids';
import type { ToolContext } from '../runtime/types';
import type { ToolArming } from '../../../state/editing/arming';

export interface CurveSession {
  /** The anchors, in the order they were placed. */
  anchors: CurveAnchor[];
  /** Brush width the curve was painted at — the handles scale with it. */
  width: number;
  /** The grid the anchors' cells lie on; the overlay positions against it. */
  grid: GridId;
  /** Anchors on the continuous half-cell grid (a route's), not whole cells: the overlay projects
   *  them unshifted and reads a drag at the same precision. */
  freeCoords: boolean;
  /** Routed roads expose endpoints; free curves and rivers also expose direction handles. */
  tangents: boolean;
  /** Keep the curve footprint visible while its anchors are editable. */
  footprint: boolean;
  /** `curveArmingKey` of the arming the curve was drawn with; a different arming closes the
   *  session. Absent never closes on arming. */
  armingKey?: string;
  /** Counts up on every change, so a subscriber re-renders on an in-place anchor edit. */
  revision: number;
}

/** What the session needs from whoever owns the curve. */
export interface CurveSessionHost {
  /** Show where the curve would go, without touching the map — every frame of a drag. */
  preview(anchors: CurveAnchor[]): void;
  /** Re-lay the curve at these anchors, as one undoable step. */
  repaint(anchors: CurveAnchor[]): void;
  /** The adjust phase is over; the curve is final. */
  finalize(): void;
}

/**
 * The context a held gesture works through (a curve's adjust phase, a spray hold): the arming stays
 * the snapshot of the press, while the host stays live, the view included, so after a 2D/3D switch
 * the gesture's ghost draws in the view on screen. A spread would freeze the view getters.
 */
export function adjustContext<C extends ToolContext>(ctx: C): C {
  return Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx)) as C;
}

/** What an open session is bound to: a change of tool, shape, surface, eraser footprint or armed
 *  macro re-lays nothing, it closes the handles. Brush size and floor are not in it, since the
 *  adjust phase keeps the ones the curve was drawn with. */
export function curveArmingKey(a: ToolArming): string {
  return `${a.tool}|${a.shape}|${a.contentType}|${a.eraserShape}|${a.armingEpoch}`;
}

/** The adjust phase of one editor's curves: at most one session open at a time. */
export class CurveSessions {
  private session: CurveSession | null = null;
  private host: CurveSessionHost | null = null;
  private readonly changed = createSignal();

  subscribe(listener: () => void): () => void {
    return this.changed.subscribe(listener);
  }

  get(): CurveSession | null {
    return this.session;
  }

  /** Whether an adjust phase is open. */
  isOpen(): boolean {
    return this.session !== null;
  }

  /** Open the adjust phase on a curve that has just been painted. */
  begin(
    anchors: CurveAnchor[],
    opts: { width: number; grid: GridId; freeCoords?: boolean; tangents?: boolean; footprint?: boolean; armingKey?: string },
    owner: CurveSessionHost,
  ): void {
    this.end();
    this.session = {
      anchors: anchors.map((a) => ({ ...a })), width: opts.width, grid: opts.grid,
      freeCoords: opts.freeCoords === true, revision: 0,
      tangents: opts.tangents !== false, footprint: opts.footprint === true, armingKey: opts.armingKey,
    };
    this.host = owner;
    this.changed.emit();
  }

  private mutate(change: (s: CurveSession) => void): void {
    const s = this.session;
    if (!s) return;
    change(s);
    this.session = { ...s, anchors: s.anchors.map((a) => ({ ...a })), revision: s.revision + 1 };
    this.changed.emit();
  }

  private relay(commit: boolean): void {
    if (!this.session) return;
    if (commit) this.host?.repaint(this.session.anchors);
    else this.host?.preview(this.session.anchors);
  }

  /**
   * Move an anchor. `commit` marks the end of a drag: the map is re-laid only then, so a drag costs
   * one undo entry rather than one per pointer event. Every frame before that shows a ghost of where
   * the curve is going, which is what makes the drag aimable.
   */
  moveAnchor(index: number, x: number, y: number, commit: boolean): void {
    this.mutate((s) => {
      const a = s.anchors[index];
      if (a) { a.x = x; a.y = y; }
    });
    this.relay(commit);
  }

  /**
   * Point one end of an anchor's direction line at `dx,dy` (an offset from the anchor, in cells).
   *
   * `mirror` turns the other end with it, so the path stays smooth through the anchor; without it the
   * two sides turn apart and the anchor becomes a corner. Breaking a line that had only ever been
   * derived materialises the far side first, so the side that is not being dragged holds still.
   * Same commit rule as `moveAnchor`.
   */
  setHandle(index: number, side: 'out' | 'into', dx: number, dy: number, opts: { commit: boolean; mirror: boolean }): void {
    this.mutate((s) => {
      const a = s.anchors[index];
      if (!a) return;
      if (opts.mirror) {
        const [hx, hy] = side === 'out' ? [dx, dy] : [-dx, -dy];
        a.hx = hx; a.hy = hy;
        a.ihx = -hx; a.ihy = -hy;
        return;
      }
      const held = anchorHandles(s.anchors)[index]!;
      a.hx = held.hx; a.hy = held.hy;
      a.ihx = held.ihx; a.ihy = held.ihy;
      if (side === 'out') { a.hx = dx; a.hy = dy; } else { a.ihx = dx; a.ihy = dy; }
    });
    this.relay(opts.commit);
  }

  /** Put the anchors back, without re-laying anything: the map has already been returned to the state
   *  these anchors describe. Used when a tweak was refused, so the handles stop showing a shape the
   *  map does not have. */
  resetAnchors(anchors: CurveAnchor[]): void {
    this.mutate((s) => { s.anchors = anchors.map((a) => ({ ...a })); });
  }

  /** Close the adjust phase. The curve stays exactly as it is; only the handles go. */
  end(): void {
    if (!this.session) return;
    const owner = this.host;
    this.session = null;
    this.host = null;
    owner?.finalize();
    this.changed.emit();
  }

  /** Test-only: drop any session without telling the owner. */
  __reset(): void {
    this.session = null;
    this.host = null;
  }
}

/** What a tool with an adjust phase reads from its host beyond the base contract: the editor's curve
 *  sessions, which the curve handles overlay also reads. */
export interface CurveChannel {
  curve: CurveSessions;
}

/** The context of a tool that opens curve sessions. */
export type CurveToolContext = ToolContext & CurveChannel;
