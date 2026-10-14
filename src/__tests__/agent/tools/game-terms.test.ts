import { describe, it, expect } from 'vitest';
import {
  BUILDABLE_ZONES, UNBUILDABLE_ZONES, ZONE_ORDER, anchorTerm, bridgeSpanText, fixedFeatures, orList,
} from '../../../agent/tools/game-terms';
import { ZONES } from '../../../core/game/profile';
import { isBridge, findTrait } from '../../../core/model/traits';
import { getAllItems, landmarkItem } from '../../../state/catalog';
import { narrowestBridgeId } from '../../../tools/placement/crossings';

describe('the game terms the assistant reads', () => {
  it('names the zones from the profile, buildable ones first', () => {
    expect(ZONE_ORDER).toHaveLength(Object.keys(ZONES).length);
    expect(BUILDABLE_ZONES).toBe('grass');
    expect(UNBUILDABLE_ZONES).toEqual(['sea', 'beach', 'boundary']);
    expect(orList(UNBUILDABLE_ZONES)).toBe('sea, beach or boundary');
  });

  it('names the anchor landmark by its catalog name and id', () => {
    const item = landmarkItem();
    expect(anchorTerm()).toBe(`${item.name.en} (${item.id})`);
    expect(fixedFeatures()).toContain(anchorTerm()!);
  });

  it('reads the bridge span and the default bridge from the catalog', () => {
    const bridges = getAllItems().filter(isBridge);
    const spans = bridges.map((b) => findTrait(b, 'waterSpan')!);
    expect(bridgeSpanText()).toBe(`${Math.min(...spans.map((s) => s.min))}-${Math.max(...spans.map((s) => s.max))}`);
    const smallest = Math.min(...bridges.map((b) => b.width * b.height));
    expect(bridges.find((b) => b.width * b.height === smallest)!.id).toBe(narrowestBridgeId());
  });
});
