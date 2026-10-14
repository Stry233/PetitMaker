/**
 * The 3D-model registry: the per-item 3D data from `config/catalog/models.ts`. Pure data (no three.js)
 * so the object-instance builder can ask `hasModel()` without pulling in the renderer.
 *
 * This module is the 3D view's only import of the model table, so the table rides in the scene's lazy
 * chunk and every path that preloads the scene preloads the models with it.
 *
 * An item with no `model3d` falls back to its category archetype (object-archetypes.ts), so adding a
 * bespoke model is purely additive: add the item's `<id>.model.json` sidecar.
 */
import type { DeckModelSpec, ModelSpec } from '../../../config/catalog/model-spec';
import { CATALOG_MODELS } from '../../../config/catalog/models';
import { getKnownItems } from '../../../state/catalog';

export function hasModel(catalogId: string): boolean {
  return CATALOG_MODELS[catalogId]?.model3d !== undefined;
}

export function getSpec(catalogId: string): ModelSpec | undefined {
  return CATALOG_MODELS[catalogId]?.model3d;
}

/** The parts an item stands on its deck when placed as a platform object. */
export function getDeckSpec(catalogId: string): DeckModelSpec | undefined {
  return CATALOG_MODELS[catalogId]?.deckModel3d;
}

/** All catalogIds that have a bespoke 3D model, in catalog order (for tests / diagnostics). */
export function modeledIds(): string[] {
  return getKnownItems().filter((item) => hasModel(item.id)).map((item) => item.id);
}

/** Only terrain-coloured models need separate instance geometry at each elevation. */
export function modelGroupKey(catalogId: string, elevation: number): string {
  const dynamic = getSpec(catalogId)?.parts.some(part => part.terrainGradient);
  return `m:${catalogId}${dynamic ? `:${elevation}` : ''}`;
}
