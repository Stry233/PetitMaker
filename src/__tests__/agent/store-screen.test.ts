/**
 * The agent panel's setup/chat screen state: decided once keys have hydrated,
 * stored on the agent store so it survives leaving and re-entering the panel.
 */
import { describe, it, expect } from 'vitest';
import { useAgentStore } from '../../agent/store';

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

describe('setup screen state', () => {
  it('keys hydrate shortly after startup', async () => {
    await waitFor(() => useAgentStore.getState().keysHydrated);
  });

  it('starts undecided and keeps an explicit choice across readers', () => {
    // The store starts with no decision — the panel must not guess a screen.
    // (Hydration may have completed by now, but nothing decides setupOpen except the panel.)
    expect(useAgentStore.getState().setupOpen).toBeNull();
    useAgentStore.getState().setSetupOpen(true);
    expect(useAgentStore.getState().setupOpen).toBe(true);
    useAgentStore.getState().setSetupOpen(false);
    expect(useAgentStore.getState().setupOpen).toBe(false);
  });
});
