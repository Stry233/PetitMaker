// @vitest-environment jsdom
/** The assistant's session follows the map through a restore, whoever asked for the restore. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentSession, watchRestoredSession } from '../../../agent/boot';
import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { restoreSession } from '../../../editor/session/restore';

afterEach(() => { vi.restoreAllMocks(); });

describe('the assistant\'s session through a restore', () => {
  it('reads the saved session of the map each restore installed, until the watch is stopped', () => {
    const hydrate = vi.spyOn(useAgentSession.getState(), 'hydrate').mockImplementation(() => {});
    newMap(editorPort, 'hexia');
    const stop = watchRestoredSession();
    restoreSession({ state: createGridState(getMapTemplate('tafa')) });
    expect(hydrate).toHaveBeenCalledTimes(1);
    stop();
    restoreSession({ state: createGridState(getMapTemplate('hexia')) });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });
});
