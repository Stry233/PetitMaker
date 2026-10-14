import { describe, it, expect } from 'vitest';
import { MAP_LIST } from '../../../../config/maps';
import { templateAnchor } from '../../../../core/model/landmarks';
import { isBuildableZone } from '../../../../core/game/zones';
import { landMask } from '../../../../tools/generation/designer/planet';

describe('the land the plan reads', () => {
  it.each(MAP_LIST.map((t) => [t.id, t] as const))('is the buildable ground the anchor does not cover whole on %s', (_id, t) => {
    const a = templateAnchor(t)!;
    const land = landMask(t);
    let under = 0;
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const covered = x >= a.x && x + 1 <= a.x + a.width && y >= a.y && y + 1 <= a.y + a.height;
        if (covered) under++;
        expect(land[y * t.width + x] === 1).toBe(isBuildableZone(t.zones[y]![x]) && !covered);
      }
    }
    expect(under).toBe(a.width * a.height);
  });

  it('keeps a cell the anchor covers only in part', () => {
    const t = MAP_LIST[0]!;
    const a = templateAnchor(t)!;
    const shifted = { ...t, landmarks: t.landmarks.map((l) => (l.id === a.id ? { ...l, x: a.x + 0.5 } : l)) };
    const land = landMask(shifted);
    expect(land[(a.y + 1) * t.width + a.x]).toBe(1);
    expect(land[(a.y + 1) * t.width + a.x + 1]).toBe(0);
  });
});
