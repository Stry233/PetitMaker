/**
 * Retired catalog ids, and the item a save carrying one now loads as.
 *
 * The four plain colour road surfaces (`road-dirt`/`road-stone`/`road-brick`/`road-slate`) had no
 * counterpart in the game, so a map paved with them could not be rebuilt there — which is the one
 * thing a map made here has to be. They were removed, and each reads as the in-game path surface
 * nearest it in material and colour, so a save, an autosave or a share code made before the removal
 * still opens as a map somebody can build.
 *
 * ONE PLACE, because there is one door: every load goes through `json-codec.ts:deserialize`, share
 * codes included (a raster import decodes the payload, gates it on the content hash, then hands the
 * save JSON to that same loader). The undo history a sectioned export carries is replayed straight
 * into state, so `history-codec.ts` reads the map too.
 *
 * THE SHARE FORMAT IS UNTOUCHED. An object's catalog item travels as an INDEX into
 * `share/codec/catalog-order.ts`, and the content hash covers the ids the decoder produced — so the
 * retired names keep their slots there and the mapping happens after the gate, where decoded objects
 * become a GridState. Renumbering the order, or mapping inside the coded bytes, would turn every
 * code already in the wild into a hash mismatch.
 *
 * An entry is permanent: nothing rewrites a file in place, so the oldest save must still resolve.
 */
export const RETIRED_CATALOG_IDS: Readonly<Record<string, string>> = {
  'road-dirt': 'path-overgrown-dirt',
  'road-stone': 'path-garden-stone',
  'road-brick': 'path-lattice-red-brick',
  'road-slate': 'path-urban-asphalt',
};

/** What a retired id reads as now; any other id unchanged. */
export function currentCatalogId(id: string): string {
  return RETIRED_CATALOG_IDS[id] ?? id;
}
