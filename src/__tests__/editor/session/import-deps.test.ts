// @vitest-environment jsdom
/**
 * An imported save file's camera waits for the view that draws the installed map. The 2D view frames
 * a new map when it draws it, so a pose set straight onto the view before that draw was lost; the
 * import parks it for the map, as the autosave restore does.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { inspectImportFile } from '../../../io/import/file';
import { getImportFileDeps } from '../../../editor/session/import-deps';
import { host } from '../../../editor/host/host';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { serialize } from '../../../io/save/json-codec';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';

beforeEach(() => newMap(editorPort, 'hexia'));

async function importJson(save: Record<string, unknown>): Promise<void> {
  const file = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const inspection = await inspectImportFile(file, 'map.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  inspection.commit(getImportFileDeps());
}

describe('the imported camera', () => {
  const base = () => JSON.parse(serialize(createGridState(getMapTemplate('hexia')))) as Record<string, unknown>;

  it('parks both poses an export writes for the installed map', async () => {
    const camera = { view2d: { x: 12, y: -4, zoom: 1.5 }, view3d: { az: 20, el: 35, dist: 1.1 } };
    await importJson({ ...base(), session: { v: 1, lockedLayers: [] }, camera });
    expect(host.camera.takeQueued()).toEqual(camera);
  });

  it('parks the 2D pose an older file kept in its session', async () => {
    await importJson({ ...base(), session: { v: 1, lockedLayers: [], camera: { x: 7, y: 8, zoom: 2 } } });
    expect(host.camera.takeQueued()).toEqual({ view2d: { x: 7, y: 8, zoom: 2 } });
  });
});
