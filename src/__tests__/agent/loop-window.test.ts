/**
 * History windowing and abort behaviour of the agentic loop: a trimmed window
 * always opens on a user message (the Anthropic API rejects assistant-first
 * conversations), and a mid-stream abort returns the completed rounds instead
 * of discarding them.
 */
import { describe, it, expect } from 'vitest';
import { runAgentTurn } from '../../agent/loop';
import type { AgentMessage, AgentRequest, ProviderAdapter } from '../../agent/types';

function longHistory(rounds: number): AgentMessage[] {
  const h: AgentMessage[] = [{ role: 'user', content: 'start' }];
  for (let i = 0; i < rounds; i++) {
    h.push({ role: 'assistant', content: `step ${i}`, toolCalls: [] });
    h.push({ role: 'tool', results: [{ toolCallId: `${i}`, content: 'ok', isError: false }] });
  }
  return h;
}

function captureAdapter(requests: AgentRequest[]): ProviderAdapter {
  return {
    listModels: async () => [],
    stream: async (req) => {
      requests.push(req);
      return { text: 'done', toolCalls: [] };
    },
  };
}

const base = {
  model: 'm', system: 'S', tools: [], userText: 'hi', mapContext: '',
  execTool: async () => ({ toolCallId: '', content: 'ok', isError: false }),
  onTextDelta: () => {}, onToolEvent: () => {},
};

describe('history windowing', () => {
  it('a trimmed window opens on a user message', async () => {
    const requests: AgentRequest[] = [];
    await runAgentTurn({
      ...base,
      adapter: captureAdapter(requests),
      history: longHistory(35), // 71 messages, well past the budget
      signal: new AbortController().signal,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[0]!.role).toBe('user');
  });

  it('a window with no user message gets a stub and keeps tool pairing intact', async () => {
    // One giant turn: the only user message sits at index 0 and falls off the window.
    const requests: AgentRequest[] = [];
    const h: AgentMessage[] = [{ role: 'user', content: 'start' }];
    for (let i = 0; i < 40; i++) {
      h.push({ role: 'assistant', content: '', toolCalls: [{ id: `${i}`, name: 'inspect_region', input: {} }] });
      h.push({ role: 'tool', results: [{ toolCallId: `${i}`, content: 'ok', isError: false }] });
    }
    // Drop the user turn the runner would add by replaying from a stored history where
    // the trailing shape is tool-heavy; the new user message still lands at the END.
    await runAgentTurn({
      ...base,
      adapter: captureAdapter(requests),
      history: h,
      signal: new AbortController().signal,
    });
    const msgs = requests[0]!.messages;
    expect(msgs[0]!.role).toBe('user');
    // every assistant tool call is still followed by a tool-results message
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]!;
      if (m.role === 'assistant' && m.toolCalls.length > 0) {
        expect(msgs[i + 1]?.role).toBe('tool');
      }
    }
  });
});

describe('abort mid-stream', () => {
  it('returns the completed rounds instead of throwing', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: async () => {
        calls++;
        if (calls === 1) {
          return { text: 'working', toolCalls: [{ id: '1', name: 'paint_terrain', input: {} }] };
        }
        ctrl.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    };
    const history = await runAgentTurn({
      ...base,
      adapter,
      history: [],
      signal: ctrl.signal,
    });
    // the first round (assistant + tool result) survives the abort
    expect(history.some((m) => m.role === 'assistant' && m.content === 'working')).toBe(true);
    expect(history.some((m) => m.role === 'tool')).toBe(true);
  });

  it('a non-abort stream failure carries the completed rounds on the error', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: async () => {
        calls++;
        if (calls === 1) {
          return { text: 'working', toolCalls: [{ id: '1', name: 'paint_terrain', input: {} }] };
        }
        throw new Error('429 rate limited');
      },
    };
    let caught: unknown = null;
    try {
      await runAgentTurn({ ...base, adapter, history: [], signal: new AbortController().signal });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const partial = (caught as { partialHistory?: AgentMessage[] }).partialHistory;
    expect(partial?.some((m) => m.role === 'tool')).toBe(true);
  });
});
