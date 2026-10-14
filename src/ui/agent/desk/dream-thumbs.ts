import thumbVillage from '../../../assets/agent/dreams/dream-village.png';
import thumbForest from '../../../assets/agent/dreams/dream-forest.png';
import thumbRoad from '../../../assets/agent/dreams/dream-road.png';
import thumbPond from '../../../assets/agent/dreams/dream-pond.png';
import thumbHill from '../../../assets/agent/dreams/dream-hill.png';

/** Captures of the five sample orders' built outcomes, by order id. URL imports only, so the warm
 *  schedule can fetch them without loading the panel. */
export const DREAM_THUMBS: Readonly<Record<string, string>> = {
  village: thumbVillage, forest: thumbForest, road: thumbRoad, pond: thumbPond, hill: thumbHill,
};
