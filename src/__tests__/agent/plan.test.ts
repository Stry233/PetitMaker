import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '../../agent/store';
import { executeToolCall } from '../../agent/tools';
import { makeState } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import type { EditorEvents } from '../../core/model/types';

// Mirror the localStorage stub from key-storage.test.ts — jsdom exposes a
// descriptor that yields undefined on this node version.
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

function deps(setPlan: (s: { title: string; status: 'pending' | 'active' | 'done' }[]) => void) {
  const state = makeState(10, 10);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  return { getState: () => state, getExecutor: () => exec, getRegion: () => [], setPlan };
}

describe('update_plan + store plan state', () => {
  beforeEach(() => useAgentStore.getState().clearChat());

  it('replaces the plan wholesale and reports it back', async () => {
    const stages: { title: string; status: 'pending' | 'active' | 'done' }[] = [];
    const r = await executeToolCall(
      { id: 'p1', name: 'update_plan', input: { stages: [{ title: 'Landscape', status: 'done' }, { title: 'Water', status: 'active' }] } },
      deps((s) => stages.splice(0, stages.length, ...s)),
    );
    expect(r.isError).toBe(false);
    expect(stages).toHaveLength(2);
    expect(stages[1]).toMatchObject({ title: 'Water', status: 'active' });
  });

  it('rejects malformed stages', async () => {
    const r = await executeToolCall(
      { id: 'p2', name: 'update_plan', input: { stages: [{ title: 'X', status: 'later' }] } },
      deps(() => {}),
    );
    expect(r.isError).toBe(true);
  });


  it('empty-array clear is accepted: stages [] is valid and setPlan receives []', async () => {
    const received: unknown[] = [];
    const r = await executeToolCall(
      { id: 'p3', name: 'update_plan', input: { stages: [] } },
      deps((s) => received.splice(0, received.length, ...s)),
    );
    expect(r.isError).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('non-array stages is rejected', async () => {
    const r = await executeToolCall(
      { id: 'p4', name: 'update_plan', input: { stages: 5 } },
      deps(() => {}),
    );
    expect(r.isError).toBe(true);
  });
});
