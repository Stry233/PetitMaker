/**
 * The single writer of `style.cursor`.
 *
 * A module-level singleton, like motion-state and render-scheduler. The pointer machine updates it
 * on every hover change, so it never goes through React and never writes the DOM unless the
 * resolved value changed. Both canvases register their container here.
 */
import { cursorCss } from '../../ui/cursors/cursor-css';
import { FORBIDDABLE, type CursorId } from '../../core/runtime/cursor-spec';

/** What the pointer is doing, when that outranks the tool. */
export type DragKind = 'none' | 'pan' | 'orbit' | 'object';

export interface CursorState {
  /** The active tool's cursor, or 'marquee' while region-selecting. */
  tool: CursorId;
  /** The active tool says the hovered cell would be refused. */
  forbidden: boolean;
  /**
   * The pointer is over the already-selected object, which is the ONLY place drag-to-move arms
   * (a drag from anywhere else pans the camera). Positional, like `forbidden`, so the pointer
   * machine owns it: a store-driven tool getter cannot know where the pointer is.
   */
  overSelected: boolean;
  /**
   * What a Ctrl-held click would do at the hovered cell: join an unselected object
   * (`select-add`), drop a selected one (`select-remove`), or start a rubber band over bare
   * ground (`marquee`). Null when Ctrl changes nothing here (not held, or the cell is outside
   * a selection-capable mode), and the tool keeps its own cursor. Positional, like `overSelected`.
   */
  ctrlHint: CursorId | null;
  /**
   * The press at the hovered cell SELECTS what is there instead of running the tool: the object
   * placer with an item armed, over an existing object where the placement would be refused.
   * Positional, like `overSelected`.
   */
  pressSelects: boolean;
  drag: DragKind;
  busy: boolean;
}

const DEFAULT_STATE: CursorState = {
  tool: 'select', forbidden: false, overSelected: false, ctrlHint: null,
  pressSelects: false, drag: 'none', busy: false,
};

/**
 * What to show. Highest precedence first: a long operation, then what the pointer is
 * currently doing, then the tool. The badge only survives on cursors that can be refused,
 * so panning or a marquee never claims to be forbidden.
 */
/**
 * The tool cursors whose mode can drag a selected object — the move tool and an idle placer, the
 * same pair `inSelectMode` names. A brush or the region marquee keeps its own cursor over a
 * selected object, because a press there paints rather than moves.
 */
const DRAG_CAPABLE: ReadonlySet<CursorId> = new Set<CursorId>(['select', 'move']);

export function resolveCursor(state: CursorState): { id: CursorId; forbidden: boolean } {
  if (state.busy) return { id: 'busy', forbidden: false };
  if (state.drag === 'orbit') return { id: 'orbit', forbidden: false };
  // Panning IS the move tool doing its job, so it keeps that tool's own cursor rather than
  // swapping to a hand: the hands belong to grabbing an OBJECT.
  if (state.drag === 'pan') return { id: 'move', forbidden: false };
  // An object drag is the hand closing on the thing it grabbed.
  if (state.drag === 'object') return { id: 'hand-closed', forbidden: false };
  // A live Ctrl hint outranks the tool's own cursor. None of the three ids it can carry is
  // FORBIDDABLE, so there is nothing to badge here.
  if (state.ctrlHint) return { id: state.ctrlHint, forbidden: false };
  // A press that selects says so, rather than showing `place` with a forbidden badge over an
  // object it is about to select instead.
  if (state.pressSelects) return { id: 'select', forbidden: false };
  // The OPEN hand only where a press would actually grab something; it closes above once the
  // press happens.
  const id = DRAG_CAPABLE.has(state.tool) && state.overSelected ? 'hand-open' : state.tool;
  return { id, forbidden: state.forbidden && FORBIDDABLE.has(id) };
}

let state: CursorState = { ...DEFAULT_STATE };
/** The view that owns the screen. Written by the two canvases, which stay mounted for the life of
 *  the app and hand this back and forth on a view switch. */
let base: HTMLElement | null = null;
/** Full-screen overlays stacked above the views, innermost last. Each carries the cursor it wants
 *  shown, so an overlay never writes the app's tool cursor and has nothing to restore on close. */
