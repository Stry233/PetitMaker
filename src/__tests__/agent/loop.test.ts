import { describe, it, expect, vi } from 'vitest';
import { runAgentTurn, keepLatestImageOnly, MAX_AGENT_TURNS } from '../../agent/loop';
import type { AgentMessage, AssistantTurn, ProviderAdapter } from '../../agent/types';

function fakeAdapter(turns: AssistantTurn[]): ProviderAdapter {
  let i = 0;
  return {
    listModels: async () => [],
    stream: async (_req, cb) => {
      const t = turns[Math.min(i++, turns.length - 1)]!;
      if (t.text) cb.onTextDelta(t.text);
      // simulate streaming: fire onToolCallStart for each tool call before returning
      for (const tc of t.toolCalls) cb.onToolCallStart?.(tc.name);
      return t;
    },
  };
}

const base = {
  model: 'm',
  system: 'S',
  tools: [],
  history: [],
  mapContext: 'CTX',
  onTextDelta: () => {},
  onToolEvent: () => {},
};

describe('runAgentTurn', () => {
  it('feeds tool results back and stops when no tool calls remain', async () => {
    const adapter = fakeAdapter([
      { text: 'painting', toolCalls: [{ id: 'a', name: 'paint_terrain', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const executed: string[] = [];
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => {
        executed.push(c.name);
        return { toolCallId: c.id, content: 'ok', isError: false };
      },
      signal: new AbortController().signal,
    });
    expect(executed).toEqual(['paint_terrain']);
    expect(history[history.length - 1]).toMatchObject({ role: 'assistant', content: 'done' });
    expect(history[0]!.role).toBe('user');
    expect((history[0] as { content: string }).content).toContain('CTX');
    expect((history[0] as { content: string }).content).toContain('go');
  });

  it('stops at the iteration cap', async () => {
    const always: AssistantTurn = { text: '', toolCalls: [{ id: 'x', name: 't', input: {} }] };
    const adapter = fakeAdapter([always]);
    let calls = 0;
    await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => {
        calls++;
        return { toolCallId: c.id, content: 'ok', isError: false };
      },
      signal: new AbortController().signal,
    });
    expect(calls).toBeLessThanOrEqual(MAX_AGENT_TURNS);
  });

  it('aborts between turns without executing further tools', async () => {
    const ctrl = new AbortController();
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: async () => {
        ctrl.abort();
        return { text: 'x', toolCalls: [{ id: 'a', name: 't', input: {} }] };
      },
    };
    let calls = 0;
    await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => {
        calls++;
        return { toolCallId: c.id, content: 'ok', isError: false };
      },
      signal: ctrl.signal,
    });
    expect(calls).toBe(0);
  });

  it('emits structured tool events: start, then ok/reverted/error results', async () => {
    const events: import('../../agent/types').ToolEvent[] = [];
    // first stream returns 3 tool calls; second stream returns plain text
    const adapter = fakeAdapter([
      {
        text: '',
        toolCalls: [
          { id: 'c1', name: 'paint_terrain', input: {} },
          { id: 'c2', name: 'carve_river', input: {} },
          { id: 'c3', name: 'nope', input: {} },
        ],
      },
      { text: 'done', toolCalls: [] },
    ]);
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (call) =>
        call.id === 'c1'
          ? { toolCallId: call.id, content: 'placed 3 trees\nmore detail', isError: false }
          : call.id === 'c2'
            // Real tools.ts shape: bare "REVERTED:" header + rule hint on second line
            ? { toolCallId: call.id, content: 'REVERTED:\n[V-WTR-02] Water: must be contained on all sides', isError: true }
            : { toolCallId: call.id, content: 'Unknown tool "nope".', isError: true },
      onToolEvent: (ev) => events.push(ev),
      signal: new AbortController().signal,
    });
    expect(events.filter((e) => e.kind === 'start')).toHaveLength(3);
    const results = events.filter((e) => e.kind === 'result');
    expect(results.map((r) => r.kind === 'result' && r.status)).toEqual(['ok', 'reverted', 'error']);
    const first = results[0]!;
    expect(first.kind === 'result' && first.summary).toBe('placed 3 trees'); // first line only
    // Rule hint must survive in the summary so the rail sub-line shows it (Spec C2)
    const revertedResult = results[1]!;
    expect(revertedResult.kind === 'result' && revertedResult.summary).toContain('V-WTR-02');
    expect(revertedResult.kind === 'result' && revertedResult.status).toBe('reverted');
    expect(history.length).toBeGreaterThan(0);
  });

  it('truncates tool result summary to 120 chars when first line exceeds the limit', async () => {
    const events: import('../../agent/types').ToolEvent[] = [];
    const longLine = 'x'.repeat(130);
    const adapter = fakeAdapter([
      { text: '', toolCalls: [{ id: 't1', name: 'paint_terrain', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (call) => ({ toolCallId: call.id, content: `${longLine}\nmore`, isError: false }),
      onToolEvent: (ev) => events.push(ev),
      signal: new AbortController().signal,
    });
    const result = events.find((e) => e.kind === 'result');
    expect(result?.kind === 'result' && result.summary.length).toBe(120);
  });
});

describe('keepLatestImageOnly', () => {
  it('strips image from all tool messages except the last one carrying an image', () => {
    const olderTool: AgentMessage = {
      role: 'tool',
      results: [{ toolCallId: 'r1', content: 'view 1', isError: false, image: { dataUrl: 'data:a' } }],
    };
    const newerTool: AgentMessage = {
      role: 'tool',
      results: [{ toolCallId: 'r2', content: 'view 2', isError: false, image: { dataUrl: 'data:b' } }],
    };
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hi' },
      olderTool,
      { role: 'assistant', content: 'ok', toolCalls: [] },
      newerTool,
    ];

    const stripped = keepLatestImageOnly(messages);

    // Older tool message must NOT have an image in the output.
    const strippedOlder = stripped[1] as { role: 'tool'; results: Array<{ image?: unknown }> };
    expect(strippedOlder.results[0]!.image).toBeUndefined();

    // The newest image-bearing tool message must KEEP its image.
    const strippedNewer = stripped[3] as { role: 'tool'; results: Array<{ image?: { dataUrl: string } }> };
    expect(strippedNewer.results[0]!.image?.dataUrl).toBe('data:b');

    // Original history objects must NOT be mutated.
    expect((olderTool.results[0] as { image?: { dataUrl: string } }).image?.dataUrl).toBe('data:a');
    expect((newerTool.results[0] as { image?: { dataUrl: string } }).image?.dataUrl).toBe('data:b');
  });

  it('returns the original array reference when no tool message has an image', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'tool', results: [{ toolCallId: 'r1', content: 'ok', isError: false }] },
    ];
    expect(keepLatestImageOnly(messages)).toBe(messages);
  });

  it('loop strips old images from messages sent to the adapter but keeps the history intact', async () => {
    // The adapter records the message arrays it receives each time.
    const capturedMessages: AgentMessage[][] = [];
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: vi.fn(async (req, _cb) => {
        capturedMessages.push(req.messages);
        // First turn: return a tool call.
        if (capturedMessages.length === 1) {
          return { text: '', toolCalls: [{ id: 'x', name: 'view_map', input: {} }] };
        }
        // Second turn: stop.
        return { text: 'done', toolCalls: [] };
      }),
    };

    // Seed history with an old tool message that already carries an image.
    const oldToolMsg: AgentMessage = {
      role: 'tool',
      results: [{ toolCallId: 'old', content: 'stale render', isError: false, image: { dataUrl: 'data:old' } }],
    };
    const history = await runAgentTurn({
      ...base,
      adapter,
      history: [
        { role: 'user', content: 'previous turn' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'old', name: 'view_map', input: {} }] },
        oldToolMsg,
      ],
      userText: 'go',
      execTool: (_c) => ({
        toolCallId: _c.id,
        content: 'new render',
        isError: false,
        image: { dataUrl: 'data:new' },
      }),
      signal: new AbortController().signal,
    });

    // After second stream call the adapter should have received the old tool
    // message WITHOUT its image (stripped) but the new one WITH its image.
    const secondCallMsgs = capturedMessages[1]!;
    const toolMsgs = secondCallMsgs.filter((m): m is Extract<AgentMessage, { role: 'tool' }> => m.role === 'tool');
    // There should be at least two tool messages (old + new).
    expect(toolMsgs.length).toBeGreaterThanOrEqual(2);
    // The old tool message in the request must have no image.
    const oldInRequest = toolMsgs.find((m) => m.results.some((r) => r.toolCallId === 'old'));
    expect(oldInRequest?.results[0]!.image).toBeUndefined();
    // The new tool message in the request must have its image.
    const newInRequest = toolMsgs.find((m) => m.results.some((r) => r.toolCallId === 'x'));
    expect(newInRequest?.results[0]!.image?.dataUrl).toBe('data:new');

    // The original history stored objects must still carry their images.
    expect((oldToolMsg.results[0] as { image?: { dataUrl: string } }).image?.dataUrl).toBe('data:old');
    // The returned history also keeps the original image on the old message.
    const returnedOld = history.find(
      (m): m is Extract<AgentMessage, { role: 'tool' }> =>
        m.role === 'tool' && m.results.some((r) => r.toolCallId === 'old'),
    );
    expect(returnedOld?.results[0]!.image?.dataUrl).toBe('data:old');
  });
});

