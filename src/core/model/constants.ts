export const CHUNK_SIZE = 16;
export const CHUNK_LOAD_LIMIT = 10_000;
/**
 * Whether chunk load limits are enforced. Off for now: the real in-game load values are
 * unknown, so every placement is free (effective load 0). The enforcement is fully wired
 * and footprint-correct (see rules/chunk-load.ts) — flip this to true and set real catalog
 * loadValues to enable it.
 */
export const CHUNK_LOAD_ENABLED = false;

export const ELEVATION_MAX = 8;

export const TILE_SIZE = 64;

/** The reserved id (object id + catalogId) of the immutable central-plaza object. */
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

export const ZONE_COLORS: Record<number, string> = {
  0: '#97e1ff',
  1: '#ffe793',
  2: '#b1e291',
  3: '#e2e8f0',
  4: '#f7c68c',
};
