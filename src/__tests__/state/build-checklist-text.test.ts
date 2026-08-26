/**
 * `buildChecklistText` — the "copy as text" payload. Pinned against a fixed, hand-built
 * `BuildChecklist` fixture (not a real map) so a change in the exact text shape shows up as a
 * one-line diff here rather than a fuzzy prose assertion.
 */
import { describe, it, expect } from 'vitest';
import { ItemCategory, type LocalizedName } from '../../core/model/types';
import { buildChecklistText, type BuildChecklist } from '../../state/build-checklist';
import { translateFor } from '../../i18n/context';

const t = (key: string, params?: Record<string, string | number>) => translateFor('en', key, params);

const name = (en: string): LocalizedName => ({ en });

const FIXTURE: BuildChecklist = {
  groups: [
    { category: ItemCategory.Building, items: [{ catalogId: 'b1', name: name('Cabin'), count: 3 }], total: 3 },
    { category: ItemCategory.Tree, items: [], total: 0 },
    { category: ItemCategory.Flora, items: [{ catalogId: 'f1', name: name('Daisy'), count: 12 }], total: 12 },
    { category: ItemCategory.Facility, items: [], total: 0 },
    { category: ItemCategory.Bridge, items: [], total: 0 },
    { category: ItemCategory.Ramp, items: [], total: 0 },
  ],
  roads: [{ catalogId: 'path-overgrown-dirt', name: name('Dirt'), count: 5, color: '#aa885c' }],
  roadTotal: 5,
  layers: [
    { layer: 0, blocks: 0, water: 2 },
    { layer: 1, blocks: 10, water: 0 },
  ],
  objectTotal: 21,
  hasPlaza: true,
  unresolved: 0,
};

describe('buildChecklistText', () => {
  it('prints the exact shape: header, per-category sections, roads with cells, terrain a line per layer', () => {
    expect(buildChecklistText(FIXTURE, 'en', t)).toBe(
      [
        'Into the game: 15 in total',
        '',
        'Things to place (15)',
        '',
        'Buildings (3)',
        '  3x Cabin',
        '',
        'Flowers (12)',
        '  12x Daisy',
        '',
        'Road surfaces (5 cells)',
        '  Dirt: 5 cells',
        '',
        'Terrain, layer by layer:',
        '  Ground water 2',
        '  Layer 1 10 cells',
      ].join('\n'),
    );
  });

  it('omits a section entirely when it has nothing, and says so when the whole map is empty', () => {
    const empty: BuildChecklist = {
      groups: FIXTURE.groups.map((g) => ({ ...g, items: [], total: 0 })),
      roads: [], roadTotal: 0, layers: [], objectTotal: 0, hasPlaza: true, unresolved: 0,
    };
    expect(buildChecklistText(empty, 'en', t)).toBe(
      ['Into the game: 0 in total', '', 'Nothing on the map yet.'].join('\n'),
    );
  });

  it('names what it cannot recognize', () => {
    const withUnresolved: BuildChecklist = { ...FIXTURE, unresolved: 2 };
    expect(buildChecklistText(withUnresolved, 'en', t)).toContain(
      'Objects this version does not recognize: 2',
    );
  });

  it('reads the item name in the requested locale, falling back to English', () => {
    const bilingual: BuildChecklist = {
      ...FIXTURE,
      groups: FIXTURE.groups.map((g) =>
        g.category === ItemCategory.Building
          ? { ...g, items: [{ catalogId: 'b1', name: { en: 'Cabin', zh: '小屋' }, count: 3 }] }
          : g,
      ),
    };
    const zhText = buildChecklistText(bilingual, 'zh', (key, params) => translateFor('zh', key, params));
    expect(zhText).toContain('3x 小屋');
    // No zh translation on this one → falls back to the en name.
    expect(zhText).toContain('12x Daisy');
  });
});
