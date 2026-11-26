// @vitest-environment jsdom
/**
 * An import surface's flow without its surface: one file at a time, the saved-session offer let go as
 * a file is taken, and a decoded map installed only on the visitor's word.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { commitImport, createImportFlow, routeImport, type ImportRouting, type PendingMap } from '../../../editor/session/import-flow';
import { cancelRepair, repairByHand } from '../../../editor/session/landmark-repair';
import { startPlanetEditing, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { templateAnchor } from '../../../core/model/landmarks';
import { __setRestoreOffer, restoreOffer, whenRestoreDeclined } from '../../../editor/session/restore';
import type { RestoredAutosave } from '../../../io/storage/autosave';
import { serialize } from '../../../io/save/json-codec';
import { useEditorStore } from '../../../state/store';

const ROUTING: ImportRouting = { map: 'read', planet: 'card', video: 'card', unknown: 'read' };
const SAVED = { state: {} } as RestoredAutosave;

const mapFile = (name: string): File => new File([serialize(createGridState(getMapTemplate('hexia')))], name, { type: 'application/json' });
const liveMap = () => useEditorStore.getState().gridState;

/** A save with a tree where the plaza stands, which no load opens without a repair. */
function saveUnderPlaza(name: string): File {
  const state = createGridState(getMapTemplate('hexia'));
  const plaza = templateAnchor(state.template)!;
  state.objects.set('tree', { id: 'tree', catalogId: 'tree-apple', position: { x: Math.floor(plaza.x) + 3, y: Math.floor(plaza.y) + 3 }, rotation: 0, elevation: 0 });
  return new File([serialize(state)], name, { type: 'application/json' });
}

/** `file` decoded, as it waits on a surface's confirmation card. */
async function decoded(file: File): Promise<PendingMap> {
  const routed = await routeImport(file, file.name, ROUTING);
  if (routed.to !== 'pending') throw new Error(`routed to ${routed.to}`);
  return routed.pending;
}

beforeEach(() => { newMap(editorPort, 'hexia'); });
afterEach(() => {
  __setRestoreOffer(null);
  if (useEditorStore.getState().repairSession) cancelRepair();
  if (useEditorStore.getState().planetSession) stopPlanetEditing({ discard: true });
});

describe('an import flow', () => {
  it('refuses a second file while one is being read and while its map waits on the card', async () => {
    const flow = createImportFlow({ routing: ROUTING });
    expect(flow.idle()).toBe(true);
    const first = flow.take(mapFile('first.json'));
    expect(flow.idle(), 'busy from the call on, before anything is read').toBe(false);
    await flow.take(mapFile('second.json'));
    await first;
    expect(flow.snapshot()).toMatchObject({ busy: false, pending: { name: 'first.json' } });
    expect(flow.idle()).toBe(false);
    await flow.take(mapFile('third.json'));
    expect(flow.snapshot().pending?.name).toBe('first.json');
  });

  it('declines the saved-session offer as a file is taken, whatever the file turns out to be', async () => {
    const declined = vi.fn();
    const off = whenRestoreDeclined(declined);
    __setRestoreOffer(SAVED);
    const refused = vi.fn();
    const taking = createImportFlow({ routing: { ...ROUTING, unknown: 'refuse' }, onRefused: refused }).take(new File(['words'], 'notes.txt', { type: 'text/plain' }));
    expect(restoreOffer(), 'gone before the file is read').toBeNull();
    await taking;
    expect(refused).toHaveBeenCalledTimes(1);
    expect(declined).toHaveBeenCalledTimes(1);
    off();
  });

  it('declines the saved-session offer for a caller that routes a file without a flow', async () => {
    __setRestoreOffer(SAVED);
    await routeImport(mapFile('map.json'), 'map.json', ROUTING);
    expect(restoreOffer()).toBeNull();
  });

  it('installs the waiting map once, on the confirmation', async () => {
    const committed = vi.fn();
    const flow = createImportFlow({ routing: ROUTING, onCommitted: committed });
    const before = liveMap();
    await flow.take(mapFile('map.json'));
    expect(liveMap(), 'decoding installs nothing').toBe(before);
    flow.confirm();
    expect(liveMap()).not.toBe(before);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(flow.idle()).toBe(true);
    const installed = liveMap();
    flow.confirm();
    expect(liveMap()).toBe(installed);
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('puts the waiting map away, leaving the open map, and takes the next file', async () => {
    const flow = createImportFlow({ routing: ROUTING });
    const before = liveMap();
    await flow.take(mapFile('first.json'));
    flow.dismiss();
    expect(flow.idle()).toBe(true);
    flow.confirm();
    expect(liveMap()).toBe(before);
    await flow.take(mapFile('second.json'));
    expect(flow.snapshot().pending?.name).toBe('second.json');
  });
});

describe('a file given while the map is held', () => {
  it('[FILE-34] is refused during a hand repair, which keeps its session and the map Cancel brings back', async () => {
    const open = liveMap();
    const second = await decoded(saveUnderPlaza('second.json'));
    const plain = await decoded(mapFile('plain.json'));
    commitImport(await decoded(saveUnderPlaza('first.json')));
    repairByHand();
    const repair = useEditorStore.getState().repairSession;
    expect(repair?.phase).toBe('hand');
    const underRepair = liveMap();

    __setRestoreOffer(SAVED);
    expect(await routeImport(mapFile('third.json'), 'third.json', ROUTING)).toEqual({ to: 'refused' });
    expect(restoreOffer(), 'a refused file is not taken, so the offer stands').toBe(SAVED);

    // A map decoded before the repair began is refused too, whether its load asks a repair or none.
    expect(commitImport(second)).toBe(false);
    expect(commitImport(plain)).toBe(false);
    expect(useEditorStore.getState().repairSession).toBe(repair);
    expect(liveMap()).toBe(underRepair);

    cancelRepair();
    expect(liveMap()).toBe(open);
  });

  it('[FILE-34] is refused while a planet is being edited, and taken again once it ends', async () => {
    const open = liveMap();
    const pending = await decoded(mapFile('map.json'));
    expect(startPlanetEditing(null, false)).toBe(true);
    const canvas = liveMap();
    const refused = vi.fn();
    const flow = createImportFlow({ routing: ROUTING, onRefused: refused });
    await flow.take(mapFile('map.json'));
    expect(refused).toHaveBeenCalledTimes(1);
    expect(flow.idle()).toBe(true);
    expect(commitImport(pending)).toBe(false);
    expect(liveMap()).toBe(canvas);

    stopPlanetEditing({ discard: true });
    expect(liveMap()).toBe(open);
    expect(commitImport(pending)).toBe(true);
    expect(liveMap()).not.toBe(open);
  });
});
