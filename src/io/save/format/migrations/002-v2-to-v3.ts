import type { Migration } from '../types';

/**
 * Version 3 lays the landmarks at the game's layout: the Neighbor Center's plaza moved and grew on
 * the built-in planets and took a larger footprint on custom ones, and the station joined both. A v2
 * save keeps its cells and objects; the decoder takes off whatever a landmark now stands over. Its
 * undo history was recorded against the earlier layout, and undo replays entries without the rules,
 * so the step drops it.
 */
export const v2ToV3: Migration = {
  from: 2,
  description: 'Drop undo history recorded against the earlier landmark layout',
  migrate: (raw) => {
    const { history: _history, ...rest } = raw;
    return rest;
  },
};
