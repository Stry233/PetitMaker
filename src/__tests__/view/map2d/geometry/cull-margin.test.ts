import { describe, it, expect } from 'vitest';
import { CULL_MARGIN_PX } from '../../../../view/map2d/geometry/chunk-cull';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { isLandmarkItem } from '../../../../core/model/landmarks';
import { longestFootprintSide } from '../../../../core/model/traits';
import { getKnownItems } from '../../../../state/catalog';

describe('2D cull margin', () => {
  it('covers every bucketed item at its longest, a bridge at its widest span included', () => {
    for (const item of getKnownItems().filter((i) => !isLandmarkItem(i.id))) {
      expect(longestFootprintSide(item) * TILE_SIZE * 1.1, item.id).toBeLessThanOrEqual(CULL_MARGIN_PX);
    }
  });

  it('stays below every landmark, which is drawn unbucketed', () => {
    for (const item of getKnownItems().filter((i) => isLandmarkItem(i.id))) {
      expect(longestFootprintSide(item) * TILE_SIZE, item.id).toBeGreaterThan(CULL_MARGIN_PX);
    }
  });
});
