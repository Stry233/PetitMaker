/** Files from other versions: older formats brought up to date, newer ones refused, retired items replaced. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { CURRENT_VERSION } from '../../../io/save/format';
import { RETIRED_CATALOG_IDS } from '../../../config/catalog/retired-ids';
import { translateFor } from '../../../i18n/context';
import { templateAnchor } from '../../../core/model/landmarks';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem } from '../../../state/catalog';
import { inlandSquare } from '../../_support/legal-maps';
import { builtMap, exportJson, importCode, importToasts, inspect, installInto, preview, seen, shareCode } from './_files';

const fixture = (name: string): string => {
  const bytes = readFileSync(`src/__tests__/fixtures/saves/${name}`);
  return name.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
};

/** A road a person lays on open ground beside the built map's work. */
function withRoad() {
  const w = builtMap();
  const at = w.openGround(3, 3);
  const road = w.place('path-garden-stone', at.x + 1, at.y + 1);
  if (!road.ok) throw new Error(`the road was refused: ${road.refusedBy.join(', ')}`);
  return { w, road: road.id! };
}

describe('files from other versions', () => {
  spec('FILE-10', 'opens a file of an older format at the current layout, without the undo history recorded against the earlier landmarks', async () => {
    const text = fixture('landmarks-v2.json');
    const legacy = JSON.parse(text) as { version: number; history?: unknown };
    expect(legacy.version).toBeLessThan(CURRENT_VERSION);
    const inspection = await preview(text, 'old.json');
    const plaza = templateAnchor(inspection.preview.state.template)!;
    expect(inspection.preview.state.objects.get(plaza.id)?.position).toEqual({ x: plaza.x, y: plaza.y });

    // A step a person takes on the opened map, exported in today's format, opens with its undo.
    const { deps, installed } = installInto();
    expect(inspection.commit(deps).status).toBe('imported');
    const at = inlandSquare(installed.state!.template, 6, installed.state!);
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: at.x + 3, y: at.y + 3 }, 0, installed.state!, { id: 'tree' });
    expect(installed.executor!.execute(placeObjectCommand(tree)).success).toBe(true);
    const current = JSON.parse(exportJson(installed.state!, ['annotations', 'history'], {
      history: { entries: installed.executor!.getUndoEntries(), depth: 'all' },
    })) as { version: number; history: unknown };
    expect(current.version).toBe(CURRENT_VERSION);
    const today = installInto();
    (await preview(JSON.stringify(current))).commit(today.deps);
    expect(today.installed.executor!.canUndo()).toBe(true);

    // The same history in the older file was recorded against the earlier landmarks.
    const older = installInto();
    (await preview(JSON.stringify({ ...legacy, history: current.history }), 'old.json')).commit(older.deps);
    expect(older.installed.executor!.canUndo()).toBe(false);
    expect(older.installed.state!.objects.get(plaza.id)?.position).toEqual({ x: plaza.x, y: plaza.y });
  });

  spec('FILE-11', 'refuses a map file written by a newer version, asking the user to update', async () => {
    const file = JSON.parse(exportJson(builtMap().state)) as { version: number };
    file.version = CURRENT_VERSION + 1;
    const outcome = await inspect(JSON.stringify(file));
    expect(outcome).toEqual({ status: 'failed', code: 'future-version', source: 'json' });
    if (outcome.status !== 'failed') return;
    expect(importToasts(outcome)).toEqual([{ text: translateFor('en', 'import.fail_future'), tone: 'error' }]);
    expect(translateFor('en', 'import.fail_future')).toMatch(/update/i);
  });

  spec('FILE-14', 'opens every retired road of a released map file as the item that replaced it', async () => {
    const text = fixture('release-0.4.149-tafa-complex.json.gz');
    const retired = (JSON.parse(text) as { objects: { id: string; catalogId: string }[] }).objects
      .filter((o) => Object.hasOwn(RETIRED_CATALOG_IDS, o.catalogId));
    expect(retired.length).toBeGreaterThan(100);
    const { preview: opened } = await preview(text, 'tafa.json');
    // A road the current rules refuse where it stood is set aside for the repair, still as its replacement.
    const all = [...opened.state.objects.values(), ...(opened.report?.objects ?? []).map((o) => o.object)];
    const byId = new Map(all.map((o) => [o.id, o.catalogId]));
    for (const o of retired) expect(byId.get(o.id), o.id).toBe(RETIRED_CATALOG_IDS[o.catalogId]);
    expect(all.some((o) => Object.hasOwn(RETIRED_CATALOG_IDS, o.catalogId))).toBe(false);
  });

  spec('FILE-14', 'replays a retired item in imported undo history and a share code as its replacement', async () => {
    const { w, road } = withRoad();
    const exported = exportJson(w.state, ['annotations', 'history'], { history: { entries: w.sandbox.executor.getUndoEntries(), depth: 'all' } });
    const older = JSON.parse(exported.replaceAll('"path-garden-stone"', '"road-stone"')) as { manifest: { integrity?: string } };
    delete older.manifest.integrity;
    const inspection = await preview(JSON.stringify(older));
    expect(inspection.preview.state.objects.get(road)?.catalogId).toBe('path-garden-stone');
    const { deps, installed } = installInto();
    expect(inspection.commit(deps)).toMatchObject({ status: 'imported', warnings: [] });
    let undone = 0;
    while (installed.executor!.undo()) undone++;
    expect(installed.state!.objects.has(road)).toBe(false);
    for (let i = 0; i < undone; i++) installed.executor!.redo();
    expect(installed.state!.objects.get(road)?.catalogId).toBe('path-garden-stone');
    expect(seen(installed.state!)).toBe(seen(w.state));

    // A map shared before the retirement carries the old name in its code.
    const before = seen(w.state);
    w.state.objects.get(road)!.catalogId = 'road-stone';
    const result = await importCode(await shareCode(w.state));
    if (!result.ok) throw new Error(result.error.code);
    expect([...result.state.objects.values()].filter((o) => o.catalogId === 'path-garden-stone')).toHaveLength(1);
    expect(seen(result.state)).toBe(before);
  });
});
