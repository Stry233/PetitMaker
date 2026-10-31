/*
 * The tour's reels: which set a card plays (the reader's locale, else English, for the live input
 * mode and layout shape), which encoding the engine plays, and each reel's segments.
 *
 * A set lives at `assets/tour/<locale>/<form>/`: `<kind>.webm` (AV1), `<kind>.mp4` (H.264), `<kind>.jpg`
 * (the poster, the reel's last frame) and `reels.json` (`{ <kind>: { end, segs: [[segId, start], ...] } }`).
 * Lite's table is empty (`reel-files.ts`), so its cards find no reel; `SUPPORTS_TOUR_REELS` also
 * drops the fetches from its bundle, whose container has none.
 */
import type { Locale } from '../../../core/model/locale';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { playsVideo } from '../../../platform/device/video-format';
import { SUPPORTS_TOUR_REELS } from '../../../platform/build/edition';
import type { I18nKey } from '../../../i18n/keys';
import { REEL_FILES } from './reel-files';
import type { TourKind } from './deck';

/** The four arrangements a reel is recorded in: the input mode, then the screen's shape. */
export type ReelForm = 'mouse-land' | 'mouse-tall' | 'touch-tall' | 'touch-land';

export function reelForm(inputMode: InputMode, shape: LayoutShape): ReelForm {
  return `${inputMode === 'touch' ? 'touch' : 'mouse'}-${shape === 'portrait' ? 'tall' : 'land'}`;
}

/** Each form's recorded frame in video px (`scripts/internal/tour-reels/` records and exports at it). */
export const REEL_SIZE: Record<ReelForm, { w: number; h: number }> = {
  'mouse-land': { w: 960, h: 600 }, 'mouse-tall': { w: 410, h: 590 }, 'touch-tall': { w: 360, h: 480 }, 'touch-land': { w: 780, h: 360 },
};

/** Each form's recorded frame, width over height. */
export const REEL_ASPECT = Object.fromEntries(Object.entries(REEL_SIZE).map(([form, { w, h }]) => [form, w / h])) as Record<ReelForm, number>;

/** The `<source type>` each encoding declares, its codecs those the reels are encoded with, so an
 *  engine without AV1 skips the webm and a prefetch fetches what the element will play. */
export const REEL_TYPES = { webm: 'video/webm; codecs="av01.0.08M.08"', mp4: 'video/mp4; codecs="avc1.640020"' } as const;

/** The locale whose reels every other locale falls back to. */
const FALLBACK_LOCALE: Locale = 'en';

export interface ReelFiles {
  webm: string | null;
  mp4: string | null;
  poster: string | null;
  /** The set's timing table. */
  timing: string | null;
  kind: TourKind;
}

let files: Readonly<Record<string, string>> = REEL_FILES;
const fileOf = (locale: Locale, form: ReelForm, name: string): string | null => files[`${locale}/${form}/${name}`] ?? null;

/** Test seam: reads reels from `table` instead of the shipped set; `null` restores it. */
export function __setReelFiles(table: Readonly<Record<string, string>> | null): void { files = table ?? REEL_FILES; }

/** The reel `kind` plays in `locale` and `form`: that locale's where its set holds the reel, else
 *  English's; null where neither does. */
export function reelFiles(locale: Locale, form: ReelForm, kind: TourKind): ReelFiles | null {
  for (const from of locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE]) {
    const webm = fileOf(from, form, `${kind}.webm`);
    const mp4 = fileOf(from, form, `${kind}.mp4`);
    if (!webm && !mp4) continue;
    return { webm, mp4, poster: fileOf(from, form, `${kind}.jpg`), timing: fileOf(from, form, 'reels.json'), kind };
  }
  return null;
}

/** The file the engine's `<video>` will choose among the reel's sources, in the order they are offered. */
export function playedReel(files: ReelFiles): string | null {
  if (files.webm && playsVideo(REEL_TYPES.webm)) return files.webm;
  return files.mp4 && playsVideo(REEL_TYPES.mp4) ? files.mp4 : files.webm ?? files.mp4;
}

