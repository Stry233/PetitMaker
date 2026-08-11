/**
 * Maps a CursorId to one of the PNGs beside this file, plus a pre-badged variant for each
 * cursor that can refuse.
 *
 * The PNGs are GENERATED from the project's design source, so a change to a cursor is a change
 * to the artwork it comes from, not to this module.
 *
 * Each cursor that can refuse carries its badge in the art, placed by hand: where a badge fits
 * depends on the silhouette under it, and one fixed corner buries the brush tip on one cursor
 * and floats in empty space on another.
 */
import { CURSORS, type CursorId } from '../../core/runtime/cursor-spec';

const modules = import.meta.glob('../../assets/cursors/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Basename (a CursorId, or `<CursorId>-forbidden`) → resolved URL. */
const ART: Record<string, string> = {};
for (const path in modules) {
  ART[path.split('/').pop()!.replace('.png', '')] = modules[path]!;
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

/** The ids that have a hand-drawn badged variant. Exported so a test can hold it to FORBIDDABLE. */
export const BADGED_IDS: ReadonlySet<string> = new Set(
  Object.keys(ART).filter((k) => k.endsWith('-forbidden')).map((k) => k.replace('-forbidden', ''))
);
