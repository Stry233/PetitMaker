import { ItemCategory } from '../../../core/model/types';
import { getPlaceableByCategory } from '../../../state/catalog';

/** Terrace planning reserves enough run for every offered ramp style. */
export const MAX_RAMP_RUN = Math.max(0, ...getPlaceableByCategory(ItemCategory.Ramp).map((item) => item.height));
