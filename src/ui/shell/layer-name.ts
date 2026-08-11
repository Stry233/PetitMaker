/**
 * What a floor of the stack is CALLED, in one place.
 *
 * The ground is not "layer 0". It stores no terrain cell at all — `terrain: null` is grass, and the
 * whole model treats the ground as the implicit base the eight layers stand on — so the numbering
 * starts where the stored floors do and the base has a word instead. That is a fact about the map,
 * and a reading of "Layer 0" hides it behind an index.
 *
 * It is one module rather than a line in each panel because the layer stack is named in several
 * places at once, and sharing only the pair of i18n keys is not enough to keep them agreeing:
 * naming a floor in two components is how a panel comes to head itself "Layer 0" over a tile
 * reading "Ground".
 */

/** The translator, as `i18n/context:useT` returns it. */
type Translate = (key: string, params?: Record<string, string | number>) => string;

export function layerName(t: Translate, elevation: number): string {
  return elevation === 0 ? t('layer.ground') : t('layer.name', { n: elevation });
}
