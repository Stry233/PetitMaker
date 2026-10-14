import type { CatalogItem } from '../../../core/model/types';
import facility_pavilion from './facility-pavilion.json';
import facility_shop from './facility-shop.json';

/** `facility-station.json` is the station landmark's body (`catalog/landmarks.ts`), kept out of this barrel. */
export const facility: CatalogItem[] = [facility_pavilion, facility_shop] as CatalogItem[];
