export const TILE_SIZE = 64;

/** The reserved id (object id and catalogId) of the template landmark. Saves and share codes carry it.
 *  Code asks the landmark helpers in `grid-model.ts`; only the catalog, which registers the item, reads the id. */
export const PLAZA_ID = '__plaza__';
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4.0;
/** Camera pan bound: at least this many css px of map (or half the map, when it
 *  renders smaller) stay inside the canvas on each axis — the map can be pushed
 *  mostly off-screen but never lost. */
export const PAN_KEEP_PX = 160;

export const ELEVATION_COLORS: Record<number, string> = {
  0: '#b1e291',
  1: '#A3D070',
  2: '#93c956',
  3: '#79c440',
  4: '#5cb837',
  5: '#4ca42a',
  6: '#3e941d',
  7: '#298c19',
  8: '#1b7511',
};

export const WATER_COLOR = '#97e1ff';

/** The warning red over map content an edit would lose, and under an invalid placement ghost, in
 *  every view that draws it. */
export const LOSS_COLOR = '#e2574c';

export const ZONE_COLORS: Record<number, string> = {
  0: '#97e1ff',
  1: '#ffe793',
  2: '#b1e291',
  3: '#e2e8f0',
  4: '#f7c68c',
};
