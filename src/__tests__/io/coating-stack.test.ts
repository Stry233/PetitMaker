/**
 * A map can arrive carrying several road tiles on ONE cell, and loading it repairs that.
 *
 * V-PLACE-OVERLAP exempts surface coatings so a placement may coat OVER one, which means nothing
 * refuses a second tile on a paved cell: a tool that forgets to strip the tile underneath leaves
 * both standing. The stack is invisible on screen, charges its load value once per copy, and made
 * the share code unbuildable — the encoder's own verify-decode refuses more than eight objects on
 * a cell, so a real map with ten dirt roads on one exported no code at all.
 *
 * The fixture is that map's worst corner: cell (29,108) held ten identical dirt roads, its two
 * western neighbours nine and eight. Loading it must leave one tile per cell, and the repaired map
 * must be codeable.
 */
import { describe, it, expect } from 'vitest';
import { serialize, deserialize, stackedCoatingIds } from '../../io/json-codec';
import { createBlankGridState } from '../../io/share/codec/blank-grid';
import { encodeMapPayload } from '../../io/share/codec/payload';
import { getMapTemplate } from '../../config/maps';
import { PLAZA_ID } from '../../core/model/constants';
import type { PlacedObject } from '../../core/model/types';
import type { SaveFile, SaveObject } from '../../io/save-format';

const META = { appVersion: 'stack-test', saveVersion: 1 };

const road = (x: number, y: number, i: number): SaveObject =>
  ({ id: `r${x}-${y}-${i}`, catalogId: 'path-overgrown-dirt', x, y, rotation: 0, elevation: 0 });

/** The owner's worst neighbourhood as a save file: three cells carrying 10, 9 and 8 dirt roads. */
function stackedSave(extra: SaveObject[] = []): string {
  const save = JSON.parse(serialize(createBlankGridState('hexia'))) as SaveFile;
  save.objects = [
    ...Array.from({ length: 8 }, (_, i) => road(27, 108, i)),
    ...Array.from({ length: 9 }, (_, i) => road(28, 108, i)),
    ...Array.from({ length: 10 }, (_, i) => road(29, 108, i)),
    ...extra,
  ];
  return JSON.stringify(save);
}

const loaded = (json: string): PlacedObject[] =>
  [...deserialize(json, getMapTemplate('hexia')).objects.values()].filter((o) => o.id !== PLAZA_ID);

describe('loading a map repairs stacked coatings', () => {
  it('keeps one tile per cell and drops the rest', () => {
    const objects = loaded(stackedSave());
    expect(objects).toHaveLength(3);
    expect(objects.map((o) => o.id).sort()).toEqual(['r27-108-7', 'r28-108-8', 'r29-108-9']);
  });

  it('keeps the LAST tile written, which is what coating over means', () => {
    // A stone road laid over the dirt is the one that survives, not the pile beneath it.
    const objects = loaded(stackedSave([{ id: 'stone', catalogId: 'path-garden-stone', x: 29, y: 108, rotation: 0, elevation: 0 }]));
    expect(objects.find((o) => o.position.x === 29 && o.position.y === 108)?.catalogId).toBe('path-garden-stone');
  });

  it('leaves coatings on cells of their own alone', () => {
    const objects = loaded(stackedSave([road(40, 40, 0), road(41, 40, 0)]));
    expect(objects.filter((o) => o.position.y === 40)).toHaveLength(2);
  });

  it('reads the TRAIT, not the category: a stack of trees is not its business', () => {
    const tree = (i: number): SaveObject => ({ id: `t${i}`, catalogId: 'tree-ginkgo', x: 50, y: 50, rotation: 0, elevation: 0 });
    const objects = loaded(stackedSave([tree(0), tree(1)]));
    expect(objects.filter((o) => o.catalogId === 'tree-ginkgo')).toHaveLength(2);
  });

  it('sees nothing to drop in a map with one tile per cell', () => {
    const clean = loaded(stackedSave());
    expect(stackedCoatingIds(clean).size).toBe(0);
  });
});

describe('a stacked map is what the share code refused', () => {
  it('refuses to code a cell carrying ten tiles, and codes the loaded map fine', async () => {
    const state = createBlankGridState('hexia');
    for (let i = 0; i < 10; i++) {
      state.objects.set(`r${i}`, { id: `r${i}`, catalogId: 'path-overgrown-dirt', position: { x: 29, y: 108 }, rotation: 0, elevation: 0 });
    }
    // The encoder verifies its own frame by decoding it; the plausibility guard is what fires.
    await expect(encodeMapPayload(state, null, META)).rejects.toThrow(/implausible/);

    const repaired = deserialize(stackedSave(), getMapTemplate('hexia'));
    await expect(encodeMapPayload(repaired, null, META)).resolves.toBeInstanceOf(Uint8Array);
  }, 30_000);
});