describe('oscillation damper + budget governor', () => {
  const toolMsgs = (h: AgentMessage[]) => h.filter((m) => m.role === 'tool') as Extract<AgentMessage, { role: 'tool' }>[];

  it('escalates when the exact same call fails repeatedly', async () => {
    // model retries the identical failing call three times, then gives up
    const failing = { text: '', toolCalls: [{ id: 'x', name: 'place_object', input: { catalogId: 'b', x: 3, y: 3 } }] };
    const adapter = fakeAdapter([failing, failing, failing, { text: 'done', toolCalls: [] }]);
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => ({ toolCallId: c.id, content: 'Placement: blocked', isError: true }),
      signal: new AbortController().signal,
    });
    const contents = toolMsgs(history).map((m) => m.results[0]!.content);
    expect(contents[0]).not.toContain('(system) This exact');
    expect(contents[1]).toContain('failed 2 times');
    expect(contents[2]).toContain('failed 3 times');
  });

  it('does not escalate when inputs differ', async () => {
    const adapter = fakeAdapter([
      { text: '', toolCalls: [{ id: 'a', name: 'place_object', input: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'b', name: 'place_object', input: { x: 2 } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => ({ toolCallId: c.id, content: 'Placement: blocked', isError: true }),
      signal: new AbortController().signal,
    });
    for (const m of toolMsgs(history)) {
      expect(m.results[0]!.content).not.toContain('(system) This exact');
    }
  });

  it('nudges a strategy change after repeated post-stroke reverts on one tool', async () => {
    const call = (id: string, elev: number) =>
      ({ text: '', toolCalls: [{ id, name: 'paint_terrain', input: { elevation: elev } }] });
    const adapter = fakeAdapter([call('a', 1), call('b', 2), { text: 'done', toolCalls: [] }]);
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => ({ toolCallId: c.id, content: 'REVERTED: rolled back', isError: true }),
      signal: new AbortController().signal,
    });
    const contents = toolMsgs(history).map((m) => m.results[0]!.content);
    expect(contents[0]).not.toContain('rolled back 2 times');
    expect(contents[1]).toContain('rolled back 2 times');
    expect(contents[1]).toContain('Change strategy');
  });

  it('warns the model when the turn budget runs low', async () => {
    const always: AssistantTurn = { text: '', toolCalls: [{ id: 'x', name: 't', input: {} }] };
    const adapter = fakeAdapter([always]);
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => ({ toolCallId: c.id, content: 'ok', isError: false }),
      signal: new AbortController().signal,
      maxTurns: 7,
    });
    const warned = toolMsgs(history).filter((m) => m.results.some((r) => r.content.includes('Turn budget: 5 assistant turns remain')));
    expect(warned).toHaveLength(1); // exactly once, when 5 turns remain
  });
});

