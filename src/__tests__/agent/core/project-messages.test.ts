import { describe, expect, it } from 'vitest';
import { quotePromptData } from '../../../core/runtime/prompt-data';
import { append, createLog } from '../../../agent/core/log';
import { deriveMessages, rawIsAllFrom, type ProviderMessage } from '../../../agent/core/project-messages';

/** Mirrors the template `deriveMessages` builds for an `order`, so budget-math tests can predict
 *  exact message text without hardcoding the wire format twice. */
function orderText(mapContext: string, text: string): string {
  return `<map_context>${quotePromptData(mapContext)}</map_context>\n${text}`;
}

describe('deriveMessages', () => {
  it('estimates each message once while dropping whole exchanges from a long log', () => {
    const log = createLog(() => 0);
    for (let i = 0; i < 500; i++) {
      append(log, { kind: 'order', text: `order ${i}`, mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: `c${i}`, name: 'view_map', input: {}, argsDone: true }],
      });
      append(log, { kind: 'toolResult', callId: `c${i}`, name: 'view_map', content: `map ${i}`, isError: false });
    }
    let estimates = 0;
    const out = deriveMessages(log, { budgetTokens: 1, estimate: () => { estimates++; return 1; } });
    expect(estimates).toBe(1500);
    expect(out).toEqual([
      { role: 'user', text: orderText('', 'order 499') },
      { role: 'assistant', text: '', toolCalls: [{ callId: 'c499', name: 'view_map', args: {} }] },
      { role: 'tool', results: [{ callId: 'c499', name: 'view_map', content: 'map 499', isError: false }] },
    ]);
  });

  it('projects an order as a user message with its map context prepended', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'build a village', mapContext: 'elevation: flat' });
    const out = deriveMessages(log, { budgetTokens: 10_000 });
    expect(out).toEqual([{ role: 'user', text: '<map_context>"elevation: flat"</map_context>\nbuild a village' }]);
  });

  it('projects an assistant\'s parsed tool calls and joins their results into one ordered tool message', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [
        { kind: 'text', text: 'placing two things', done: true },
        { kind: 'tool', callId: 'c1', name: 'place_object', input: { id: 'tree' }, argsDone: true },
        { kind: 'tool', callId: 'c2', name: 'place_object', input: { id: 'rock' }, argsDone: true },
      ],
    });
    // Results logged out of call order.
    append(log, { kind: 'toolResult', callId: 'c2', name: 'place_object', content: 'placed rock', isError: false });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'placed tree', isError: false });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[1]).toEqual({
      role: 'assistant',
      text: 'placing two things',
      toolCalls: [
        { callId: 'c1', name: 'place_object', args: { id: 'tree' } },
        { callId: 'c2', name: 'place_object', args: { id: 'rock' } },
      ],
    });
    expect(out[2]).toEqual({
      role: 'tool',
      results: [
        { callId: 'c1', name: 'place_object', content: 'placed tree', isError: false },
        { callId: 'c2', name: 'place_object', content: 'placed rock', isError: false },
      ],
    });
  });

  it('replays a call whose args never parsed (rawInput set) with its partial input, so the reissue result filed for it reaches the model', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: { x: 68 }, rawInput: '{"x":68,"y":', argsDone: true }],
    });
    append(log, {
      kind: 'toolResult', callId: 'c1', name: 'place_object', isError: true,
      content: '(system) The turn was cut off before the arguments were complete. Reissue the calls with complete arguments.',
    });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[1]).toEqual({
      role: 'assistant',
      text: '',
      toolCalls: [{ callId: 'c1', name: 'place_object', args: { x: 68 } }],
    });
    expect(out[2]).toEqual({
      role: 'tool',
      results: [{
        callId: 'c1', name: 'place_object', isError: true,
        content: '(system) The turn was cut off before the arguments were complete. Reissue the calls with complete arguments.',
      }],
    });
  });

  it('projects a delivered steer as a user message at its delivery position, and drops an undelivered or recalled one', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'start', mapContext: '' });
    append(log, { kind: 'steer', text: 'go wider' }); // seq 2
    append(log, { kind: 'steer', text: 'never delivered' }); // seq 3, absent: no steerDelivered
    append(log, { kind: 'steer', text: 'recalled one' }); // seq 4
    append(log, { kind: 'steerRecalled', steerSeq: 4 });
    append(log, { kind: 'steerDelivered', steerSeq: 2 });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out).toEqual([
      { role: 'user', text: orderText('', 'start') },
      { role: 'user', text: 'go wider' },
    ]);
  });

  it('skips an assistant turn stopped as aborted or error, together with its results, on replay', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'aborted',
      parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: {}, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'placed', isError: false });
    append(log, {
      kind: 'assistant',
      stop: 'error',
      error: { cls: 'network', detail: 'x' },
      parts: [{ kind: 'text', text: 'oops', done: true }],
    });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out).toEqual([{ role: 'user', text: orderText('', 'go') }]);
  });

  it('skips a length-stopped assistant turn and its tool call entirely, on replay, while surrounding turns survive', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'text', text: 'before', done: true }],
    });
    append(log, {
      kind: 'assistant',
      stop: 'length',
      parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: { id: 'tree' }, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'placed', isError: false });
    append(log, {
      kind: 'assistant',
      stop: 'stop',
      parts: [{ kind: 'text', text: 'after', done: true }],
    });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out).toEqual([
      { role: 'user', text: orderText('', 'go') },
      { role: 'assistant', text: 'before', toolCalls: [] },
      { role: 'assistant', text: 'after', toolCalls: [] },
    ]);
    expect(out.some((m) => m.role === 'assistant' && m.toolCalls.some((c) => c.callId === 'c1'))).toBe(false);
    expect(out.some((m) => m.role === 'tool')).toBe(false);
  });

  it('synthesizes a "No result recorded." error result for a tool call with no matching toolResult', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: {}, argsDone: true }],
    });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[2]).toEqual({
      role: 'tool',
      results: [{ callId: 'c1', name: 'place_object', content: 'No result recorded.', isError: true }],
    });
  });

  it('replaces everything before the latest compaction with one summary user message, dropping anything before retainedFromSeq', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'first', mapContext: '' }); // seq 1, must not appear
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'ack', done: true }] }); // seq 2, must not appear
    append(log, { kind: 'compaction', summary: 'did some early stuff', retainedFromSeq: 4 }); // seq 3
    append(log, { kind: 'order', text: 'second', mapContext: '' }); // seq 4, retained

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out).toEqual([
      { role: 'user', text: '(conversation summary, reference only) <summary_data>"did some early stuff"</summary_data>' },
      { role: 'user', text: orderText('', 'second') },
    ]);
  });

  it('cuts at the LATEST of two compaction events, not the first', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'first', mapContext: '' }); // seq 1, must not appear
    append(log, { kind: 'compaction', summary: 'stale summary', retainedFromSeq: 3 }); // seq 2, superseded
    append(log, { kind: 'order', text: 'second', mapContext: '' }); // seq 3, must not appear (before the LATEST compaction's retainedFromSeq)
    append(log, { kind: 'compaction', summary: 'fresh summary', retainedFromSeq: 5 }); // seq 4, the latest
    append(log, { kind: 'order', text: 'third', mapContext: '' }); // seq 5, retained

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out).toEqual([
      { role: 'user', text: '(conversation summary, reference only) <summary_data>"fresh summary"</summary_data>' },
      { role: 'user', text: orderText('', 'third') },
    ]);
  });

  describe('a playbook the compaction cut evicts is re-issued after the summary', () => {
    const COZY = 'COZY VILLAGE PLAYBOOK\n1. site the well\n2. ring it with houses\n3. plant the edges';
    const ZEN = 'ZEN GARDEN PLAYBOOK\n1. rake the gravel\n2. set three stones';

    /** One `load_skill` exchange: the assistant calls it, the result carries the body plus the
     *  `detail.skill` identity the result records. Returns the seq of the assistant that opened it. */
    function loadSkill(log: ReturnType<typeof createLog>, callId: string, skill: { name: string; kind: 'method' | 'style'; title: string }, body: string): number {
      const a = append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId, name: 'load_skill', input: { name: skill.name }, argsDone: true }],
      });
      append(log, { kind: 'toolResult', callId, name: 'load_skill', content: body, isError: false, detail: { skill } });
      return a.seq;
    }

    function work(log: ReturnType<typeof createLog>, callId: string): void {
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId, name: 'place_object', input: { id: 'tree' }, argsDone: true }],
      });
      append(log, { kind: 'toolResult', callId, name: 'place_object', content: 'placed', isError: false });
    }

    it('a delivered steer opens the retained group, so the evicted body returns right behind the summary', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build a village', mapContext: '' });
      loadSkill(log, 'c1', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);
      work(log, 'c2');
      const steer = append(log, { kind: 'steer', text: 'make it smaller' });
      const delivered = append(log, { kind: 'steerDelivered', steerSeq: steer.seq });
      work(log, 'c3');
      append(log, { kind: 'compaction', summary: 'a village is going up', retainedFromSeq: delivered.seq });

      const out = deriveMessages(log, { budgetTokens: 1_000_000 });

      expect(out[0]).toEqual({ role: 'user', text: '(conversation summary, reference only) <summary_data>"a village is going up"</summary_data>' });
      expect(out[1]).toEqual({ role: 'user', text: `(playbook still loaded: "Cozy Village")\n<playbook_data>${quotePromptData(COZY)}</playbook_data>` });
      // The steer that opened the retained group still speaks: its own `steer` event necessarily
      // sits BEFORE the cut (a steer is logged when typed, delivered later), so reading the text
      // from the retained window alone would drop the user's words at exactly this boundary.
      expect(out[2]).toEqual({ role: 'user', text: 'make it smaller' });
      expect(JSON.stringify(out).split('ring it with houses')).toHaveLength(2);
    });

    it('a follow-up order opens the retained group, and the body returns the same way', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build a village', mapContext: '' });
      loadSkill(log, 'c1', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);
      work(log, 'c2');
      const second = append(log, { kind: 'order', text: 'now add the pines', mapContext: 'ctx' });
      work(log, 'c3');
      append(log, { kind: 'compaction', summary: 'a village is going up', retainedFromSeq: second.seq });

      const out = deriveMessages(log, { budgetTokens: 1_000_000 });

      expect(out[0]).toEqual({ role: 'user', text: '(conversation summary, reference only) <summary_data>"a village is going up"</summary_data>' });
      expect(out[1]).toEqual({ role: 'user', text: `(playbook still loaded: "Cozy Village")\n<playbook_data>${quotePromptData(COZY)}</playbook_data>` });
      expect(out[2]).toEqual({ role: 'user', text: orderText('ctx', 'now add the pines') });
    });

    it('two playbooks either side of the cut, and only the evicted one is re-issued', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build a village', mapContext: '' });
      loadSkill(log, 'c1', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);
      const steer = append(log, { kind: 'steer', text: 'switch to a garden' });
      const delivered = append(log, { kind: 'steerDelivered', steerSeq: steer.seq });
      loadSkill(log, 'c2', { name: 'zen-garden', kind: 'style', title: 'Zen Garden' }, ZEN);
      append(log, { kind: 'compaction', summary: 'a garden now', retainedFromSeq: delivered.seq });

      const out = deriveMessages(log, { budgetTokens: 1_000_000 });

      const reissued = out.filter((m) => m.role === 'user' && m.text.startsWith('(playbook still loaded:'));
      expect(reissued).toEqual([{ role: 'user', text: `(playbook still loaded: "Cozy Village")\n<playbook_data>${quotePromptData(COZY)}</playbook_data>` }]);
      // The retained load replays natively as its own tool result, so it is present but not doubled.
      const zenCarriers = out.filter((m) => JSON.stringify(m).includes('rake the gravel'));
      expect(zenCarriers).toHaveLength(1);
      expect(zenCarriers[0]?.role).toBe('tool');
    });

    it('re-issues the NEWEST evicted load per playbook, not every one of them', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build a village', mapContext: '' });
      loadSkill(log, 'c1', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, 'STALE BODY');
      loadSkill(log, 'c2', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);
      const second = append(log, { kind: 'order', text: 'carry on', mapContext: '' });
      append(log, { kind: 'compaction', summary: 'carrying on', retainedFromSeq: second.seq });

      const out = deriveMessages(log, { budgetTokens: 1_000_000 });

      const reissued = out.filter((m) => m.role === 'user' && m.text.startsWith('(playbook still loaded:'));
      expect(reissued).toEqual([{ role: 'user', text: `(playbook still loaded: "Cozy Village")\n<playbook_data>${quotePromptData(COZY)}</playbook_data>` }]);
      expect(JSON.stringify(out)).not.toContain('STALE BODY');
    });

    it('re-issues nothing for a playbook the retained window RELOADED: it replays natively, not twice', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build a village', mapContext: '' });
      loadSkill(log, 'c1', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);
      const second = append(log, { kind: 'order', text: 'carry on', mapContext: '' });
      loadSkill(log, 'c2', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);
      append(log, { kind: 'compaction', summary: 'carrying on', retainedFromSeq: second.seq });

      const out = deriveMessages(log, { budgetTokens: 1_000_000 });

      expect(out.filter((m) => m.role === 'user' && m.text.startsWith('(playbook still loaded:'))).toEqual([]);
      expect(JSON.stringify(out).split('ring it with houses')).toHaveLength(2);
    });

    it('re-issues nothing for a FAILED load, and nothing at all without a compaction', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build a village', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'load_skill', input: { name: 'nope' }, argsDone: true }],
      });
      append(log, { kind: 'toolResult', callId: 'c1', name: 'load_skill', content: 'Unknown skill "nope".', isError: true });
      loadSkill(log, 'c2', { name: 'cozy-village', kind: 'style', title: 'Cozy Village' }, COZY);

      // No compaction yet: the load is inside the live window and needs no help.
      expect(deriveMessages(log, { budgetTokens: 1_000_000 }).some((m) => m.role === 'user' && m.text.startsWith('(playbook still loaded:'))).toBe(false);

      const second = append(log, { kind: 'order', text: 'carry on', mapContext: '' });
      append(log, { kind: 'compaction', summary: 'carrying on', retainedFromSeq: second.seq });
      const out = deriveMessages(log, { budgetTokens: 1_000_000 });
      const reissued = out.filter((m) => m.role === 'user' && m.text.startsWith('(playbook still loaded:'));
      expect(reissued).toEqual([{ role: 'user', text: `(playbook still loaded: "Cozy Village")\n<playbook_data>${quotePromptData(COZY)}</playbook_data>` }]);
      expect(JSON.stringify(out)).not.toContain('Unknown skill');
    });
  });

  it('keeps the image only on the last image-bearing tool message, leaving the log untouched', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c1', name: 'capture', input: {}, argsDone: true }] });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'capture', content: 'shot1', isError: false, image: 'data:1' });
    append(log, { kind: 'order', text: 'again', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c2', name: 'capture', input: {}, argsDone: true }] });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'capture', content: 'shot2', isError: false, image: 'data:2' });

    const out = deriveMessages(log, { budgetTokens: 10_000 });
    const toolMessages = out.filter((m): m is Extract<ProviderMessage, { role: 'tool' }> => m.role === 'tool');

    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.results[0]?.image).toBeUndefined();
    expect(toolMessages[1]?.results[0]?.image).toBe('data:2');

    const rawResult = log.events.find((e) => e.kind === 'toolResult' && e.callId === 'c1');
    expect(rawResult && 'image' in rawResult ? rawResult.image : undefined).toBe('data:1');
  });

  it('drops the oldest whole exchanges atomically to fit the budget, always starting the window on a user message, and never drops the newest exchange even over budget', () => {
    const log = createLog(() => 0);
    // Group A is a multi-message exchange (user + assistant + tool result): dropping it must be
    // all-or-nothing, never leaving its assistant or tool message behind without its opener.
    append(log, { kind: 'order', text: 'one', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: {}, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'result-one', isError: false });
    append(log, { kind: 'order', text: 'two', mapContext: '' });
    append(log, { kind: 'order', text: 'three', mapContext: '' });

    const groupA: ProviderMessage[] = [
      { role: 'user', text: orderText('', 'one') },
      { role: 'assistant', text: '', toolCalls: [{ callId: 'c1', name: 'place_object', args: {} }] },
      { role: 'tool', results: [{ callId: 'c1', name: 'place_object', content: 'result-one', isError: false }] },
    ];
    const groupB: ProviderMessage = { role: 'user', text: orderText('', 'two') };
    const groupC: ProviderMessage = { role: 'user', text: orderText('', 'three') };

    const fitAll = deriveMessages(log, { budgetTokens: 10_000, estimate: (s) => s.length });
    expect(fitAll).toEqual([...groupA, groupB, groupC]);

    // A budget that fits exactly B+C, but not A: A must vanish whole, with none of its three
    // messages leaking into the surviving window (no partial "user only, tool dropped" shape).
    const estimate = (s: string) => s.length;
    const costOf = (m: ProviderMessage): number =>
      estimate(m.role === 'user' ? m.text : m.role === 'assistant' ? m.text : m.results.map((r) => r.content).join(''));
    const budgetForBAndC = costOf(groupB) + costOf(groupC);
    const droppedOldest = deriveMessages(log, { budgetTokens: budgetForBAndC, estimate });
    expect(droppedOldest).toEqual([groupB, groupC]);
    expect(droppedOldest[0]?.role).toBe('user');

    // A budget too small even for the single newest exchange alone: it still ships whole, over
    // budget, rather than being dropped down to nothing.
    const tooSmallForC = deriveMessages(log, { budgetTokens: 1, estimate });
    expect(tooSmallForC).toEqual([groupC]);
  });

  it('inserts an "(about your request) " user message right after the tool message carrying a words-gated call\'s result, orphaned or real', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'make it smaller' });

    // A second exchange where the gated call DID get a real recorded toolResult: the words
    // message must still follow immediately, now after that real result rather than a synthesized one.
    append(log, { kind: 'order', text: 'go again', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c2', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'paint_terrain', content: 'painted a mountain', isError: false });
    append(log, { kind: 'gateAsked', gateId: 'g2', scope: 'tool', callId: 'c2', summary: 'paint more' });
    append(log, { kind: 'gateAnswered', gateId: 'g2', answer: 'words', words: 'add more trees' });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    // No toolResult was ever recorded for the first gated call, but it carries a 'words' answer,
    // so it gets the synthesized skip result rather than the generic orphan message (which is for
    // calls with NO gate pair at all); the trailing words-message still follows it.
    expect(out[2]).toEqual({
      role: 'tool',
      results: [{
        callId: 'c1',
        name: 'paint_terrain',
        content: 'The user chose not to run this call. Continue without it, or ask what they would prefer.',
        isError: false,
      }],
    });
    expect(out[3]).toEqual({ role: 'user', text: '(about your request) make it smaller' });

    // The second call's tool message carries its REAL recorded result, and the words-message
    // still lands immediately after it.
    expect(out[6]).toEqual({
      role: 'tool',
      results: [{ callId: 'c2', name: 'paint_terrain', content: 'painted a mountain', isError: false }],
    });
    expect(out[7]).toEqual({ role: 'user', text: '(about your request) add more trees' });
  });

  it('synthesizes a non-error "user chose not to run this call" result for a skip-gated call with no recorded toolResult', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[2]).toEqual({
      role: 'tool',
      results: [{
        callId: 'c1',
        name: 'paint_terrain',
        content: 'The user chose not to run this call. Continue without it, or ask what they would prefer.',
        isError: false,
      }],
    });
    // A denial is never a retryable error, and a plain 'skip' carries no words to echo back.
    expect(out).toHaveLength(3);
  });

  it('leaves a skip-gated call untouched when a real toolResult was recorded anyway: the real result wins over synthesis', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
    // A real result landed for this call anyway (a resumed run that finished it before the skip
    // answer's own effect took hold): the recorded result must win, not the synthesized skip text.
    append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted anyway', isError: false });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[2]).toEqual({
      role: 'tool',
      results: [{ callId: 'c1', name: 'paint_terrain', content: 'painted anyway', isError: false }],
    });
  });

  it('falls to the generic "No result recorded." orphan for an allow-always-answered call with no toolResult, never the skip message', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'allow-always' });
    // Allowed (even always-allowed) should have run and produced a real result; one missing here
    // is an anomaly, not a denial, so it must read as the generic orphan rather than the skip text.

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[2]).toEqual({
      role: 'tool',
      results: [{ callId: 'c1', name: 'paint_terrain', content: 'No result recorded.', isError: true }],
    });
  });

  it('leaves an allowed gate with a real recorded result untouched', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'allow' });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted a mountain', isError: false });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[2]).toEqual({
      role: 'tool',
      results: [{ callId: 'c1', name: 'paint_terrain', content: 'painted a mountain', isError: false }],
    });
    expect(out).toHaveLength(3);
  });

  it('appends one trailing "(system) ..." user message when appendSystemNote is given, verbatim and outside the budget window', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });

    const out = deriveMessages(log, { budgetTokens: 10_000, appendSystemNote: '(system) 5 turns remain.' });

    expect(out).toEqual([
      { role: 'user', text: orderText('', 'go') },
      { role: 'user', text: '(system) 5 turns remain.' },
    ]);

    // Even a budget too small for the order itself still ships the note: it rides outside the
    // budget-trimmed window entirely, never counted against it and never dropped by it.
    const tight = deriveMessages(log, { budgetTokens: 1, estimate: (s) => s.length, appendSystemNote: '(system) wrap up' });
    expect(tight).toEqual([
      { role: 'user', text: orderText('', 'go') },
      { role: 'user', text: '(system) wrap up' },
    ]);
  });

  it('omits the trailing note entirely when appendSystemNote is not given', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const out = deriveMessages(log, { budgetTokens: 10_000 });
    expect(out).toEqual([{ role: 'user', text: orderText('', 'go') }]);
  });

  it('applies the generic orphan rule to a call with no gate pair at all', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out[2]).toEqual({
      role: 'tool',
      results: [{ callId: 'c1', name: 'paint_terrain', content: 'No result recorded.', isError: true }],
    });
  });

  it('binds each toolResult to its own occurrence when a callId repeats across turns, never leaking the later result into the earlier turn', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'call-0-0', name: 'paint_terrain', input: { x: 1 }, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'call-0-0', name: 'paint_terrain', content: 'painted first', isError: false });
    append(log, { kind: 'order', text: 'again', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'call-0-0', name: 'paint_terrain', input: { x: 2 }, argsDone: true }],
    });
    append(log, { kind: 'toolResult', callId: 'call-0-0', name: 'paint_terrain', content: 'painted second', isError: false });

    const out = deriveMessages(log, { budgetTokens: 10_000 });
    const toolMessages = out.filter((m): m is Extract<ProviderMessage, { role: 'tool' }> => m.role === 'tool');

    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.results[0]?.content).toBe('painted first');
    expect(toolMessages[1]?.results[0]?.content).toBe('painted second');
  });

  it('binds a skip-gated call\'s synthesized result to its own occurrence too, not a later reissue of the same callId', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'call-0-0', name: 'paint_terrain', input: { x: 1 }, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'call-0-0', summary: 'paint' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
    // No toolResult for the first occurrence: it was skipped, never executed.

    append(log, { kind: 'order', text: 'again', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'call-0-0', name: 'paint_terrain', input: { x: 2 }, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g2', scope: 'tool', callId: 'call-0-0', summary: 'paint again' });
    append(log, { kind: 'gateAnswered', gateId: 'g2', answer: 'allow' });
    append(log, { kind: 'toolResult', callId: 'call-0-0', name: 'paint_terrain', content: 'painted second', isError: false });

    const out = deriveMessages(log, { budgetTokens: 10_000 });
    const toolMessages = out.filter((m): m is Extract<ProviderMessage, { role: 'tool' }> => m.role === 'tool');

    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.results[0]).toEqual({
      callId: 'call-0-0', name: 'paint_terrain',
      content: 'The user chose not to run this call. Continue without it, or ask what they would prefer.',
      isError: false,
    });
    expect(toolMessages[1]?.results[0]).toEqual({ callId: 'call-0-0', name: 'paint_terrain', content: 'painted second', isError: false });
  });
});

