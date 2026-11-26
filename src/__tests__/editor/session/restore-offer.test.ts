/**
 * The saved-session offer's one decline: Start fresh, the arrival notice's answers, a handed file and
 * the visitor setting to work all let the saved session go through it, with the assistant's session of
 * its map, and taking the offer to restore it is no decline.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __setRestoreOffer, acceptRestoreOffer, declineRestoreOffer, restoreOffer, subscribeRestoreOffer, whenRestoreDeclined,
} from '../../../editor/session/restore';
import type { RestoredAutosave } from '../../../io/storage/autosave';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';

const SAVED: RestoredAutosave = { state: createGridState(getMapTemplate('hexia')) };

beforeEach(() => { __setRestoreOffer(null); });

describe('declining the saved-session offer', () => {
  it("lets the saved session go with the edition's own part, once", () => {
    const wipe = vi.fn();
    const off = whenRestoreDeclined(wipe);
    __setRestoreOffer(SAVED);
    declineRestoreOffer();
    expect(restoreOffer()).toBeNull();
    expect(wipe).toHaveBeenCalledTimes(1);
    declineRestoreOffer();
    expect(wipe, 'a decline with no offer standing falls on nothing').toHaveBeenCalledTimes(1);
    off();
  });

  it('is no decline when the offer is taken to restore it', () => {
    const wipe = vi.fn();
    const off = whenRestoreDeclined(wipe);
    __setRestoreOffer(SAVED);
    expect(acceptRestoreOffer()).toBe(true);
    expect(restoreOffer()).toBeNull();
    expect(acceptRestoreOffer()).toBe(false);
    declineRestoreOffer();
    expect(wipe).not.toHaveBeenCalled();
    off();
  });

  it('tells its readers each time the offer moves', () => {
    const heard = vi.fn();
    const off = subscribeRestoreOffer(heard);
    __setRestoreOffer(SAVED);
    declineRestoreOffer();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it('runs no part once the edition released it', () => {
    const wipe = vi.fn();
    whenRestoreDeclined(wipe)();
    __setRestoreOffer(SAVED);
    declineRestoreOffer();
    expect(wipe).not.toHaveBeenCalled();
  });
});
