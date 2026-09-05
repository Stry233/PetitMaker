/**
 * The cursor catalogue: which cursors exist, where each one points, and what a browser
 * should fall back to.
 *
 * Separate from the art, so the set can be read and tested without loading an image. Adding a
 * cursor is one entry here plus one file in `src/assets/cursors/`.
 */

/** Semantic cursor names. Tools name one of these; nothing outside ui/design/cursors knows CSS. */
export type CursorId =
  | 'mountain' | 'water' | 'road' | 'eraser' | 'edge-cut'
  | 'place' | 'select' | 'move'
  | 'select-add' | 'select-remove'
  | 'hand-open' | 'hand-closed' | 'orbit' | 'marquee' | 'busy'
  | 'default' | 'clickable' | 'blocked' | 'text' | 'help';

/**
 * Logical pixel size of every cursor image, and so how big the cursor is on screen: a CSS
 * cursor is drawn at its image's intrinsic size.
 *
 * 32 IS A CEILING, NOT A TASTE. A custom cursor LARGER than 32 CSS px in either direction is shown
 * only while the whole image, placed by its hotspot, is inside the visual viewport; nearer an edge
 * than that the engine drops it and draws the declared fallback keyword instead, so the pointer
 * hands itself back to the OS as it reaches for anything at the edge of the window. It is an
 * anti-spoofing rule (a large cursor can be drawn to imitate browser UI) and both Blink and Gecko
 * enforce it, at exactly 32. At 32 the test is never applied. The drawing inside the tile is
 * smaller again, so this is not how big a cursor LOOKS.
 *
 * The art is generated at this size; change it there and this must follow, since hotspots are in
 * image pixels and `cursors.test.ts` fails on a mismatch. (128 px is the size above which a cursor
 * image is ignored outright, which the rule above makes moot.)
 *
 * Each drawing is ONE SVG declaring this intrinsic size, rasterised by the engine for whatever
 * device pixels the screen has under the same box. That changes nothing here: a hotspot is in CSS
 * pixels of the intrinsic tile, whichever scale the browser rasterises at.
 */
export const CURSOR_SIZE = 32;

