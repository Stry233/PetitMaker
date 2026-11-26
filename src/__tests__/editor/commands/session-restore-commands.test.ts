// @vitest-environment jsdom
/**
 * The answers to the welcome-back offer by command, as any caller runs them: each does what its
 * button does, and a refusal changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { runCommand } from '../../../editor/commands/run';
import { host } from '../../../editor/host/host';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { startPlanetEditing, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { __setRestoreOffer, publishChosenSurfaces, restoreOffer, whenRestoreBegins, whenRestoreDeclined } from '../../../editor/session/restore';
import type { RestoredAutosave } from '../../../io/storage/autosave';
import { useEditorStore } from '../../../state/store';

const s = () => useEditorStore.getState();
const saved = (): RestoredAutosave => ({ state: createGridState(getMapTemplate('tafa')) });
const ran = async (id: string): Promise<void> => { expect(await runCommand(id), id).toMatchObject({ ok: true }); };
const refused = async (id: string): Promise<void> => { expect(await runCommand(id), id).toMatchObject({ ok: false }); };

describe('the welcome-back offer by command', () => {
  beforeEach(() => {
    publishChosenSurfaces(false);
    newMap(editorPort, 'hexia');
    s().setTourRunning(false);
    s().setAssistantOpen(false);
    __setRestoreOffer(null);
  });
  afterEach(() => {
    __setRestoreOffer(null);
    stopPlanetEditing({ discard: true });
    host.camera.takeQueued();
  });

  it('session.restore resumes the saved session as Resume does, behind the cover the root registered', async () => {
    const offer = saved();
    const cover = vi.fn();
    const off = whenRestoreBegins(cover);
    __setRestoreOffer(offer);
    await ran('session.restore');
    off();
    expect(cover).toHaveBeenCalledTimes(1);
    expect(s().gridState).toBe(offer.state);
    expect(restoreOffer()).toBeNull();
  });

  it('session.restore restores nothing with no offer standing, behind the welcome tips or while a planet is edited', async () => {
    const open = s().gridState;
    await refused('session.restore');
    const offer = saved();
    __setRestoreOffer(offer);
    s().setTourRunning(true);
    await refused('session.restore');
    s().setTourRunning(false);
    expect(startPlanetEditing(null, false)).toBe(true);
    const canvas = s().gridState;
    await refused('session.restore');
    expect(s().gridState).toBe(canvas);
    stopPlanetEditing({ discard: true });
    expect(s().gridState).toBe(open);
    expect(restoreOffer(), 'a refusal leaves the offer standing').toBe(offer);
  });

  it('session.decline_restore lets the saved session go as Start fresh does, and the open map stays', async () => {
    const open = s().gridState;
    const wipe = vi.fn();
    const off = whenRestoreDeclined(wipe);
    await refused('session.decline_restore');
    expect(wipe).not.toHaveBeenCalled();
    __setRestoreOffer(saved());
    await ran('session.decline_restore');
    off();
    expect(restoreOffer()).toBeNull();
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(s().gridState).toBe(open);
  });
});
