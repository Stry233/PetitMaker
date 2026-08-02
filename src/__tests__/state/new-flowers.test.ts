// Adding a catalog item should reach every subsystem that consumes the catalog, with no code
// change beyond registering the item. These are the consumers where that could silently fail.
import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../rules';
import { buildSystemPrompt } from '../../agent/system-prompt';
import { getAllItems, getPlaceableByCategory } from '../../state/catalog';
import { ItemCategory } from '../../core/model/types';
import { SHARE_CATALOG_ORDER } from '../../io/share/codec/catalog-order';

const NEW = [
  'flower-daisy-yellow', 'flower-daisy-cyan', 'flower-sunflower-red', 'flower-sunflower-green',
  'flower-canna-gold', 'flower-dahlia-orange', 'flower-dahlia-cyan', 'flower-amaryllis-white',
  'flower-amaryllis-orange', 'flower-bellflower-cyan', 'flower-bellflower-yellow',
  'flower-violet-pink', 'flower-violet-cyan', 'flower-lily-yellow', 'flower-lily-cyan',
  'flower-agapanthus-white', 'flower-agapanthus-blue', 'flower-rose-cyan', 'flower-rose-blue',
];
const LOCALES = ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr'] as const;

describe('flower colourways', () => {
  const byId = new Map(getAllItems().map((i) => [i.id, i]));

  it('are in the catalog, under Flora', () => {
    for (const id of NEW) {
      expect(byId.get(id), `${id} missing`).toBeDefined();
      expect(byId.get(id)!.category, id).toBe(ItemCategory.Flora);
    }
  });

  it('are offered to the generator, which picks from the live category', () => {
    const flora = getPlaceableByCategory(ItemCategory.Flora).map((i) => i.id);
    for (const id of NEW) expect(flora, `${id} not placeable`).toContain(id);
  });

  it('reach the agent, whose prompt is built from the live catalog', () => {
    const prompt = buildSystemPrompt(createDefaultRegistry());
    for (const id of NEW) expect(prompt, `${id} absent from the prompt`).toContain(id);
  });

  it('can be shared', () => {
    for (const id of NEW) expect(SHARE_CATALOG_ORDER, `${id} has no wire index`).toContain(id);
  });

  it('carry a name in every locale, an icon of their own, and a 3D model', () => {
    for (const id of NEW) {
      const item = byId.get(id)!;
      for (const loc of LOCALES) {
        expect((item.name as Record<string, string>)[loc], `${id}.${loc}`).toBeTruthy();
      }
      expect(item.icon, id).toBe(id);
      expect(item.model3d?.parts.length ?? 0, `${id} has no model`).toBeGreaterThan(0);
    }
  });

  it('reads as a distinct flower from its siblings in every locale', () => {
    // A colourway that repeats a sibling's name is unpickable in the panel.
    for (const loc of LOCALES) {
      const names = getPlaceableByCategory(ItemCategory.Flora)
        .map((i) => (i.name as Record<string, string>)[loc]);
      expect(new Set(names).size, `duplicate flora name in ${loc}`).toBe(names.length);
    }
  });
});
