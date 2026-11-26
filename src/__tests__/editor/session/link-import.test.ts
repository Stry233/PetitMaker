// @vitest-environment jsdom
/**
 * A map the page arrived with through a link: read once the saved-session question is settled, and
 * installed only on the visitor's word.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { createLinkImport } from '../../../editor/session/link-import';
import { planetNaming } from '../../../editor/session/planet-names';
import { __setRestoreOffer, declineRestoreOffer } from '../../../editor/session/restore';
import { mapLinkCode, mapLinkFor } from '../../../io/share';
import { exportableState } from '../../../io/export/exportable';
import { CURRENT_VERSION } from '../../../io/save/format';
import type { RestoredAutosave } from '../../../io/storage/autosave';
import { useEditorStore } from '../../../state/store';

const SAVED = { state: {} } as RestoredAutosave;
const liveMap = () => useEditorStore.getState().gridState;

/** The code of a link to an empty map, as the share window makes it. */
async function linkCode(): Promise<string> {
  const state = exportableState(createGridState(getMapTemplate('hexia')), planetNaming('en'));
  const path = await mapLinkFor('/toy', state, null, { appVersion: 'test', saveVersion: CURRENT_VERSION, createdAt: '2026-01-01T00:00:00.000Z' });
  return mapLinkCode(new URL(path!, 'https://example.test').search)!;
}

beforeEach(() => { newMap(editorPort, 'hexia'); });
afterEach(() => { __setRestoreOffer(null); });

describe('a map link the page arrived with', () => {
  it('waits for the saved-session question, then is read once', async () => {
    const code = await linkCode();
    const arriving = vi.fn(() => code);
    __setRestoreOffer(SAVED);
    const link = createLinkImport(arriving);
    const stop = link.watch();
    expect(arriving).not.toHaveBeenCalled();
    declineRestoreOffer();
    expect(arriving).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(link.snapshot()).not.toBeNull());
    stop();
    link.watch()();
    expect(arriving).toHaveBeenCalledTimes(1);
  });

  it('is read at once where no saved session is offered, and installed only on confirmation', async () => {
    const code = await linkCode();
    const link = createLinkImport(() => code);
    const before = liveMap();
    const stop = link.watch();
    await vi.waitFor(() => expect(link.snapshot()).not.toBeNull());
    expect(liveMap()).toBe(before);
    link.confirm();
    expect(liveMap()).not.toBe(before);
    expect(link.snapshot()).toBeNull();
    stop();
  });

  it('is put away without touching the open map', async () => {
    const code = await linkCode();
    const link = createLinkImport(() => code);
    const before = liveMap();
    const stop = link.watch();
    await vi.waitFor(() => expect(link.snapshot()).not.toBeNull());
    link.dismiss();
    link.confirm();
    expect(link.snapshot()).toBeNull();
    expect(liveMap()).toBe(before);
    stop();
  });
});
