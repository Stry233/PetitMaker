import type { CatalogItem } from '../../../core/model/types';
import { rampDropLayers } from '../../../core/model/traits';
import { crossingPool } from '../../placement/crossings';

/** The ramp styles a street flight may use. A flight stands one ramp on each tier step, so only
 *  one-layer climbs qualify. */
export function rampStyles(): CatalogItem[] {
  return crossingPool('ramp').filter((item) => rampDropLayers(item) === 1);
}

/** The longest run of any offered ramp style: terrace planning reserves this much per tier. */
export function maxRampRun(): number {
  return Math.max(0, ...rampStyles().map((item) => item.height));
}
