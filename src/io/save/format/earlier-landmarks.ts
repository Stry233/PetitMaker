/**
 * Where the built-in planets laid their landmarks when a save of an earlier version was written,
 * for the versions whose layout differs from the current templates. A save never records its
 * landmarks, so this is the only account of where a map's content was arranged around them; the
 * load reads it to move what a landmark now stands over by as much as the landmark moved.
 */

/** A landmark's laid footprint, top-left on the half-cell grid, in cells. */
export interface EarlierLandmark { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Saves before version 3 laid only the plaza, 20 by 27 cells, before it moved to the game's layout sheet. */
const BEFORE_V3: Readonly<Record<string, readonly EarlierLandmark[]>> = {
  hexia: [{ id: '__plaza__', x: 76.5, y: 58.5, width: 20, height: 27 }],
  tafa: [{ id: '__plaza__', x: 76.5, y: 59.5, width: 20, height: 27 }],
};

/** The landmarks a save of `version` on the built-in planet `templateId` was written against, or
 *  undefined when they stood where the current template lays them. */
export function earlierLandmarks(templateId: string, version: number): readonly EarlierLandmark[] | undefined {
  return version < 3 && Object.prototype.hasOwnProperty.call(BEFORE_V3, templateId) ? BEFORE_V3[templateId] : undefined;
}
