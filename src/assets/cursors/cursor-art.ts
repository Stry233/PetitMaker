/**
 * Maps a CursorId to the SVG beside this file, plus a pre-badged variant for each cursor that can
 * refuse.
 *
 * The SVGs are GENERATED from the project's design source, so a change to a cursor is a change
 * to the artwork it comes from, not to this module.
 *
 * ONE file per drawing, at every display: an SVG cursor is the only kind every engine rasterises
 * at the screen's own scale (Gecko draws a raster cursor at 1x and upscales it; Chromium's broken
 * Wayland path draws a raster at raw pixel size — both rasterise an SVG at the device scale
 * first), so the resolution ladder the PNG set needed does not exist here. Each file declares its
 * own 32px intrinsic size; the line drawings inside are geometry and the painted masses ride along
 * as embedded 2x renders.
 *
 * Each cursor that can refuse carries the badge in its art: one refusal sign shrunk into a corner
 * of that cursor's own drawing, since where a badge fits depends on the silhouette under it.
 */
import { CURSORS, type CursorId } from '../../core/runtime/cursor-spec';

const modules = import.meta.glob('../../assets/cursors/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Basename (a CursorId, or `<CursorId>-forbidden`) → resolved URL. */
const ART: Record<string, string> = {};
for (const path in modules) {
  ART[path.split('/').pop()!.replace('.svg', '')] = modules[path]!;
}

/**
 * Cursors whose art ALREADY carries the refusal badge, so asking for `forbidden` must not
 * reach for a second, doubly-badged file.
 */
const SELF_BADGED: ReadonlySet<CursorId> = new Set<CursorId>(['blocked']);

/**
 * The image URL for a cursor, or null when the catalogue leaves it to the OS.
 *
 * `forbidden` selects the badged variant where one was drawn. Every id that can be asked is in
 * `FORBIDDABLE` and has one; any other id falls back to its plain art rather than going
 * imageless, so a caller that asks anyway still gets a cursor.
 */
export function cursorArt(id: CursorId, opts: { forbidden?: boolean } = {}): string | null {
  if (!CURSORS[id].hasArt) return null;
  if (opts.forbidden && !SELF_BADGED.has(id)) {
    const badged = ART[`${id}-forbidden`];
    if (badged !== undefined) return badged;
  }
  return ART[id] ?? null;
}

/** The ids that have a badged variant. Exported so a test can hold it to FORBIDDABLE. */
export const BADGED_IDS: ReadonlySet<string> = new Set(
  Object.keys(ART).filter((k) => k.endsWith('-forbidden')).map((k) => k.replace('-forbidden', ''))
);

/**
 * The busy spinner's frames (`busy-0.svg` …), counted off the shipped files. `busy` is the one
 * ANIMATED cursor — a long operation is running and a static custom cursor reads as stuck — so
 * instead of one file it ships a ring the cursor controller cycles while the state holds; the OS
 * `progress` keyword survives as its fallback and its system-preference answer.
 */
export const BUSY_FRAME_COUNT: number = Object.keys(ART).filter((k) => /^busy-\d+$/.test(k)).length;

/** One frame of the busy ring, or null where the set ships none. */
export function busyFrame(frame: number): string | null {
  if (BUSY_FRAME_COUNT === 0) return null;
  const n = ((frame % BUSY_FRAME_COUNT) + BUSY_FRAME_COUNT) % BUSY_FRAME_COUNT;
  return ART[`busy-${n}`] ?? null;
}
