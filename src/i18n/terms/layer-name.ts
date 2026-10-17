import type { Translate } from '../keys';
import { layerNumber } from '../../core/game/profile';

/** What a layer is called, by the game's numbering: the ground is layer 1. Every surface naming a
 *  layer in words reads this or, on the layer panel and its rail readout, `layerTileName`. */
export function layerName(t: Translate, elevation: number): string {
  return t('layer.name', { n: layerNumber(elevation) });
}

/** A layer's name on the layer panel's tiles and the rail readout, the short form a locale may
 *  write there (zh drops the ordinal). */
export function layerTileName(t: Translate, elevation: number): string {
  return t('layer.tile', { n: layerNumber(elevation) });
}

/** A layer's bare number, for a surface with no room for its name (the number cells, an object's
 *  label, the export footer's peak). */
export function layerNumeral(elevation: number): string {
  return String(layerNumber(elevation));
}
