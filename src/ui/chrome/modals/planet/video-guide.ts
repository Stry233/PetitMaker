/**
 * The recording guide for the video import, as copy keys: the import window lists its steps and
 * Help's Change a planet page shows all of it, so both read these lists and no string is written
 * twice. A refusal opens Help at the fix for its reason.
 */
import type { I18nKey } from '../../../../i18n/keys';
import type { ImportFailure } from '../../../../pipelines/planet-scan';

/** How to record a planet, in order. */
export const VIDEO_STEPS = [
  'planet.video_step_window', 'planet.video_step_region', 'planet.video_step_zoom', 'planet.video_step_clear', 'planet.video_step_start',
  'planet.video_step_rows', 'planet.video_step_pause', 'planet.video_step_upload',
] as const;

/** What an import gives. */
export const VIDEO_GETS = ['planet.video_get_ground', 'planet.video_get_editor', 'planet.video_get_device'] as const;

/** What to add after an import. */
export const VIDEO_ADDS = ['planet.video_add_terrain', 'planet.video_add_objects', 'planet.video_add_unseen'] as const;

/** One fix: its copy, the Help anchor it stands at, and the refusals it answers. */
export interface VideoFix {
  readonly key: I18nKey;
  readonly anchor: `planet-video-fix-${string}`;
  readonly failures: readonly ImportFailure[];
}

export const VIDEO_FIXES: readonly VideoFix[] = [
  { key: 'planet.video_fix_zoom', anchor: 'planet-video-fix-zoom', failures: ['not-max-zoom', 'zoom-changed'] },
  { key: 'planet.video_fix_region', anchor: 'planet-video-fix-region', failures: ['region-load-off'] },
  { key: 'planet.video_fix_fast', anchor: 'planet-video-fix-fast', failures: ['too-fast'] },
  { key: 'planet.video_fix_coast', anchor: 'planet-video-fix-coast', failures: ['too-little'] },
  { key: 'planet.video_fix_large', anchor: 'planet-video-fix-large', failures: ['too-large'] },
  { key: 'planet.video_fix_blurry', anchor: 'planet-video-fix-blurry', failures: ['blurry'] },
  { key: 'planet.video_fix_long', anchor: 'planet-video-fix-long', failures: ['too-long'] },
];

/** Where the guide stands in Help. */
export const VIDEO_GUIDE_HELP = { page: 'planet', anchor: 'planet-video' } as const;

/** The Help anchor for a refusal: its fix, or the steps where its own message already says what to do. */
export function videoFixAnchor(failure: ImportFailure): string {
  return VIDEO_FIXES.find((fix) => fix.failures.includes(failure))?.anchor ?? VIDEO_GUIDE_HELP.anchor;
}
