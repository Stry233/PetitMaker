// @vitest-environment jsdom
/** The repairs the harness has a part in: a retry files the latest order again, a key to fix is dropped; the rest are the panel's own. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runRepair } from '../../../agent/exec/panel-repairs';
import { append } from '../../../agent/core/log';
import { __resetAgentConnection, isConnected, useAgentConnection } from '../../../agent/connection/store';
import { useAgentSession } from '../../../agent/session/store';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

beforeEach(() => {
  __resetAgentConnection();
  backing.clear();
  useAgentSession.getState().clearSession();
});

describe('a repair that reaches the harness', () => {
  it('files the latest order again on Try again, and nothing where no order was given', () => {
    const runner = { resend: vi.fn() };
    runRepair(runner, 'try-again');
    expect(runner.resend.mock.calls).toEqual([[undefined]]);

    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'plant an orchard', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'incident', undoIndex: 0 });
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'incident', undoIndex: 0 });
    runRepair(runner, 'try-again');
    expect(runner.resend.mock.calls[1]).toEqual(['build a village']);
  });

  it('drops the armed key on Fix key, with or without a runner', () => {
    useAgentConnection.getState().connectKey('openai', 'sk-test-key-for-repair');
    useAgentConnection.getState().setProvider('openai');
    expect(isConnected(useAgentConnection.getState())).toBe(true);
    runRepair(null, 'fix-key');
    expect(isConnected(useAgentConnection.getState())).toBe(false);
  });

  it('leaves the panel\'s own repairs to the panel', () => {
    const runner = { resend: vi.fn() };
    useAgentConnection.getState().connectKey('openai', 'sk-test-key-for-repair');
    useAgentConnection.getState().setProvider('openai');
    for (const act of ['change-provider', 'edit-endpoint', 'edit-model', 'new-order', 'set-aside', 'dismiss', 'sign-in'] as const) runRepair(runner, act);
    expect(runner.resend).not.toHaveBeenCalled();
    expect(isConnected(useAgentConnection.getState())).toBe(true);
  });
});
