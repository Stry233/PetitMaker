/**
 * The 3D-model registry — the per-item 3D data, read from each catalog item's
 * `model3d` field (the bespoke ModelSpec inlined into the catalog alongside the
 * item's metadata). Pure data (no three.js) so the object-instance builder can
 * ask `hasModel()` without pulling in the renderer.
 *
 * An item with no `model3d` falls back to its category archetype (object-
 * archetypes.ts), so adding a bespoke model is purely additive — set the field on
 * the catalog item. (Schema-forward: the field may later carry a `ref` to a real
 * model file; build-model.ts would consume it, the spec staying the default.)
 */
import type { ModelSpec } from '../../../core/model/model-spec';
import { getCatalogItem, getAllItems } from '../../../state/catalog';

export function hasModel(catalogId: string): boolean {
  return getCatalogItem(catalogId)?.model3d !== undefined;
}

export function getSpec(catalogId: string): ModelSpec | undefined {
  return getCatalogItem(catalogId)?.model3d;
}

/** All catalogIds that have a bespoke 3D model (for tests / diagnostics). */
export function modeledIds(): string[] {
  return getAllItems().filter((item) => item.model3d !== undefined).map((item) => item.id);
}