/** A reel's segments: each one's id and start in seconds, in order, and where the last ends. */
export interface ReelTiming { end: number; segs: readonly (readonly [id: string, start: number])[] }

type TimingTable = Partial<Record<string, ReelTiming>>;

/** One read per table per page; a table that does not arrive reads as none, and the reel plays
 *  without segments until a card asks again. */
const tables = new Map<string, Promise<TimingTable | null>>();

function isTiming(value: unknown): value is ReelTiming {
  const v = value as ReelTiming | null;
  return typeof v?.end === 'number' && Array.isArray(v.segs)
    && v.segs.every((s) => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'number');
}

export function reelTiming(files: ReelFiles): Promise<ReelTiming | null> {
  const url = files.timing;
  if (!SUPPORTS_TOUR_REELS || !url) return Promise.resolve(null);
  let table = tables.get(url);
  if (!table) {
    const read = fetch(url, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() as Promise<TimingTable> : null)).catch(() => null);
    // A failed read is forgotten, so the next card shown reads again.
    table = read.then((t) => { if (!t) tables.delete(url); return t; });
    tables.set(url, table);
  }
  return table.then((t) => {
    const timing = t?.[files.kind];
    return isTiming(timing) ? timing : null;
  });
}

/** Test hook: forget the tables read. */
export function __resetReelTimings(): void { tables.clear(); }

/** The caption each segment shows under its reel, by kind and segment id. A segment with no caption
 *  here shows none. Mouse wording; touch readings are in `i18n/terms/device-readings.ts`. */
export const REEL_CAPTIONS: Readonly<Record<TourKind, Readonly<Record<string, I18nKey>>>> = {
  welcome: {
    pick: 'tour.reel.welcome.pick', size: 'tour.reel.welcome.size', spray: 'tour.reel.welcome.spray',
    'river-pick': 'tour.reel.welcome.river_pick', river: 'tour.reel.welcome.river',
    'wood-pick': 'tour.reel.welcome.wood_pick', wood: 'tour.reel.welcome.wood', see: 'tour.reel.welcome.see',
  },
  move: {
    drag: 'tour.reel.move.drag', zoom: 'tour.reel.move.zoom', space: 'tour.reel.move.space', fit: 'tour.reel.move.fit',
    pinch: 'tour.reel.move.pinch', tool: 'tour.reel.move.tool', two: 'tour.reel.move.two',
  },
  shape: {
    pick: 'tour.reel.shape.pick', tier1: 'tour.reel.shape.tier1', tier2: 'tour.reel.shape.tier2',
    tier3: 'tour.reel.shape.tier3', carve: 'tour.reel.shape.carve', see: 'tour.reel.shape.see',
  },
  objects: {
    open: 'tour.reel.objects.open', carry: 'tour.reel.objects.carry', hold: 'tour.reel.objects.hold',
    drag: 'tour.reel.objects.drag', pick: 'tour.reel.objects.pick', plant: 'tour.reel.objects.plant',
  },
  view3d: {
    stand: 'tour.reel.view3d.stand', turn: 'tour.reel.view3d.turn', tilt: 'tour.reel.view3d.tilt',
    zoom: 'tour.reel.view3d.zoom', move: 'tour.reel.view3d.move', flat: 'tour.reel.view3d.flat',
  },
  generate: {
    open: 'tour.reel.generate.open', build: 'tour.reel.generate.build', area: 'tour.reel.generate.area',
    paint: 'tour.reel.generate.paint', maze: 'tour.reel.generate.maze', island: 'tour.reel.generate.island',
  },
  assistant: {
    open: 'tour.reel.assistant.open', connect: 'tour.reel.assistant.connect', model: 'tour.reel.assistant.model',
    order: 'tour.reel.assistant.order', plan: 'tour.reel.assistant.plan', build: 'tour.reel.assistant.build',
    done: 'tour.reel.assistant.done',
  },
  share: { open: 'tour.reel.share.open', keep: 'tour.reel.share.keep', friend: 'tour.reel.share.friend' },
};