interface OverlayClaim { el: HTMLElement; cursor: CursorId | null }
let overlays: OverlayClaim[] = [];
let surface: HTMLElement | null = null;
let applied = '';

/** The topmost claim wins: an overlay while one is up, otherwise the live view. */
function retarget(): void {
  const next = overlays[overlays.length - 1]?.el ?? base;
  if (surface === next) return;
  if (surface) surface.style.cursor = '';
  surface = next;
  applied = '';
}

/** What an overlay claim shows: its own cursor in place of the tool's, with every other input
 *  (a drag, busy) still outranking it exactly as it outranks a tool. */
function effectiveState(): CursorState {
  const top = overlays[overlays.length - 1];
  return top?.cursor ? { ...state, tool: top.cursor } : state;
}

function apply(): void {
  if (!surface) return;
  const { id, forbidden } = resolveCursor(effectiveState());
  const value = cursorCss(id, { forbidden });
  if (value === applied) return; // no DOM write per pointer-move
  applied = value;
  surface.style.cursor = value;
}

/** Register the view whose element cursors are written to. Pass null on unmount; the outgoing
 *  element is cleared so a stale cursor cannot outlive the view that set it. */
export function registerCursorSurface(el: HTMLElement | null): void {
  base = el;
  retarget();
  apply();
}

/** Give up the surface, but only if it is still ours. Both canvases stay mounted for the life
 *  of the app and re-run their effects on a view switch, so a blind `register(null)` from the
 *  view being hidden would wipe the claim the view being shown just made. */
export function releaseCursorSurface(el: HTMLElement | null): void {
  if (el && base === el) registerCursorSurface(null);
}

/**
 * Claim the surface for an overlay drawn ABOVE the views, optionally with the cursor it wants
 * shown, and get back a restore that hands the surface to whichever view owns the screen then.
 *
 * An overlay cannot simply register and then release: the canvas underneath stays mounted with
 * unchanged effect deps, so nothing re-registers it and the map is left with the platform arrow.
 * Restoring resolves the base LIVE rather than reinstating the element captured at claim time,
 * since a view toggle can swap it while the overlay is up.
 */
export function pushCursorSurface(el: HTMLElement | null, cursor: CursorId | null = null): () => void {
  const claim: OverlayClaim | null = el ? { el, cursor } : null;
  if (claim) overlays.push(claim);
  retarget();
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (claim) overlays = overlays.filter((o) => o !== claim);
    retarget();
    apply();
  };
}

export function setToolCursor(id: CursorId): void {
  if (state.tool === id) return;
  state = { ...state, tool: id };
  apply();
}

export function setCursorForbidden(forbidden: boolean): void {
  if (state.forbidden === forbidden) return;
  state = { ...state, forbidden };
  apply();
}

export function setCursorOverSelected(overSelected: boolean): void {
  if (state.overSelected === overSelected) return;
  state = { ...state, overSelected };
  apply();
}

export function setCursorCtrlHint(hint: CursorId | null): void {
  if (state.ctrlHint === hint) return;
  state = { ...state, ctrlHint: hint };
  apply();
}

export function setCursorPressSelects(pressSelects: boolean): void {
  if (state.pressSelects === pressSelects) return;
  state = { ...state, pressSelects };
  apply();
}

export function setCursorDrag(drag: DragKind): void {
  if (state.drag === drag) return;
  state = { ...state, drag };
  apply();
}

export function setCursorBusy(busy: boolean): void {
  if (state.busy === busy) return;
  state = { ...state, busy };
  apply();
}

/**
 * Resolve the current state again and write it if it changed. Every other entry point is a state
 * setter, and the system-cursors preference rewrites what every id resolves to underneath this
 * module without touching any state here, so nothing else would re-resolve after a flip.
 */
export function refreshCursor(): void {
  apply();
}

/** Test-only: forget the surface and go back to defaults. */
export function __resetCursorController(): void {
  state = { ...DEFAULT_STATE };
  base = null;
  overlays = [];
  surface = null;
  applied = '';
}
