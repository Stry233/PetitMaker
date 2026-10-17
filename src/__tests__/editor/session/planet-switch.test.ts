// @vitest-environment jsdom
/**
 * A carried build that arrives against its new planet's landmarks waits for the repair's choice
 * like any load, and Export first there downloads the build as it arrived, unrepaired, never the map
 * still open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const downloads = vi.hoisted(() => [] as { json: string; name: string }[]);
vi.mock('../../../io/export/download', async (actual) => ({
  ...await actual<typeof import('../../../io/export/download')>(),
  downloadJSON: (json: string, name: string) => { downloads.push({ json, name }); },
}));
// The transfer replays through the rules and arrives legal, so the arrival is stood in for by a
// map with trees under the plaza, handed to the port the switch passes.
const arrival = vi.hoisted(() => ({ current: null as GridState | null }));
vi.mock('../../../editor/operations', async (actual) => {
  const real = await actual<typeof import('../../../editor/operations')>();
  return {
    ...real,
    transferMap: (port: MapPort) => {
      port.installLoaded(arrival.current!, createDefaultRegistry());
      const none = { cells: 0, objects: 0 };
      return { target: arrival.current!.template, offset: { x: 0, y: 0 }, carried: true, moved: none, dropped: none, violations: [] };
    },
  };
});

import { cancelRepair, exportUnrepaired } from '../../../editor/session/landmark-repair';
import { switchPlanet } from '../../../editor/session/planet-switch';
import { editorPort } from '../../../editor/session/context';
import { newMap } from '../../../editor/operations';
import type { MapPort } from '../../../editor/session/context';
import { inspectImportFile } from '../../../io/import/file';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import type { GridState } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { getMapTemplate } from '../../../config/maps';
import { useEditorStore } from '../../../state/store';

const store = () => useEditorStore.getState();

beforeEach(() => {
  newMap(editorPort, 'hexia');
  const state = createGridState(getMapTemplate('hexia'));
  const a = templateAnchor(state.template)!;
  const trees = [0, 4, 8].map((d) => ({ id: `under-${d}`, catalogId: 'tree-apple', position: { x: Math.floor(a.x) + 3 + d, y: Math.floor(a.y) + 5 }, rotation: 0 as const, elevation: 0 }));
  for (const t of trees) state.objects.set(t.id, t);
  bumpObjectsVersion(state, { added: trees });
  arrival.current = state;
});
afterEach(() => {
  downloads.length = 0;
  if (store().repairSession) cancelRepair();
});

describe('Export first on a carried build', () => {
  it('downloads the build as it arrived, the trees under the plaza where they stood', async () => {
    const open = store().gridState;
    const expected = ['under-0', 'under-4', 'under-8'].map((id) => [id, { ...arrival.current!.objects.get(id)!.position }]);
    switchPlanet('hexia', true);
    const session = store().repairSession;
    if (session?.phase !== 'choose') throw new Error(`no choice: ${session?.phase}`);
    expect(session.pending.objects.has('under-0')).toBe(false);
    expect(exportUnrepaired()).toBe(true);
    expect(downloads).toHaveLength(1);
    // Read back as a save file, the trees are under the plaza again, where the build had them.
    const reread = await inspectImportFile(new Blob([downloads[0]!.json], { type: 'application/json' }), downloads[0]!.name);
    if (reread.status !== 'ready') throw new Error(reread.status);
    expect(reread.preview.report!.objects.map((o) => [o.object.id, o.object.position])).toEqual(expected);
    expect(store().gridState).toBe(open);
    expect(store().repairSession?.phase).toBe('choose');
  });
});
