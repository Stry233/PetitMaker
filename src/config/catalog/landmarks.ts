import type { CatalogEntry } from './catalog-entry';
import plaza from './landmark.json';
import station from './facility/facility-station.json';

/** The catalog item of each landmark in `core/game/profile.ts:LANDMARKS`, by the landmark's id. Its
 *  footprint, and its icon where the profile names one, come from the profile, so its JSON carries
 *  neither width nor height; no category barrel lists it, so no placement list offers it. */
export const LANDMARK_ITEMS = [plaza, station] as Omit<CatalogEntry, 'width' | 'height'>[];
