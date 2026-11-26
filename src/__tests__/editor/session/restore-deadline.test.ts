// @vitest-environment jsdom
/**
 * What ends the saved-session offer besides its two answers: the visitor setting to work declines
 * it, and the offer standing on screen for its whole wait resumes the session by itself. Resuming
 * covers the map first, then reports the restore and announces the arrival.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { CommandType, TerrainType } from '../../../core/model/types';
import { createGridState } from '../../../core/model/template';
import { newMap } from '../../../editor/operations';
import { __resetArrivals, subscribeArrival } from '../../../editor/session/arrival';
import { editorPort } from '../../../editor/session/context';
import {
  RESTORE_AFTER_MS, __setRestoreOffer, acceptRestoreOffer, holdRestoreDeadline, onSessionRestored, publishChosenSurfaces,
  restoreDeadline, restoreOffer, showRestoreDeadline, stopRestoreDeadline, subscribeRestoreDeadline, whenRestoreBegins, whenRestoreDeclined,
} from '../../../editor/session/restore';
import type { RestoredAutosave } from '../../../io/storage/autosave';
import { useEditorStore } from '../../../state/store';

const s = () => useEditorStore.getState();
const saved = (): RestoredAutosave => ({ state: createGridState(getMapTemplate('tafa')) });

beforeEach(() => {
  vi.useFakeTimers();
  __resetArrivals();
  publishChosenSurfaces(false);
  __setRestoreOffer(null);
  newMap(editorPort, 'hexia');
});
afterEach(() => {
  __setRestoreOffer(null);
  publishChosenSurfaces(false);
  vi.useRealTimers();
});

describe('the visitor setting to work', () => {
  it('declines the offer once a surface they chose stands open', () => {
    const wipe = vi.fn();
    const off = whenRestoreDeclined(wipe);
    __setRestoreOffer(saved());
    publishChosenSurfaces(true);
    expect(restoreOffer()).toBeNull();
    expect(wipe).toHaveBeenCalledTimes(1);
    off();
  });

  it('declines at once an offer stood while such a surface is open', () => {
    publishChosenSurfaces(true);
    __setRestoreOffer(saved());
    expect(restoreOffer()).toBeNull();
  });

  it('declines the offer at their first edit, and not at a map merely opening', () => {
    __setRestoreOffer(saved());
    newMap(editorPort, 'hexia');
    expect(restoreOffer()).not.toBeNull();
    s().commandExecutor!.execute({ type: CommandType.PaintTerrain, cells: [{ x: 80, y: 40 }], terrainType: TerrainType.Mountain, elevation: 1 });
    expect(restoreOffer()).toBeNull();
  });
});

describe('the offer on screen', () => {
  it('resumes the saved session by itself once it has stood there for the whole wait', () => {
    const offer = saved();
    __setRestoreOffer(offer);
    vi.advanceTimersByTime(2 * RESTORE_AFTER_MS);
    expect(restoreOffer(), 'an offer not on screen waits').toBe(offer);
    const leave = showRestoreDeadline();
    expect(restoreDeadline()).toEqual({ spentMs: 0, running: true, stopped: false });
    vi.advanceTimersByTime(RESTORE_AFTER_MS - 1);
    expect(restoreOffer()).toBe(offer);
    vi.advanceTimersByTime(1);
    expect(restoreOffer()).toBeNull();
    expect(s().gridState).toBe(offer.state);
    expect(restoreDeadline().running).toBe(false);
    leave();
  });

  it('is read again each second while its clock runs, and not while it is held', () => {
    __setRestoreOffer(saved());
    const moved = vi.fn();
    const off = subscribeRestoreDeadline(moved);
    const leave = showRestoreDeadline();
    vi.advanceTimersByTime(3000);
    expect(restoreDeadline()).toMatchObject({ spentMs: 3000, running: true });
    holdRestoreDeadline(true);
    moved.mockClear();
    vi.advanceTimersByTime(5 * RESTORE_AFTER_MS);
    expect(moved).not.toHaveBeenCalled();
    expect(restoreDeadline()).toMatchObject({ spentMs: 3000, running: false });
    expect(restoreOffer()).not.toBeNull();
    off();
    leave();
  });

  it('goes on from where it was held', () => {
    const offer = saved();
    __setRestoreOffer(offer);
    const leave = showRestoreDeadline();
    vi.advanceTimersByTime(5000);
    holdRestoreDeadline(true);
    vi.advanceTimersByTime(60_000);
    holdRestoreDeadline(false);
    vi.advanceTimersByTime(RESTORE_AFTER_MS - 5000 - 1);
    expect(restoreOffer()).toBe(offer);
    vi.advanceTimersByTime(1);
    expect(s().gridState).toBe(offer.state);
    leave();
  });

  it('spends nothing while it is held from the moment it comes on screen', () => {
    const offer = saved();
    __setRestoreOffer(offer);
    const leave = showRestoreDeadline(true);
    expect(restoreDeadline()).toEqual({ spentMs: 0, running: false, stopped: false });
    vi.advanceTimersByTime(5 * RESTORE_AFTER_MS);
    expect(restoreOffer()).toBe(offer);
    holdRestoreDeadline(false);
    vi.advanceTimersByTime(RESTORE_AFTER_MS);
    expect(restoreOffer()).toBeNull();
    leave();
  });

  it('starts the wait whole each time it comes on screen', () => {
    const offer = saved();
    __setRestoreOffer(offer);
    showRestoreDeadline()();
    const leave = showRestoreDeadline();
    vi.advanceTimersByTime(8000);
    leave();
    vi.advanceTimersByTime(60_000);
    expect(restoreOffer(), 'off screen the clock stands').toBe(offer);
    const leaveAgain = showRestoreDeadline();
    expect(restoreDeadline().spentMs).toBe(0);
    vi.advanceTimersByTime(RESTORE_AFTER_MS - 1);
    expect(restoreOffer()).toBe(offer);
    vi.advanceTimersByTime(1);
    expect(restoreOffer()).toBeNull();
    leaveAgain();
  });

  it('waits for an answer for good once keyboard focus stopped its clock', () => {
    const offer = saved();
    __setRestoreOffer(offer);
    const leave = showRestoreDeadline();
    vi.advanceTimersByTime(3000);
    stopRestoreDeadline();
    expect(restoreDeadline()).toEqual({ spentMs: 3000, running: false, stopped: true });
    holdRestoreDeadline(true);
    holdRestoreDeadline(false);
    vi.advanceTimersByTime(5 * RESTORE_AFTER_MS);
    expect(restoreOffer()).toBe(offer);
    leave();
  });

  it('runs no clock once the offer is declined', () => {
    const open = s().gridState;
    __setRestoreOffer(saved());
    const leave = showRestoreDeadline();
    publishChosenSurfaces(true);
    vi.advanceTimersByTime(5 * RESTORE_AFTER_MS);
    expect(s().gridState).toBe(open);
    expect(restoreDeadline().running).toBe(false);
    leave();
  });
});

describe('resuming the saved session', () => {
  it('covers the map before the restore lands, then reports the restore and announces the arrival', () => {
    const offer = saved();
    const order: string[] = [];
    const wipe = vi.fn();
    const stops = [
      whenRestoreBegins(() => { order.push(s().gridState === offer.state ? 'covered late' : 'covered'); }),
      onSessionRestored(() => { order.push(s().gridState === offer.state ? 'restored' : 'restored early'); }),
      subscribeArrival((arrival) => { order.push(`arrival ${arrival.kind}`); }),
      whenRestoreDeclined(wipe),
    ];
    expect(acceptRestoreOffer(), 'with no offer standing').toBe(false);
    __setRestoreOffer(offer);
    expect(acceptRestoreOffer()).toBe(true);
    expect(order).toEqual(['covered', 'restored', 'arrival restored']);
    expect(restoreOffer()).toBeNull();
    expect(wipe, 'resuming is no decline').not.toHaveBeenCalled();
    for (const stop of stops) stop();
  });
});
