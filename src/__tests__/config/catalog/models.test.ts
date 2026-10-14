import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CATALOG_MODELS } from '../../../config/catalog/models';
import { CATEGORIES } from '../../../config/catalog/categories';
import { getCatalogItem, getKnownItems, landmarkItem } from '../../../state/catalog';
import { walkFiles } from '../../_support/source-graph';

const CATALOG_DIR = resolve(__dirname, '../../../config/catalog');

const jsonFiles = (dir: string): string[] => walkFiles(dir, { accept: /\.json$/ });

const files = jsonFiles(CATALOG_DIR);
const sidecars = files.filter((f) => f.endsWith('.model.json'));
const records = files.filter((f) => !f.endsWith('.model.json'));

describe('the catalog model table', () => {
  it('lists every sidecar under the id of the item beside it', () => {
    const anchorSidecar = join(CATALOG_DIR, 'landmark.model.json');
    expect(sidecars).toContain(anchorSidecar);
    const expected = Object.fromEntries(sidecars.map((f) => [
      f === anchorSidecar ? landmarkItem().id : relative(CATALOG_DIR, f).split('/').pop()!.replace(/\.model\.json$/, ''),
      JSON.parse(readFileSync(f, 'utf8')) as unknown,
    ]));
    expect(Object.keys(CATALOG_MODELS).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, model] of Object.entries(expected)) expect(CATALOG_MODELS[id], id).toEqual(model);
  });

  it('names only items the catalog knows', () => {
    for (const id of Object.keys(CATALOG_MODELS)) expect(getCatalogItem(id), id).toBeDefined();
  });

  it('keeps every model out of the item records the boot catalog and the workers parse', () => {
    for (const f of records) {
      const record = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      expect(Object.keys(record).filter((k) => k === 'model3d' || k === 'deckModel3d'), f).toEqual([]);
    }
  });

  it('gives every item placed one by one a model or deck parts, and no brush surface either', () => {
    const placed = new Set<string>(CATEGORIES.filter((c) => c.placement).map((c) => c.id));
    const missing = getKnownItems().filter(
      (i) => placed.has(i.category) && !CATALOG_MODELS[i.id]?.model3d && !CATALOG_MODELS[i.id]?.deckModel3d,
    ).map((i) => i.id);
    const surfaces = getKnownItems().filter((i) => !placed.has(i.category) && CATALOG_MODELS[i.id]).map((i) => i.id);
    expect({ missing, surfaces }).toEqual({ missing: [], surfaces: [] });
    expect(CATALOG_MODELS[landmarkItem().id]?.deckModel3d).toBeDefined();
  });
});
