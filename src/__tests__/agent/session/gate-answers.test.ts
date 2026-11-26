// @vitest-environment jsdom
/** The panel's verbs for answering a standing gate: an option is taken by its place among the cards. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { append } from '../../../agent/core/log';
import { askGate } from '../../../agent/core/gates';
import { pickGateOption } from '../../../agent/panel-runtime';
import { panelView, useAgentSession } from '../../../agent/session/store';

let gateId: string;

beforeEach(() => {
  localStorage.clear();
  useAgentSession.getState().clearSession();
  const log = useAgentSession.getState().log;
  append(log, { kind: 'order', text: 'Build a pier', mapContext: '' });
  gateId = askGate(log, { scope: 'tool', summary: 'Which shore?', options: [{ cap: 'The north shore' }, { cap: 'The bay' }] });
});

afterEach(() => useAgentSession.getState().clearSession());

const ask = () => panelView(useAgentSession.getState()).current!.asks[0]!;

describe('pickGateOption', () => {
  it('answers the gate with the option taken, which the record then names by its index', () => {
    expect(pickGateOption(gateId, 1)).toBe(true);
    expect(ask()).toMatchObject({ verdict: 'words', words: 'The bay', answeredBy: 'option', picked: 1 });
  });

  it('answers nothing for an option the gate did not offer, a gate already answered or one it does not know', () => {
    expect(pickGateOption(gateId, 5)).toBe(false);
    expect(ask().verdict).toBeUndefined();
    expect(pickGateOption('gate-unknown', 0)).toBe(false);
    expect(pickGateOption(gateId, 0)).toBe(true);
    expect(pickGateOption(gateId, 1)).toBe(false);
    expect(ask().picked).toBe(0);
  });
});
