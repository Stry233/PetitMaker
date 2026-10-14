/** A host with no view on screen says so: no projection, an overlay that draws nothing. */
import { describe, expect, it } from 'vitest';
import { createToolHost, HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';
import { makeExecutor, makeState } from '../../../_support/map-state';

describe('createToolHost without a view', () => {
  it('reports no projection and the headless overlay', () => {
    const state = makeState(8, 8);
    const host = createToolHost({ state, executor: makeExecutor(state) });
    expect(host.viewport).toBeNull();
    expect(host.overlay).toBe(HEADLESS_OVERLAY);
  });
});
