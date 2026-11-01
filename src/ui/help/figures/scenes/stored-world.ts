/** A scene world's base as `figure-cache.ts` keeps it: plain structured-clone data, the template
 *  left out and taken back from the catalog by id. */
import { getMapTemplate } from '../../../../config/maps';
import type { GridState } from '../../../../core/model/types';

/** The fields a world takes from its base (`cloneGridState`'s), which are all a stored world holds. */
export type StoredWorld = Pick<GridState, 'cells' | 'objects' | 'lockedLayers' | 'ignoreChunkLoad' | 'imageAttribution'>;

export function storedWorld(state: GridState): StoredWorld {
  return {
    cells: state.cells, objects: state.objects, lockedLayers: state.lockedLayers,
    ignoreChunkLoad: state.ignoreChunkLoad, ...(state.imageAttribution ? { imageAttribution: state.imageAttribution } : {}),
  };
}

export function restoredWorld(templateId: string | undefined, stored: StoredWorld): GridState {
  return { ...stored, template: getMapTemplate(templateId), objectsVersion: 0, cellsVersion: 0 };
}

