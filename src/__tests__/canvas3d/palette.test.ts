import { describe, it, expect } from 'vitest';
import { hexToRgb01, terrainColor, waterColor, objectColor } from '../../canvas/map3d/core/palette';
import { ELEVATION_COLORS, WATER_COLOR } from '../../core/model/constants';
import { ItemCategory } from '../../core/model/types';
import { animConfig } from '../../core/runtime/anim-config';

describe('preview3d/core/palette', () => {
  it('parses #rrggbb into 0..1 rgb', () => {
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
    const [r] = hexToRgb01('#80ffff');
    expect(r).toBeCloseTo(128 / 255);
  });

  it('maps an elevation to its ELEVATION_COLORS hue', () => {
    expect(terrainColor(3)).toEqual(hexToRgb01(ELEVATION_COLORS[3]!));
  });

  it('water uses WATER_COLOR', () => {
    expect(waterColor()).toEqual(hexToRgb01(WATER_COLOR));
  });

  it('an object with no own color falls back to its catalog category tint', () => {
    const c = objectColor({ color: undefined }, { category: ItemCategory.Tree, color: undefined });
    const expected = hexToRgb01('#' + animConfig.categoryColor[ItemCategory.Tree].toString(16).padStart(6, '0'));
    expect(c).toEqual(expected);
  });

  it("an object's own color (road / plaza) wins over the category tint", () => {
    const c = objectColor({ color: '#123456' }, { category: ItemCategory.Road, color: undefined });
    expect(c).toEqual(hexToRgb01('#123456'));
  });
});
