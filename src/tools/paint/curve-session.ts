/**
 * The curve's ADJUST phase: the anchors of the curve that was just drawn, still on the map and
 * still movable.
 *
 * A module singleton rather than store state, in the shape of `cursor-controller` and
 * `layout-settle`: the handles are a React overlay (`ui/chrome/floating/CurveHandles`) that has to read this
 * every frame of a drag, while the thing that OWNS the curve is the drawing tool. A subscription is
 * the seam between them, and it keeps a session's bookkeeping — which is not UI state — out of the
 * editor store.
 *
 * The tool supplies `repaint`: the session never touches the map itself. Every tweak goes back
 * through the tool's own paint path, so an adjusted curve is exactly the curve that would have been
 * drawn at those anchors — same stacking, same reconcile, same auto edge-cut.
 */
import { anchorHandles, type CurveAnchor } from '../../core/model/spline';

export interface CurveSession {
  /** The anchors, in the order they were placed. */
  anchors: CurveAnchor[];
  /** Brush width the curve was painted at — the handles scale with it. */
  width: number;
  /** Terrain sits on the micro grid, tiles on the macro grid; the overlay positions against it. */
  terrainGrid: boolean;
  /** Anchors on the CONTINUOUS half-cell grid (a route's), not whole cells: the overlay projects
   *  them unshifted and reads a drag at the same precision. */
  freeCoords: boolean;
  /** Counts up on every change, so a subscriber re-renders on an in-place anchor edit. */
  revision: number;
}

/** What the session needs from whoever owns the curve. */
export interface CurveSessionHost {
  /** Show where the curve WOULD go, without touching the map — every frame of a drag. */
  preview(anchors: CurveAnchor[]): void;
  /** Re-lay the curve at these anchors, as one undoable step. */
  repaint(anchors: CurveAnchor[]): void;
  /** The adjust phase is over; the curve is final. */
  finalize(): void;
}

let session: CurveSession | null = null;
let host: CurveSessionHost | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeCurveSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCurveSession(): CurveSession | null {
  return session;
}

/** Open the adjust phase on a curve that has just been painted. */
export function beginCurveSession(
  anchors: CurveAnchor[],
  opts: { width: number; terrainGrid: boolean; freeCoords?: boolean },
  owner: CurveSessionHost,
): void {
  session = {
    anchors: anchors.map((a) => ({ ...a })), width: opts.width, terrainGrid: opts.terrainGrid,
    freeCoords: opts.freeCoords === true, revision: 0,
  };
  host = owner;
  emit();
}

/** Whether an adjust phase is open. */
export function isCurveSessionOpen(): boolean {
  return session !== null;
}

function mutate(change: (s: CurveSession) => void): void {
  if (!session) return;
  change(session);
  session = { ...session, anchors: session.anchors.map((a) => ({ ...a })), revision: session.revision + 1 };
  emit();
}

/**
 * Move an anchor. `commit` marks the END of a drag: the map is re-laid only then, so a drag costs
 * one undo entry rather than one per pointer event. Every frame before that shows a GHOST of where
 * the curve is going, which is what makes the drag aimable — without it the anchor moves and
 * nothing else does until the release.
 */
export function moveCurveAnchor(index: number, x: number, y: number, commit: boolean): void {
  mutate((s) => {
    const a = s.anchors[index];
    if (a) { a.x = x; a.y = y; }
  });
  if (commit) host?.repaint(session!.anchors);
  else host?.preview(session!.anchors);
}

/**
 * Point one end of an anchor's direction line at `dx,dy` (an offset from the anchor, in cells).
 *
 * `mirror` turns the other end with it, so the path stays smooth THROUGH the anchor; without it the
 * two sides turn apart and the anchor becomes a corner. Breaking a line that had only ever been
 * derived materialises the far side FIRST, so the side that is not being dragged holds still.
 * Same commit rule as `moveCurveAnchor`.
 */
export function setCurveHandle(
  index: number,
  side: 'out' | 'into',
  dx: number,
  dy: number,
  opts: { commit: boolean; mirror: boolean },
): void {
  mutate((s) => {
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
  if (opts.commit) host?.repaint(session!.anchors);
  else host?.preview(session!.anchors);
}

/** Put the anchors back, without re-laying anything: the map has already been returned to the state
 *  these anchors describe. Used when a tweak was refused, so the handles stop showing a shape the
 *  map does not have. */
export function resetCurveAnchors(anchors: CurveAnchor[]): void {
  mutate((s) => { s.anchors = anchors.map((a) => ({ ...a })); });
}

/** Close the adjust phase. The curve stays exactly as it is; only the handles go. */
export function endCurveSession(): void {
  if (!session) return;
  const owner = host;
  session = null;
  host = null;
  owner?.finalize();
  emit();
}

/** Test-only: drop any session without telling the owner. */
export function __resetCurveSession(): void {
  session = null;
  host = null;
}
