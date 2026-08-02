/**
 * The cursor catalogue: which cursors exist, where each one points, and what a browser
 * should fall back to.
 *
 * Separate from the art, so the set can be read and tested without loading an image. Adding a
 * cursor is one entry here plus one file in `src/assets/cursors/`.
 */

/** Semantic cursor names. Tools name one of these; nothing outside ui/cursors knows CSS. */
export type CursorId =
  | 'mountain' | 'water' | 'road' | 'eraser' | 'edge-cut'
  | 'place' | 'select' | 'move'
  | 'select-add' | 'select-remove'
  | 'hand-open' | 'hand-closed' | 'orbit' | 'marquee' | 'busy'
  | 'default' | 'clickable' | 'blocked' | 'text';

/**
 * Logical pixel size of every cursor image, and so how big the cursor is on screen: a CSS
 * cursor is drawn at its image's intrinsic size.
 *
 * The art is drawn at 32 and rendered to this size where the images are generated; change it there
 * and this must follow, since hotspots are in image pixels and `cursors.test.ts` fails on a
 * mismatch. Browsers ignore a cursor image past ~128px.
 */
export const CURSOR_SIZE = 48;

export interface CursorSpec {
  /** The acting pixel, in image coordinates. */
  hotspot: readonly [number, number];
  /** Pixel size of THIS cursor's image, when it is not `CURSOR_SIZE`. A cursor whose composition
   *  needs more room around the same-sized art gets a bigger tile rather than bigger art. */
  size?: number;
  /** Used when the image cannot be (the CSS grammar requires it after url()). */
  fallback: string;
  /** False for cursors left to the OS. */
  hasArt: boolean;
}

/*
 * Hotspots are in image pixels, read off the art, so they scale with CURSOR_SIZE.
 *
 * A hotspot picks which pixel of the image sits under the pointer; the pointer itself is
 * wherever the mouse is. So two cursors drawn from one shape at different offsets need
 * different hotspots, or the shared shape jumps between them.
 */
export const CURSORS: Readonly<Record<CursorId, CursorSpec>> = {
  // The four cell-painting tools draw the same block in the same place, and one hotspot across
  // them holds that block still as the user switches tools.
  mountain: { hotspot: [24, 24], fallback: 'crosshair', hasArt: true },
  water: { hotspot: [24, 24], fallback: 'crosshair', hasArt: true },
  road: { hotspot: [24, 24], fallback: 'crosshair', hasArt: true },
  'edge-cut': { hotspot: [24, 24], fallback: 'crosshair', hasArt: true },
  // No block in this one's art, so it acts from the eraser's working end.
  eraser: { hotspot: [14, 35], fallback: 'crosshair', hasArt: true },
  // The block the item comes down on, not the item held above it.
  place: { hotspot: [24, 32], fallback: 'copy', hasArt: true },
  // Each arrow cursor acts from its OWN arrow's tip, which is why these differ: the art places
  // the arrow where that cursor's composition wants it. The three below share one number because
  // they are one cursor with a mark added, and the app swaps between them under a standing
  // pointer — their arrow is the same arrow at the same place, and the mark goes around it.
  select: { hotspot: [9, 11], fallback: 'default', hasArt: true },
  'select-add': { hotspot: [9, 11], fallback: 'default', hasArt: true },
  'select-remove': { hotspot: [9, 11], fallback: 'default', hasArt: true },
  // Its arrow is `select`'s, at `select`'s position, so the tip does not move when the
  // modifier swaps them; the tile is larger only to leave room for the band it drags.
  marquee: { hotspot: [9, 11], size: 60, fallback: 'crosshair', hasArt: true },
  // Symmetric cursors act from their middle. `move` is the move TOOL (panning the view); the two
  // hands are grabbing an object — open where one can be grabbed, closed once it has been.
  move: { hotspot: [24, 24], fallback: 'move', hasArt: true },
  'hand-open': { hotspot: [24, 20], fallback: 'grab', hasArt: true },
  'hand-closed': { hotspot: [24, 20], fallback: 'grabbing', hasArt: true },
  // The 3D CAMERA turning, and nothing else. Turning an OBJECT is a button press, so the rotate
  // handle takes the clickable pointer every other button does.
  orbit: { hotspot: [21, 24], fallback: 'all-scroll', hasArt: true },
  // A busy cursor is a platform convention (and often animated); let the OS draw it.
  busy: { hotspot: [0, 0], fallback: 'progress', hasArt: false },

  // The DOM set: everything outside the canvas is one of these four.
  default: { hotspot: [8, 8], fallback: 'default', hasArt: true },
  // The arrow sits at the lower right of its highlight ring, and acts from its own tip there.
  clickable: { hotspot: [27, 27], fallback: 'pointer', hasArt: true },
  blocked: { hotspot: [12, 21], fallback: 'not-allowed', hasArt: true },
  // An I-beam is symmetric and marks a caret position, so it acts from its middle.
  text: { hotspot: [24, 24], fallback: 'text', hasArt: true },
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
 * - `move`/`orbit`/`marquee`/`busy` — moving the view, turning the 3D camera, marquee and a long
 *   operation are always legal.
 * - `select` — "nothing here to act on" is not a refusal.
 * - `hand-open`/`hand-closed` — grabbing an object. The only refusable question (would the DROP be
 *   accepted?) has no answer at hover time: the drop cell is not known until the drag ends.
 * - `select-add`/`select-remove` — Ctrl over an object always toggles it; only which way varies.
 * - `edge-cut` — a cell's cut validity spans four independent corner slots, so there is no single
 *   yes/no for the cell under the pointer.
 * - the DOM four — not tool cursors, and no tool probes them. `blocked` already draws the badge
 *   in its own art, so listing it would stamp a second one.
 */
export const FORBIDDABLE: ReadonlySet<CursorId> = new Set<CursorId>([
  'mountain', 'water', 'road', 'eraser', 'place',
]);
