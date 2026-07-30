import type { CatalogItem } from '../../../core/model/types';
import facility_station from './facility-station.json';
import facility_pavilion from './facility-pavilion.json';
import facility_shop from './facility-shop.json';

export const facility: CatalogItem[] = [facility_station, facility_pavilion, facility_shop] as CatalogItem[];
