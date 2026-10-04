import { afterEach, describe, expect, it } from 'vitest';
import type { ModelSpec } from '../../core/model/model-spec';
import { buildModel, deckGeometry, disposeModels, modelGeometry } from '../../canvas/map3d/models/build-model';
import { getKnownItems, landmarkItem } from '../../state/catalog';

afterEach(disposeModels);

const petal: ModelSpec = { parts: [{ shape: 'petal', size: [1, 1, 1], pos: [0, 0, 0], color: '#ffffff' }] };

describe('model quality', () => {
  it('reduces petals while keeping a closed shell, its root, tip and maximum width', () => {
    const full = buildModel(petal), lite = buildModel(petal, undefined, 'lite');
    const p = lite.getAttribute('position');
    expect(p.count).toBe(full.getAttribute('position').count * .75);
    expect(lite.boundingBox).toEqual(full.boundingBox);
    const edges = new Map<string, number>();
    for (let i = 0; i < p.count; i += 3) {
      const vertices = [0, 1, 2].map(j => [p.getX(i + j), p.getY(i + j), p.getZ(i + j)].join(','));
      for (let j = 0; j < 3; j++) {
        const key = [vertices[j], vertices[(j + 1) % 3]].sort().join('|');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    full.dispose(); lite.dispose();
  });

  it.each([undefined, true, { mode: 'contain' as const, inset: [.1, .2] as [number, number], align: [1, -1] as [1, -1] }])(
    'keeps structural vertices and contact planes fixed when ornament defines the bounds (%j)', fitToFootprint => {
      const spec: ModelSpec = {
        groundY: .4, heightInLayers: 3, fitToFootprint,
        parts: [
          { shape: 'box', pos: [0, -.2, 0], size: [1, 2, 1], color: '#ffffff' },
          { shape: 'sphere', pos: [.8, 2, 0], size: [1, 1, 1], color: '#ffffff', fullOnly: true },
        ],
      };
      const full = buildModel(spec, { width: 4, height: 5 });
      const lite = buildModel(spec, { width: 4, height: 5 }, 'lite');
      const p = lite.getAttribute('position').array;
      expect(p).toEqual(full.getAttribute('position').array.slice(0, p.length));
      full.dispose(); lite.dispose();
    },
  );

  it('retains every architectural surface and its calibration across the catalog', () => {
    let reduced = 0;
    for (const item of [...getKnownItems(), landmarkItem()]) {
      for (const spec of [item.model3d, item.deckModel3d]) {
        if (!spec) continue;
        const full = buildModel(spec, item), lite = buildModel(spec, item, 'lite');
        const fp = full.getAttribute('position').array, lp = lite.getAttribute('position').array;
        expect(lp.every(Number.isFinite), item.id).toBe(true);
        expect(lp.length, item.id).toBeLessThanOrEqual(fp.length);
        if (lp.length < fp.length) reduced++;
        let f = 0, l = 0;
        for (const part of spec.parts) {
          const original = buildModel({ parts: [part] });
          const count = original.getAttribute('position').array.length;
          original.dispose();
          if (!part.fullOnly) {
            if (part.shape !== 'petal') {
              expect(lp.slice(l, l + count), `${item.id}: ${part.shape}`).toEqual(fp.slice(f, f + count));
              l += count;
            } else l += count * .75;
          }
          f += count;
        }
        expect(l).toBe(lp.length);
        full.dispose(); lite.dispose();
      }
    }
    expect(reduced).toBeGreaterThan(20);
  });

  it('caches each tier independently for bodies and decks and clears both on disposal', () => {
    for (const [get, id] of [[modelGeometry, 'building-myhouse'], [deckGeometry, landmarkItem().id]] as const) {
      const full = get(id, 'full')!, lite = get(id, 'lite')!;
      expect(lite).not.toBe(full);
      expect(lite.getAttribute('position').count).toBeLessThan(full.getAttribute('position').count);
      expect(get(id, 'lite')).toBe(lite);
      expect(get(id)).toBe(full);
      disposeModels();
      expect(get(id, 'lite')).not.toBe(lite);
    }
  });
});
