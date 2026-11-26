// @vitest-environment jsdom
/**
 * The video import as the page holds it: one read at a time with its stop, the planet read kept
 * until the planet editor opens it, and the hand-off that opens it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../../i18n/context';
import { host } from '../../../editor/host/host';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { stopPlanetEditing } from '../../../editor/session/planet-editing';
import { createPlanetScan, openScanned } from '../../../editor/session/planet-scan';
import { VideoImportError, type ScanVideo, type ScanVideoOptions } from '../../../pipelines/planet-scan/import-video';
import type { ScanOutcome } from '../../../pipelines/planet-scan/run';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { useEditorStore } from '../../../state/store';
import { planetFixture } from '../../_support/planet';

const OUTCOME: ScanOutcome = {
  template: planetFixture(), rimSand: [], review: [3, 4], landmark: { detected: false },
  unplaced: [], tooFar: [], blocked: [], estimated: [], coverage: 1, partial: false,
};
const video = () => new File([new Uint8Array(16)], 'scan.mp4', { type: 'video/mp4' });
const s = () => useEditorStore.getState();

/** A scripted scan: each call parks until the test settles it, and records its options. */
function scripted() {
  const calls: { options: ScanVideoOptions; resolve: (o: ScanOutcome) => void; reject: (e: unknown) => void }[] = [];
  const scan: ScanVideo = (_file, options) => new Promise((resolve, reject) => {
    calls.push({ options, resolve, reject });
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  });
  return { scan, calls };
}

describe('the video import session', () => {
  it('reads one video at a time, publishes its progress and keeps the planet it read', async () => {
    const { scan, calls } = scripted();
    const session = createPlanetScan(scan, () => false);
    const seen = vi.fn();
    session.subscribe(seen);
    const first = session.read(video());
    expect(session.snapshot()).toMatchObject({ reading: true, held: null, failure: null });
    expect(await session.read(video()), 'a second file while one is read').toBe('busy');
    expect(calls).toHaveLength(1);
    calls[0]!.options.onProgress!({ stage: 'tracking', share: null });
    expect(session.snapshot().progress.stage).toBe('tracking');
    calls[0]!.resolve(OUTCOME);
    expect(await first).toBe('read');
    expect(session.snapshot()).toMatchObject({ reading: false, held: OUTCOME });
    expect(seen).toHaveBeenCalled();
  });

  it('says why a read failed, and the next read starts clean', async () => {
    const { scan, calls } = scripted();
    const session = createPlanetScan(scan, () => true);
    const first = session.read(video());
    calls[0]!.reject(new VideoImportError('no-ground'));
    expect(await first).toBe('failed');
    expect(session.snapshot()).toMatchObject({ reading: false, failure: 'no-ground', held: null });
    void session.read(video());
    expect(session.snapshot()).toMatchObject({ reading: true, failure: null });
    session.cancel();
  });

  it('a cancel stops the read under way, whose late progress and planet are dropped', async () => {
    const { scan, calls } = scripted();
    const session = createPlanetScan(scan, () => true);
    const first = session.read(video());
    session.cancel();
    expect(calls[0]!.options.signal.aborted).toBe(true);
    expect(await first).toBe('stopped');
    calls[0]!.options.onProgress!({ stage: 'ground', share: 0.5 });
    expect(session.snapshot()).toMatchObject({ reading: false, held: null, failure: null, progress: { stage: 'reading' } });
    const second = session.read(video());
    calls[1]!.resolve(OUTCOME);
    expect(await second).toBe('read');
  });

  it('keeps the planet while the planet editor cannot open, lets go of it once it opens, and a cancel puts it down', async () => {
    const { scan, calls } = scripted();
    let opens = false;
    const open = vi.fn(() => opens);
    const session = createPlanetScan(scan, open);
    expect(session.openHeld(), 'nothing is held yet').toBe(false);
    expect(open).not.toHaveBeenCalled();
    const first = session.read(video());
    calls[0]!.resolve(OUTCOME);
    await first;
    expect(session.openHeld()).toBe(false);
    expect(session.snapshot().held).toBe(OUTCOME);
    opens = true;
    expect(session.openHeld()).toBe(true);
    expect(open).toHaveBeenLastCalledWith(OUTCOME);
    expect(session.snapshot().held).toBeNull();

    const second = session.read(video());
    calls[1]!.resolve(OUTCOME);
    await second;
    session.cancel();
    expect(session.snapshot().held).toBeNull();
  });
});

describe('opening a planet read from a video', () => {
  const toasts: string[] = [];
  let unpresent = (): void => {};

  beforeEach(() => {
    localStorage.clear();
    toasts.length = 0;
    unpresent = setToastPresenter((text) => { toasts.push(text); });
    newMap(editorPort, 'hexia');
    s().setTourRunning(false);
    s().setModal('newProject', true);
    s().setModal('planetImport', true);
  });
  afterEach(() => {
    unpresent();
    stopPlanetEditing({ discard: true });
    host.camera.takeQueued();
    s().setModal('newProject', false);
  });

  it('[PLAN-34] opens it in the planet editor as a new planet with its cells to check, and closes both windows', () => {
    expect(openScanned(OUTCOME)).toBe(true);
    expect(s().planetSession).toMatchObject({ entryId: null });
    expect(s().planetSession!.review!.cells).toHaveLength(2);
    expect([s().modals.newProject, s().modals.planetImport]).toEqual([false, false]);
    expect(toasts).toEqual([]);
  });

  it('[PLAN-35] says how much of the coast a partial read covered', () => {
    expect(openScanned({ ...OUTCOME, coverage: 0.8, partial: true })).toBe(true);
    expect(toasts).toEqual([translate('planet.scan_partial', { percent: 80 })]);
  });

  it('[PLAN-34] opens nothing and says nothing while the planet editor cannot open', () => {
    const map = s().gridState;
    s().setTourRunning(true);
    expect(openScanned({ ...OUTCOME, coverage: 0.8, partial: true })).toBe(false);
    expect(s().planetSession).toBeNull();
    expect(s().gridState).toBe(map);
    expect([s().modals.newProject, s().modals.planetImport]).toEqual([true, true]);
    expect(toasts).toEqual([]);
  });
});
