/**
 * The cursor catalogue: which cursors exist, where each one points, and what a browser
 * should fall back to.
 *
 * Separate from the art, so the set can be read and tested without loading any SVG. Adding a
 * cursor is one entry here plus one shape in cursor-art.
 */

/** Semantic cursor names. Tools name one of these; nothing outside ui/cursors knows CSS. */
export type CursorId =
  | 'mountain' | 'water' | 'road' | 'eraser' | 'edge-cut'
  | 'place' | 'select' | 'move'
  | 'select-add' | 'select-remove'
  | 'hand-open' | 'hand-closed' | 'orbit' | 'marquee' | 'busy'
  | 'default' | 'clickable' | 'blocked' | 'text';

/** Logical pixel size of every cursor image. Browsers ignore images past ~128px, and
 *  32 is the size every platform composites without complaint. */
export const CURSOR_SIZE = 32;

export interface CursorSpec {
  /** The acting pixel, in image coordinates. */
  hotspot: readonly [number, number];
  /** Used when the image cannot be (the CSS grammar requires it after url()). */
  fallback: string;
  /** False for cursors left to the OS. */
  hasArt: boolean;
}

export const CURSORS: Readonly<Record<CursorId, CursorSpec>> = {
  // Tools point with a tip drawn at their top-left, so the hotspot sits on that tip.
  mountain: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  water: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  road: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  eraser: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  'edge-cut': { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  place: { hotspot: [2, 2], fallback: 'copy', hasArt: true },
  select: { hotspot: [2, 2], fallback: 'default', hasArt: true },
  // Ctrl held over an object: the same arrow badged with a plus or a minus (see cursor-art), so
  // the same apex and the same hotspot.
  'select-add': { hotspot: [2, 2], fallback: 'default', hasArt: true },
  'select-remove': { hotspot: [2, 2], fallback: 'default', hasArt: true },
  // Symmetric cursors act from their middle.
  move: { hotspot: [16, 16], fallback: 'move', hasArt: true },
  'hand-open': { hotspot: [16, 16], fallback: 'grab', hasArt: true },
  'hand-closed': { hotspot: [16, 16], fallback: 'grabbing', hasArt: true },
  orbit: { hotspot: [16, 16], fallback: 'all-scroll', hasArt: true },
  marquee: { hotspot: [16, 16], fallback: 'crosshair', hasArt: true },
  // A busy cursor is a platform convention (and often animated); let the OS draw it.
  busy: { hotspot: [0, 0], fallback: 'progress', hasArt: false },

  // The DOM set: everything outside the canvas is one of these four.
  // Same arrow as `select`, so the tip is in the same place.
  default: { hotspot: [2, 2], fallback: 'default', hasArt: true },
  // The acting pixel of a pointing hand is the fingertip, not the palm.
  clickable: { hotspot: [11, 3], fallback: 'pointer', hasArt: true },
  blocked: { hotspot: [2, 2], fallback: 'not-allowed', hasArt: true },
  // An I-beam is symmetric and marks a caret position, so it acts from its middle.
  text: { hotspot: [16, 16], fallback: 'text', hasArt: true },
};

export const CURSOR_IDS = Object.keys(CURSORS) as CursorId[];

/**
 * The cursors the DOM shows, and the custom property each is published under.
 *
 * These names are the whole contract between the writer (`cursor-vars`, which resolves each to
 * a CSS value on `<html>`) and the readers (`ui/styles`'s `cursors` tokens, plus the global
 * rules in `cursors.css`). They live here, in the module that imports nothing, so `ui/styles`
 * can name them without importing the art — which imports `ui/styles` back.
 */
export const DOM_CURSORS = {
  default: '--pw-cursor-default',
  clickable: '--pw-cursor-clickable',
  blocked: '--pw-cursor-blocked',
  text: '--pw-cursor-text',
} as const satisfies Partial<Record<CursorId, string>>;

export type DomCursorId = keyof typeof DOM_CURSORS;

/**
 * Cursors that can carry the forbidden badge. Every entry is REACHABLE: it is the cursor of a
 * tool that implements `Tool.canActAt` and can answer false there.
 *
 * Excluded, and why:
 * - `hand-open`/`hand-closed`/`orbit`/`marquee`/`busy` — panning, orbiting, marquee and a long
 *   operation are always legal.
 * - `select` — "nothing here to act on" is not a refusal.
 * - `move` — its only refusable question (would the DROP be accepted?) has no answer at hover
 *   time: the drop cell is not known until the drag ends.
 * - `select-add`/`select-remove` — Ctrl over an object always toggles it; only which way varies.
 * - `edge-cut` — a cell's cut validity spans four independent corner slots, so there is no single
 *   yes/no for the cell under the pointer. Art for a badged variant exists but is unused.
 * - the DOM four — not tool cursors, and no tool probes them. `blocked` already draws the badge
 *   in its own art, so listing it would stamp a second one.
 */
export const FORBIDDABLE: ReadonlySet<CursorId> = new Set<CursorId>([
  'mountain', 'water', 'road', 'eraser', 'place',
]);
