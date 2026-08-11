// The READMEs' "this picture is a map" demo must stay a real, importable PetitGlyph share image.
// This pins the committed artifacts through the actual import pipeline — if the codec, catalog, or
// either file ever drift, this fails before the READMEs lie. There are two of them (the header is
// localized), and they are exports of the SAME island, so the pair is checked against one map:
// a composition change around the band must not reach the payload inside it.
// (This artifact is generated from the app's own Export dialog and must be regenerated
// whenever its source island changes; the counts below are that island, exactly.)
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';
import { importFromBytes } from '../../../io/share/import';
import { TerrainType } from '../../../core/model/types';
import type { GridState } from '../../../core/model/types';

const FILES = ['docs/media/share-map.png', 'docs/media/share-map.zh.png'];

async function decode(file: string): Promise<GridState> {
  const res = await importFromBytes(readFileSync(file));
  if (!res.ok) throw new Error(`${file}: import failed: ${res.error.code} ${res.error.message}`);
  expect(res.warnings).toEqual([]);
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
  it.skipIf(FILES.some((f) => !existsSync(f)))('both decode back to the seed-11 hexia island', async () => {
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
      expect(objects.length).toBe(2899);
      expect(water).toBe(556);
      expect(terrain).toBe(10787);
      expect(state.generation?.seed).toBe(11);
      expect(state.generation?.naturalness).toBe(1);
      expect(state.generation?.maxElevation).toBe(6);
    }

    expect(signature(states[1]!)).toBe(signature(states[0]!));
  }, 240_000);
});
