// The localized README images are exports of the same hand-built map and must remain importable.
// Their fixed counts identify the source map independently of the surrounding composition.
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';
import { importFromBytes } from '../../../io/share/import';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType } from '../../../core/model/types';
import type { GridState } from '../../../core/model/types';
import { RESOLUTION_WIDTHS } from '../../../io/export/compose';
import { readChunks } from '../../../io/share/raster/png-chunks';

const FILES = ['docs/media/share-map.png', 'docs/media/share-map.zh.png'];

// Both artifacts predate the corrected house footprints; payload integrity still verifies.
const EXPECTED_WARNINGS: Record<string, string[]> = {
  'docs/media/share-map.png': ['catalog-drift'],
  'docs/media/share-map.zh.png': ['catalog-drift'],
};

async function decode(file: string): Promise<GridState> {
  const res = await importFromBytes(readFileSync(file));
  if (!res.ok) throw new Error(`${file}: import failed: ${res.error.code} ${res.error.message}`);
  expect(res.warnings).toEqual(EXPECTED_WARNINGS[file]);
  return res.state;
}

/** Every terrain cell and every placement, as one comparable string. */
function signature(state: GridState): string {
  const out: string[] = [];
  for (let y = 0; y < state.template.height; y++) for (let x = 0; x < state.template.width; x++) {
    const t = state.cells[y]![x]!.terrain;
    if (t) out.push(`${x}:${y}:${t.type}:${t.elevation}:${(t.corners ?? []).join('')}${t.patchOnly ? ':p' : ''}`);
  }
  for (const o of [...state.objects.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(`${o.catalogId}@${o.position.x},${o.position.y}/${o.rotation}/${o.elevation}`);
  }
  return out.join('|');
}

describe('README share-map artifacts', () => {
  it.skipIf(!existsSync(FILES[0]!))('uses the Standard export width for the generated README image', () => {
    const bytes = new Uint8Array(readFileSync(FILES[0]!));
    const header = readChunks(bytes).find((chunk) => chunk.type === 'IHDR')!.data;
    expect(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0)).toBe(RESOLUTION_WIDTHS.standard);
  });

  it.skipIf(FILES.some((f) => !existsSync(f)))('both decode back to 鱼松\'s hexia island', async () => {
    const states = [] as GridState[];
    for (const file of FILES) states.push(await decode(file));

    for (const state of states) {
      expect(state.template.id).toBe('hexia');
      const objects = [...state.objects.values()].filter((o) => !o.locked);
      let water = 0;
      let terrain = 0;
      for (const row of state.cells) for (const c of row) {
        if (c.terrain) terrain++;
        if (c.terrain?.type === TerrainType.Water) water++;
      }
      expect(objects.length).toBe(3218);
      expect(water).toBe(4224);
      expect(terrain).toBe(14074);
      // A hand-built map carries no informational generation recipe.
      expect(state.generation ?? null).toBeNull();
      expect(state.annotations).toBeUndefined();
      // Every decoded object must resolve to a current catalog item.
      for (const o of objects) expect(getCatalogItem(o.catalogId), o.catalogId).toBeDefined();
      // Every decoded road must use a current in-game path item.
      const roads = objects.filter((o) => getCatalogItem(o.catalogId)?.category === 'road');
      expect(roads.length).toBeGreaterThan(0);
      for (const o of roads) expect(o.catalogId.startsWith('path-'), o.catalogId).toBe(true);
    }

    expect(signature(states[1]!)).toBe(signature(states[0]!));
  }, 240_000);
});
