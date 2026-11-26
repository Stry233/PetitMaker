/*
 * The tour's reels: which set a card plays (the reader's locale, else English, for the live input
 * mode and layout shape), which encoding the engine plays, and each reel's segments. The set's
 * format is `assets/tour/reel-set.ts`'s.
 *
 * Lite's table is empty (`reel-files.ts`), so its cards find no reel; `SUPPORTS_TOUR_REELS` also
 * drops the fetches from its bundle, whose container has none.
 */
import type { Locale } from '../../../core/model/locale';
import {
  REEL_FALLBACK_LOCALE, REEL_TYPES, reelPaths, reelTimingIn, type ReelForm, type ReelTiming,
} from '../../../assets/tour/reel-set';
import { readJsonOnce } from '../../../platform/async/json-read';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { playsVideo } from '../../../platform/device/video-format';
import { SUPPORTS_TOUR_REELS } from '../../../platform/build/edition';
import type { I18nKey } from '../../../i18n/keys';
import { REEL_FILES } from './reel-files';
import type { TourKind } from './deck';

/** The form recorded for an input mode and a screen shape. */
export function reelForm(inputMode: InputMode, shape: LayoutShape): ReelForm {
  return `${inputMode === 'touch' ? 'touch' : 'mouse'}-${shape === 'portrait' ? 'tall' : 'land'}`;
}

export interface ReelFiles {
  webm: string | null;
  mp4: string | null;
  poster: string | null;
  /** The set's timing table. */
  timing: string | null;
  kind: TourKind;
}

let files: Readonly<Record<string, string>> = REEL_FILES;
const fileOf = (path: string): string | null => files[path] ?? null;

/** Test seam: reads reels from `table` instead of the shipped set; `null` restores it. */
export function __setReelFiles(table: Readonly<Record<string, string>> | null): void { files = table ?? REEL_FILES; }

/** The reel `kind` plays in `locale` and `form`: that locale's where its set holds the reel, else
 *  English's; null where neither does. */
export function reelFiles(locale: Locale, form: ReelForm, kind: TourKind): ReelFiles | null {
  for (const from of locale === REEL_FALLBACK_LOCALE ? [locale] : [locale, REEL_FALLBACK_LOCALE]) {
    const paths = reelPaths(from, form, kind);
    const webm = fileOf(paths.webm);
    const mp4 = fileOf(paths.mp4);
    if (!webm && !mp4) continue;
    return { webm, mp4, poster: fileOf(paths.poster), timing: fileOf(paths.timing), kind };
  }
  return null;
}

/** The file the engine's `<video>` will choose among the reel's sources, in the order they are offered. */
export function playedReel(files: ReelFiles): string | null {
  if (files.webm && playsVideo(REEL_TYPES.webm)) return files.webm;
  return files.mp4 && playsVideo(REEL_TYPES.mp4) ? files.mp4 : files.webm ?? files.mp4;
}

/** The reel's segments from its set's timing table; a table that does not arrive reads as none, and
 *  the reel plays without segments until a card asks again. */
export function reelTiming(files: ReelFiles): Promise<ReelTiming | null> {
  const url = files.timing;
  if (!SUPPORTS_TOUR_REELS || !url) return Promise.resolve(null);
  return readJsonOnce(url).then((table) => reelTimingIn(table, files.kind));
}

/** The caption each segment shows under its reel, by kind and segment id. A segment with no caption
 *  here shows none. Mouse wording; touch readings are in `i18n/terms/device-readings.ts`. */
export const REEL_CAPTIONS: Readonly<Record<TourKind, Readonly<Record<string, I18nKey>>>> = {
  welcome: {
    pick: 'tour.reel.welcome.pick', size: 'tour.reel.welcome.size', spray: 'tour.reel.welcome.spray',
    'river-pick': 'tour.reel.welcome.river_pick', river: 'tour.reel.welcome.river',
    'wood-pick': 'tour.reel.welcome.wood_pick', wood: 'tour.reel.welcome.wood', see: 'tour.reel.welcome.see',
  },
  move: {
    drag: 'tour.reel.move.drag', zoom: 'tour.reel.move.zoom', space: 'tour.reel.move.space', turn: 'tour.reel.move.turn',
    fit: 'tour.reel.move.fit',
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
  blueprint: {
    pick: 'tour.reel.blueprint.pick', place: 'tour.reel.blueprint.place', turn: 'tour.reel.blueprint.turn',
    move: 'tour.reel.blueprint.move', frame: 'tour.reel.blueprint.frame', save: 'tour.reel.blueprint.save',
    library: 'tour.reel.blueprint.library',
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
