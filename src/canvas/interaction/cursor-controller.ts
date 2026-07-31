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
export type DragKind = 'none' | 'pan' | 'orbit';

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
export function resolveCursor(state: CursorState): { id: CursorId; forbidden: boolean } {
  if (state.busy) return { id: 'busy', forbidden: false };
  if (state.drag === 'orbit') return { id: 'orbit', forbidden: false };
  if (state.drag === 'pan') return { id: 'hand-closed', forbidden: false };
  // A live Ctrl hint outranks the tool's own cursor. None of the three ids it can carry is
  // FORBIDDABLE, so there is nothing to badge here.
  if (state.ctrlHint) return { id: state.ctrlHint, forbidden: false };
  // A press that selects says so, rather than showing `place` with a forbidden badge over an
  // object it is about to select instead.
  if (state.pressSelects) return { id: 'select', forbidden: false };
  // `move` only where a press would actually move something; elsewhere the same tool is `select`.
  const id = state.tool === 'select' && state.overSelected ? 'move' : state.tool;
  return { id, forbidden: state.forbidden && FORBIDDABLE.has(id) };
}

let state: CursorState = { ...DEFAULT_STATE };
let surface: HTMLElement | null = null;
let applied = '';

function apply(): void {
  if (!surface) return;
  const { id, forbidden } = resolveCursor(state);
  const value = cursorCss(id, { forbidden });
  if (value === applied) return; // no DOM write per pointer-move
  applied = value;
  surface.style.cursor = value;
}

/** Register the element cursors are written to. Pass null on unmount; the outgoing element
 *  is cleared so a stale cursor cannot outlive the view that set it. */
export function registerCursorSurface(el: HTMLElement | null): void {
  if (surface && surface !== el) surface.style.cursor = '';
  surface = el;
  applied = '';
  apply();
}

/** Give up the surface, but only if it is still ours. Both canvases stay mounted for the life
 *  of the app and re-run their effects on a view switch, so a blind `register(null)` from the
 *  view being hidden would wipe the claim the view being shown just made. */
export function releaseCursorSurface(el: HTMLElement | null): void {
  if (el && surface === el) registerCursorSurface(null);
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
  surface = null;
  applied = '';
}
