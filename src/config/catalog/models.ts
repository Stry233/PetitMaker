/**
 * Every catalog item's declarative 3D model, one `<id>.model.json` sidecar beside its item JSON in
 * its category folder, found by file name; the anchor landmark's body is `landmark.model.json`.
 *
 * Models are about 96% of the catalog's bytes, so they live apart from the item records the editor
 * parses at boot and the generation workers parse per worker. Only the 3D model registry and the
 * procedural stylize renderer import this module, which keeps it in their lazy chunks; the eager
 * bundle and worker graph tests pin that.
 */
import type { DeckModelSpec, ModelSpec } from './model-spec';
import anchorBody from './landmark.json';
import anchorLandmark from './landmark.model.json';

export interface CatalogModel {
  /** Bespoke low-poly model. Absent: the item renders as its category archetype. */
  readonly model3d?: ModelSpec;
  /** Parts standing on the deck when the item is placed as a platform object. */
  readonly deckModel3d?: DeckModelSpec;
}

const sidecars = import.meta.glob('./*/*.model.json', { eager: true, import: 'default' });

/** Keyed by catalog id; `landmark.model.json` holds the anchor landmark body's (`landmark.json`) deck.
 *  JSON imports type tuples as plain arrays, so the table is asserted to the spec it was authored to. */
export const CATALOG_MODELS: Readonly<Record<string, CatalogModel>> = Object.fromEntries([
  ...Object.entries(sidecars).map(([path, model]) => [path.slice(path.lastIndexOf('/') + 1, -'.model.json'.length), model]),
  [anchorBody.id, anchorLandmark],
]) as Record<string, CatalogModel>;