describe('empty-turn continuation nudge', () => {
  it('nudges a reasoning-only (empty) turn to continue, then proceeds', async () => {
    const adapter = fakeAdapter([
      { text: '', toolCalls: [] }, // reasoning-only turn: no text, no tools
      { text: '', toolCalls: [{ id: 'a', name: 'paint_terrain', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const executed: string[] = [];
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => { executed.push(c.name); return { toolCallId: c.id, content: 'ok', isError: false }; },
      signal: new AbortController().signal,
    });
    expect(executed).toEqual(['paint_terrain']);
    expect(history.some((m) => m.role === 'user' && m.content.includes('Your last reply was empty'))).toBe(true);
    expect(history[history.length - 1]).toMatchObject({ role: 'assistant', content: 'done' });
  });

  it('gives up after two consecutive empty turns (no infinite loop)', async () => {
    const adapter = fakeAdapter([{ text: '', toolCalls: [] }]);
    let streams = 0;
    const counting: typeof adapter = {
      listModels: adapter.listModels,
      stream: (req, cb, sig) => { streams++; return adapter.stream(req, cb, sig); },
    };
    const history = await runAgentTurn({
      ...base,
      adapter: counting,
      userText: 'go',
      execTool: (c) => ({ toolCallId: c.id, content: 'ok', isError: false }),
      signal: new AbortController().signal,
    });
    expect(streams).toBe(3); // initial + 2 nudged retries, then stop
    expect(history.filter((m) => m.role === 'user' && m.content.includes('empty'))).toHaveLength(2);
  });

  it('a normal text-only reply still ends the turn without nudging', async () => {
    const adapter = fakeAdapter([{ text: 'all done', toolCalls: [] }]);
    const history = await runAgentTurn({
      ...base,
      adapter,
      userText: 'go',
      execTool: (c) => ({ toolCallId: c.id, content: 'ok', isError: false }),
      signal: new AbortController().signal,
    });
    expect(history.filter((m) => m.role === 'user')).toHaveLength(1);
  });
});
