import { describe, expect, it } from 'vitest';
import { ItemCategory } from '../../config/catalog/categories';
import { isBridge, isCoatingItem, isCrossing, isRamp, rampDropLayers, findTrait } from '../../core/model/traits';
import { getKnownItems, landmarkItem } from '../../state/catalog';

// The behavioural predicates the rules, tools and renderers ask answer exactly as the shelf
// category would for every known item, so asking by trait decides the same thing.
describe('trait predicates agree with the catalog categories', () => {
  const items = [...getKnownItems(), landmarkItem()];

  it.each(items.map((item) => [item.id, item] as const))('%s', (_id, item) => {
    expect(isCoatingItem(item)).toBe(item.category === ItemCategory.Road);
    expect(isBridge(item)).toBe(item.category === ItemCategory.Bridge);
    expect(isRamp(item)).toBe(item.category === ItemCategory.Ramp);
    expect(isCrossing(item)).toBe(item.category === ItemCategory.Bridge || item.category === ItemCategory.Ramp);
  });

  it('reads a missing item as none of them', () => {
    for (const p of [isCoatingItem, isBridge, isRamp, isCrossing]) expect(p(undefined)).toBe(false);
  });

  it('types the found trait and reads a ramp drop from it', () => {
    for (const item of items.filter(isRamp)) expect(rampDropLayers(item)).toBe(findTrait(item, 'heightDrop')!.layers);
    expect(rampDropLayers(undefined)).toBe(1);
  });
});
