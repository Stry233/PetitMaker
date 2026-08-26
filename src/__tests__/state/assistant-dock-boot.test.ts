/**
 * WHAT THE EDITOR OPENS WITH, and the one thing about the assistant that survives a reload.
 *
 * EVERY SESSION BOOTS COLLAPSED, DOCK REMEMBERED OR NOT. A surface standing on arrival
 * is one the visitor has to deal with before they can build, and that is as true of a docked panel,
 * which takes a fifth of the window with it. What the pin remembers is the SHAPE the panel opens in:
 * pressing her in a remembered-pinned session goes to the dock rather than to the floating card, which
 * is `useAssistantDocked`'s own arithmetic (asked for AND open AND room) and needs no second seed.
 *
 * The store is a singleton built at import, so each reading here needs its own module graph.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PREFS } from '../../core/runtime/prefs';

const backing = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  },
});

/** A store built fresh against whatever is in storage right now. */
async function bootStore() {
  vi.resetModules();
  const { useEditorStore } = await import('../../state/store');
  return useEditorStore.getState();
}

beforeEach(() => { backing.clear(); });

describe('the assistant boots the way it was left', () => {
  it('boots away with nothing remembered', async () => {
    const state = await bootStore();
    expect(state.assistantPinned).toBe(false);
    expect(state.assistantOpen).toBe(false);
  });

  it('boots collapsed with the dock remembered, and opens straight into it', async () => {
    backing.set(PREFS.assistantPinned.key, '1');
    const state = await bootStore();
    // The intent survives; nothing stands.
    expect(state.assistantPinned).toBe(true);
    expect(state.assistantOpen).toBe(false);
    // And the press that opens it opens the DOCKED shape, since docked is the intent AND being open.
    state.setAssistantOpen(true);
    const live = (await import('../../state/store')).useEditorStore.getState();
    expect(live.assistantOpen && live.assistantPinned).toBe(true);
  });

  it('boots away again once the dock is given up', async () => {
    backing.set(PREFS.assistantPinned.key, '0');
    const state = await bootStore();
    expect(state.assistantPinned).toBe(false);
    expect(state.assistantOpen).toBe(false);
  });

  /** The intent is written the moment it changes, so the next boot reads it rather than the session
   *  that ended. */
  it('writes the intent through the setter and nowhere else', async () => {
    const state = await bootStore();
    state.setAssistantPinned(true);
    expect(backing.get(PREFS.assistantPinned.key)).toBe('1');
    state.setAssistantPinned(false);
    expect(backing.get(PREFS.assistantPinned.key)).toBe('0');
  });

  /** Whether the panel is merely OPEN is deliberately not persisted: only the dock is. */
  it('never persists the open flag on its own', async () => {
    const state = await bootStore();
    state.setAssistantOpen(true);
    expect([...backing.keys()]).not.toContain(PREFS.assistantPinned.key);
  });
});