describe('rawIsAllFrom', () => {
  it('is true for a log holding no raw at all', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'done', done: true }] });
    expect(rawIsAllFrom(log, 'model-a')).toBe(true);
  });

  it('is true only while every raw-carrying turn names this model', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'assistant', stop: 'stop', parts: [], raw: ['a'], rawModel: 'model-a' });
    expect(rawIsAllFrom(log, 'model-a')).toBe(true);
    expect(rawIsAllFrom(log, 'model-b')).toBe(false);

    append(log, { kind: 'assistant', stop: 'stop', parts: [], raw: ['b'], rawModel: 'model-b' });
    // A model switch does not remove what is already logged, so neither model owns all of it now.
    expect(rawIsAllFrom(log, 'model-a')).toBe(false);
    expect(rawIsAllFrom(log, 'model-b')).toBe(false);
  });

  it('reads raw with no recorded producer as not this model', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'assistant', stop: 'stop', parts: [], raw: ['a'] });
    expect(rawIsAllFrom(log, 'model-a')).toBe(false);
  });
});

describe('deriveMessages: system notes', () => {
  it('delivers a systemNote to the model as a user message, in log order', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'bridge the river', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'All done.', done: true }] });
    append(log, { kind: 'systemNote', note: 'delivery', text: '(system) Nothing has landed on the map yet.' });

    const out = deriveMessages(log, { budgetTokens: 10_000 });

    expect(out).toEqual([
      { role: 'user', text: '<map_context>""</map_context>\nbridge the river' },
      { role: 'assistant', text: 'All done.', toolCalls: [] },
      { role: 'user', text: '(system) Nothing has landed on the map yet.' },
    ]);
  });
});
