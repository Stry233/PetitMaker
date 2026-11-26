/**
 * The reel set's format: the forms a reel is recorded in, the two encodings and where each file of a
 * set sits. Separate from the files, so the format can be read without loading one.
 *
 * A set lives at `assets/tour/<locale>/<form>/`: `<kind>.webm` (AV1), `<kind>.mp4` (H.264), `<kind>.jpg`
 * (the poster, the reel's last frame) and `reels.json` (`{ <kind>: { end, segs: [[segId, start], ...] } }`).
 * `scripts/internal/tour-reels/` records and exports the sets and keeps its own copy of the forms.
 */
import type { Locale } from '../../core/model/locale';

/** The four arrangements a reel is recorded in: the input mode, then the screen's shape. */
export type ReelForm = 'mouse-land' | 'mouse-tall' | 'touch-tall' | 'touch-land';

/** Each form's recorded frame in video px. */
export const REEL_SIZE: Record<ReelForm, { w: number; h: number }> = {
  'mouse-land': { w: 960, h: 600 }, 'mouse-tall': { w: 410, h: 590 }, 'touch-tall': { w: 360, h: 480 }, 'touch-land': { w: 780, h: 360 },
};

/** Each form's recorded frame, width over height. */
export const REEL_ASPECT = Object.fromEntries(Object.entries(REEL_SIZE).map(([form, { w, h }]) => [form, w / h])) as Record<ReelForm, number>;

/** The `<source type>` each encoding declares, its codecs those the reels are encoded with, so an
 *  engine without AV1 skips the webm and a prefetch fetches what the element will play. */
export const REEL_TYPES = { webm: 'video/webm; codecs="av01.0.08M.08"', mp4: 'video/mp4; codecs="avc1.640020"' } as const;

/** The locale whose sets every other locale falls back to. */
export const REEL_FALLBACK_LOCALE: Locale = 'en';

/** Where the files of reel `kind` sit in the set of `locale` and `form`, as paths under `assets/tour/`. */
export function reelPaths(locale: Locale, form: ReelForm, kind: string): { webm: string; mp4: string; poster: string; timing: string } {
  const set = `${locale}/${form}`;
  return { webm: `${set}/${kind}.webm`, mp4: `${set}/${kind}.mp4`, poster: `${set}/${kind}.jpg`, timing: `${set}/reels.json` };
}

/** A reel's segments: each one's id and start in seconds, in order, and where the last ends. */
export interface ReelTiming { end: number; segs: readonly (readonly [id: string, start: number])[] }

function isTiming(value: unknown): value is ReelTiming {
  const v = value as ReelTiming | null;
  return typeof v?.end === 'number' && Array.isArray(v.segs)
    && v.segs.every((s) => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'number');
}

/** Reel `kind`'s timing in a set's `reels.json` as parsed, null where the table lacks it or its
 *  entry is not a timing. */
export function reelTimingIn(table: unknown, kind: string): ReelTiming | null {
  const timing = table !== null && typeof table === 'object' ? (table as Record<string, unknown>)[kind] : undefined;
  return isTiming(timing) ? timing : null;
}
