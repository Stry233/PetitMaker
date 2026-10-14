import type { RoadMaterialPattern } from '../../../config/catalog/road-material';

/** A pattern's square repeat in macro cells; the procedural patterns repeat every cell. */
export function roadPatternRepeat(pattern?: RoadMaterialPattern): number {
  return typeof pattern === 'object' ? pattern.repeat : 1;
}

const patternKeys = new WeakMap<object, string>();

/** Equal keys for equal patterns. Catalog patterns are immutable, so an object's key is computed once. */
export function roadPatternKey(pattern?: RoadMaterialPattern): string {
  if (typeof pattern !== 'object') return pattern ?? 'plain';
  let key = patternKeys.get(pattern);
  if (key === undefined) {
    key = JSON.stringify(pattern);
    patternKeys.set(pattern, key);
  }
  return key;
}
