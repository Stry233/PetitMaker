/**
 * THE TWO MARKS A ROUTE LEAVES, briefly, and the nudge that moves one.
 *
 * A module singleton rather than store state, in `curve-session.ts`'s shape: the marks are a React
 * overlay that re-projects every frame of a drag, while the thing that OWNS the route is the macro
 * tool. A subscription is the seam, and a gesture's bookkeeping stays out of the editor store.
 *
 * A NUDGE IS RESTORE THEN RELAY, exactly as a curve tweak is: the route's own undo entry is taken
 * back and the route is laid again at the moved marks. Patching would leave the old line under the
 * new one, and re-laying without the undo would stack a second road on the first. What stood BEFORE
 * the route is what the undo restores, so nothing the route never touched is re-laid at all.
 */
import type { MacroCoord } from '../../core/model/types';

export interface RouteSession {
  /** BOTH ends, always. Marks are offered for a route that has LANDED, and a gesture still holding one
   *  end has laid nothing to nudge: its first tap shows as the route ghost the pointer trails, and the
   *  tool owns that mark. A one-ended session could only ever be the flicker between the two taps. */
  from: MacroCoord;
  to: MacroCoord;
  /** Counts up on every change, so a subscriber re-renders on an in-place move. */
  revision: number;
  /** `state/slices/edit.ts`'s `armingEpoch` when the route was laid. The marks belong to that arming
   *  and are stale under any other, which is a LEVEL rather than an edge: a route landing off the
   *  build thread can open its marks after the switch that already invalidated them, so a subscriber
   *  watching for the count to CHANGE would see nothing to react to and leave them standing. */
  epoch: number;
}

export interface RouteSessionHost {
  /** Show where the route WOULD go, touching nothing: every frame of a drag. */
  preview(from: MacroCoord, to: MacroCoord): void;
  /** Take the standing route back and lay it again at these ends, as ONE undo step. */
  relay(from: MacroCoord, to: MacroCoord): void;
  /** The marks are gone; the route is final. */
  finalize(): void;
}

/** Which end a nudge is moving. */
export type RouteMarkId = 'from' | 'to';

/** How long the marks stand with nothing happening. They are a chance to adjust, not a mode: a
 *  mark that outlives the moment reads as something the map now HAS. */
export const LINGER_MS = 6000;

let session: RouteSession | null = null;
let host: RouteSessionHost | null = null;
let linger: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeRouteSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getRouteSession(): RouteSession | null {
  return session;
}

/** Restart the linger clock. `LINGER_MS` measures a pause, so every nudge buys the next one. */
function waitAgain(): void {
  if (linger !== null) clearTimeout(linger);
  linger = setTimeout(() => { closeRouteMarks(); }, LINGER_MS);
}

/** Show the marks for a route that has just been laid. Any marks already standing belong to an
 *  earlier route and are closed first, so their owner is told before it is replaced. */
export function openRouteMarks(from: MacroCoord, to: MacroCoord, owner: RouteSessionHost, epoch: number): void {
  closeRouteMarks();
  session = { from: { ...from }, to: { ...to }, revision: 0, epoch };
  host = owner;
  waitAgain();
  emit();
}

function mutate(change: (s: RouteSession) => void): void {
  if (!session) return;
  const next: RouteSession = {
    from: { ...session.from },
    to: { ...session.to },
    revision: session.revision + 1,
    epoch: session.epoch,
  };
  change(next);
  session = next;
  emit();
}

/**
 * Move one mark. `commit` marks the END of a drag: the map is re-laid only then, so a drag costs one
 * undo entry rather than one per pointer event. Every frame before that shows a GHOST of where the
 * route is going, which is what makes the drag aimable.
 */
export function moveRouteMark(which: RouteMarkId, x: number, y: number, commit: boolean): void {
  mutate((s) => {
    if (which === 'from') s.from = { x, y };
    else s.to = { x, y };
  });
  if (!session) return;
  waitAgain();
  const { from, to } = session;
  if (commit) host?.relay(from, to);
  else host?.preview(from, to);
}

/** Buy another `LINGER_MS` without moving anything. A CYCLE is a tap on the route rather than on a
 *  mark, so it never reaches `moveRouteMark`'s own clock, and marks that expired under a hand still
 *  choosing between routes would end the choice mid-way. */
export function keepRouteMarks(): void {
  if (session) waitAgain();
}

/** Put the marks back on the ends the route standing on the map actually has, without laying
 *  anything. Used when a nudge was refused and the owner has already returned the map: the marks must
 *  never describe a route the map does not have. */
export function resetRouteMarks(from: MacroCoord, to: MacroCoord): void {
  mutate((s) => { s.from = { ...from }; s.to = { ...to }; });
}

/** Put the marks away. The route stays exactly as it is; only the marks go. */
export function closeRouteMarks(): void {
  if (!session) return;
  const owner = host;
  session = null;
  host = null;
  if (linger !== null) { clearTimeout(linger); linger = null; }
  owner?.finalize();
  emit();
}

/** Test-only: drop any session without telling the owner. */
export function __resetRouteSession(): void {
  session = null;
  host = null;
  if (linger !== null) { clearTimeout(linger); linger = null; }
}
