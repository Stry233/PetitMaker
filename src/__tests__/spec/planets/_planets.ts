/**
 * The planets a spec test opens: the built-in planets as the editor lists them, their landmarks as
 * laid objects, and a custom planet with a person's object on it.
 */
import { LANDMARKS } from '../../../core/game/profile';
import { createGridState } from '../../../core/model/template';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { createDefaultRegistry } from '../../../rules';
import type { GridState, MapTemplate, PlacedObject } from '../../../core/model/types';

/** Each landmark the map holds, by its profile entry. */
export function landmarksOf(state: GridState): { spec: (typeof LANDMARKS)[number]; object: PlacedObject | undefined }[] {
  return LANDMARKS.map((spec) => ({ spec, object: [...state.objects.values()].find((o) => o.catalogId === spec.id) }));
}

/** A map on `planet` with an apple tree a person placed at (x, y). */
export function mapOn(planet: MapTemplate, x = 38, y = 26): GridState {
  const state = createGridState(planet);
  const tree = candidateObject(getCatalogItem('tree-apple')!, { x, y }, 0, state, { id: 'tree' });
  if (!createExecutor(state, createDefaultRegistry()).execute(placeObjectCommand(tree)).success) throw new Error('the tree was refused');
  return state;
}
