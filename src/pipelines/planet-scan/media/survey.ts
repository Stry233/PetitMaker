import { placeWindow, WindowSurvey, type Placement, type PictureSize, type ScanFraming } from '../frame/framing';
import { InsetSurvey } from '../frame/hud';
import { SCAN_PROFILE } from '../profile';
import type { RgbaImage } from '../types';

// The survey of a recording before its scan: a few of its pictures, drawn twice, give the game
// window (`framing.ts:WindowSurvey`) and then, drawn where the scan reads them, the HUD's inset
// (`hud.ts:InsetSurvey`). Both decoding paths and the internal evaluations run it.

/** Draws the surveyed pictures of a recording at `placement`, handing each to `each`. */
export type DrawSamples = (placement: Placement, each: (frame: RgbaImage) => void) => Promise<void>;

/** The recording's framing, or null when no window is found or the window is too small to read. */
export async function surveyFraming(picture: PictureSize, draw: DrawSamples): Promise<ScanFraming | null> {
  const survey = new WindowSurvey(picture);
  await draw(survey.placement, (frame) => survey.add(frame));
  const window = survey.window();
  if (!window) return null;
  const placed = placeWindow(window, picture);
  const insets = new InsetSurvey(placed.window);
  await draw(placed.placement, (frame) => insets.add(frame));
  return { ...placed, hudInset: insets.inset() };
}

/** `count` survey times of a recording `duration` seconds long, spread evenly across it. */
export function surveyTimes(duration: number, count: number = SCAN_PROFILE.window.frames): number[] {
  return Array.from({ length: count }, (_, k) => ((k + 0.5) * duration) / count);
}
