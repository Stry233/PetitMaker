// The READMEs' "this picture is a map" demo must stay a real, importable PetitGlyph share image.
// The committed artifacts are exports of 鱼松的爱心桃花岛 (a hand-built map by 鱼松, credited in the
// README). This pins them through the actual import pipeline — if the codec or either
// file ever drift, this fails before the READMEs lie. There are two of them (the header is
// localized), and they are exports of the SAME island, so the pair is checked against one map:
// a composition change around the band must not reach the payload inside it.
// (This artifact is generated from the app's own Export dialog and must be regenerated
// whenever its source island changes; the counts below are that island, exactly.)
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';
import { importFromBytes } from '../../../io/share/import';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType } from '../../../core/model/types';
import type { GridState } from '../../../core/model/types';

const FILES = ['docs/media/share-map.png', 'docs/media/share-map.zh.png'];

// The en file was exported against the CURRENT catalog, so its decode carries no warnings. The zh
// file is the author's own export (transcoded to PNG for this node import path; the app decodes
// any raster), made against the catalog of its day, so its frame hash reads as `catalog-drift` —
// which is not drift in the payload (its own SHA-256 is exact-or-fail and proves the island
// unchanged). Pinned exactly per file rather than ignored, so any OTHER warning stays a real
// regression, and a re-export moves the expectation here with it.
const EXPECTED_WARNINGS: Record<string, string[]> = {
  'docs/media/share-map.png': [],
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
      // A hand-built map, not a generated one: it carries no generation recipe, so the payload
      // spells every cell out and no catalog change can invalidate the code through the replay
      // predictor.
      expect(state.generation ?? null).toBeNull();
      // Every id a decode produces names a live item: one that did not would render as a surface
      // with no catalog entry, which is a hole in the map rather than an object.
      for (const o of objects) expect(getCatalogItem(o.catalogId), o.catalogId).toBeDefined();
      // Every road on the map is an in-game path surface: the map was built against the real
      // catalog, and any save that ever carried a retired plain-colour road resolves through
      // `io/legacy-catalog` before it can reach an export.
      const roads = objects.filter((o) => getCatalogItem(o.catalogId)?.category === 'road');
      expect(roads.length).toBeGreaterThan(0);
      for (const o of roads) expect(o.catalogId.startsWith('path-'), o.catalogId).toBe(true);
    }

    expect(signature(states[1]!)).toBe(signature(states[0]!));
  }, 240_000);
});