export interface CursorSpec {
  /** The acting pixel, in image coordinates. */
  hotspot: readonly [number, number];
  /** Pixel size of THIS cursor's image, when it is not `CURSOR_SIZE`. A cursor whose composition
   *  needs more room around the same-sized art gets a bigger tile rather than bigger art. Nothing
   *  needs one today: every drawing is rendered smaller than its tile, so the marks and the band
   *  the selection cursors carry fit in the room that leaves. */
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
  // The three build brushes and the object placer are ONE arrow: putting something on the map is
  // one act, whatever is being put there. So they share the tip they act from, and switching
  // between them leaves the pointer looking and pointing exactly where it was.
  mountain: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  water: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  road: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  place: { hotspot: [2, 2], fallback: 'copy', hasArt: true },
  // The trimmer and the eraser are that same arrow. A cursor whose only message is "this tool is
  // armed" has nothing left to say: the preview cell under the pointer carries the tool's own
  // picture, so the pointer says where it points and the cell says what will happen there.
  'edge-cut': { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  eraser: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  // Each arrow cursor acts from its OWN arrow's tip. The four below share one number because they
  // are one arrow with a mark added, and the app swaps between them under a standing pointer —
  // the arrow is the same arrow at the same place, and the mark goes in the room beside it.
  select: { hotspot: [2, 2], fallback: 'default', hasArt: true },
  'select-add': { hotspot: [2, 2], fallback: 'default', hasArt: true },
  'select-remove': { hotspot: [2, 2], fallback: 'default', hasArt: true },
  marquee: { hotspot: [2, 2], fallback: 'crosshair', hasArt: true },
  // Symmetric cursors act from their middle. `move` is the move TOOL (panning the view) and its
  // four arrows leave that middle unpainted, which is the one hotspot in the set with nothing
  // drawn under it. The two hands are grabbing an object — open where one can be grabbed, closed
  // once it has been — and act from where the fingers close, the same pixel in both, so the grip
  // does not travel as the hand shuts.
  // The fallback is `grab`, NOT the literal `move` keyword: macOS renders `move` as the CLOSED
  // hand, so under system cursors the tool read as a grip that never releases. `grab` opens at
  // idle and the controller's system-mode pan answers `hand-closed` (`grabbing`), so the hand
  // closes exactly while the view is being dragged.
  move: { hotspot: [16, 16], fallback: 'grab', hasArt: true },
  'hand-open': { hotspot: [16, 17], fallback: 'grab', hasArt: true },
  'hand-closed': { hotspot: [16, 17], fallback: 'grabbing', hasArt: true },
  // The 3D CAMERA turning, and nothing else. Turning an OBJECT is a button press, so the rotate
  // handle takes the clickable pointer every other button does. The turn's own pivot is what it
  // acts from: the middle of the arc, inside the sweep it draws.
  orbit: { hotspot: [16, 16], fallback: 'all-scroll', hasArt: true },
  // A busy cursor has to MOVE (a static one reads as stuck), so it is the set's one animated
  // cursor: `hasArt` is false because no single `busy.svg` exists — the art is a frame ring
  // (`cursor-art.busyFrame`) the controller cycles, the arrow with a spinner at its shoulder, so
  // it acts from the arrow's own tip. The OS keyword survives as the fallback and the
  // system-preference answer.
  busy: { hotspot: [2, 2], fallback: 'progress', hasArt: false },

  // The DOM set: everything outside the canvas is one of these four. The plain arrow and the
  // canvas's `select` are the same drawing, so they act from the same pixel of it.
  default: { hotspot: [2, 2], fallback: 'default', hasArt: true },
  clickable: { hotspot: [2, 2], fallback: 'pointer', hasArt: true },
  // A refusal sign is a symbol rather than a pointer: it marks the spot it refuses.
  blocked: { hotspot: [16, 16], fallback: 'not-allowed', hasArt: true },
  // An I-beam marks a caret position, so it acts from the middle of its stem. That stem is one pixel
  // left of the tile's own middle: a 2px stroke centred on the tile straddles a pixel BOUNDARY, which
  // costs the stem a hard edge at fractional display scales, so the drawing gives up the pixel
  // instead.
  text: { hotspot: [15, 16], fallback: 'text', hasArt: true },
  // The Help Center's "what's this?" pick mode. Left to the OS keyword until the painted set gains
  // a question-mark drawing of its own: the mode is rare and momentary, and the platform's help
  // arrow already says exactly what it means.
  help: { hotspot: [2, 2], fallback: 'help', hasArt: false },
};

export const CURSOR_IDS = Object.keys(CURSORS) as CursorId[];

/**
 * The cursors the DOM shows, and the custom property each is published under.
 *
 * These names are the whole contract between the writer (`cursor-vars`, which resolves each to
 * a CSS value on `<html>`) and the readers (`ui/design/styles`'s `cursors` tokens, plus the global
 * rules in `cursors.css`). They live here, in the module that imports nothing, so `ui/design/styles`
 * can name them without importing the art — which imports `ui/design/styles` back.
 */
export const DOM_CURSORS = {
  default: '--pw-cursor-default',
  clickable: '--pw-cursor-clickable',
  blocked: '--pw-cursor-blocked',
  text: '--pw-cursor-text',
  help: '--pw-cursor-help',
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
 *   yes/no for the cell under the pointer. (It wears the arrow like the brushes do, but an arrow
 *   with no answer to badge.)
 * - the DOM four — not tool cursors, and no tool probes them. `blocked` IS the refusal sign, so
 *   listing it would stamp a second one on top of it.
 */
export const FORBIDDABLE: ReadonlySet<CursorId> = new Set<CursorId>([
  'mountain', 'water', 'road', 'eraser', 'place',
]);
