import { afterEach, expect, it, vi } from 'vitest';
import { requestReplySuggestion } from '../../../agent/core/reply-suggestion';
import { createScriptedAdapter } from '../../_support/agent/scripted-adapter';
import type { Adapter } from '../../../agent/core/adapter';
import { append, createLog } from '../../../agent/core/log';
import { deriveMessages } from '../../../agent/core/project-messages';

const context = { request: 'Add a pond', question: 'Shall I add flowers around it?' };
afterEach(() => vi.useRealTimers());

it('does not replay an unsent draft into provider conversation history', () => {
  const log = createLog();
  const order = append(log, { kind: 'order', text: 'Add a pond', mapContext: '' });
  append(log, { kind: 'jobEnd', outcome: 'done', question: true, summary: 'Add flowers?' });
  append(log, { kind: 'replySuggested', orderSeq: order.seq, reply: 'UNSENT_DRAFT' });
  append(log, { kind: 'order', text: 'Plant trees', mapContext: '' });
  expect(JSON.stringify(deriveMessages(log, { budgetTokens: 10000, estimate: text => text.length }))).not.toContain('UNSENT_DRAFT');
});

it('requests a bounded draft without map tools or provider history', async () => {
  const adapter = createScriptedAdapter([{ events: [
    { t: 'text', delta: '{"reply":"Yes, add flowers"}' },
    { t: 'done', stop: 'stop', usage: { input: 100, output: 8 } },
  ] }]);
  const draft = await requestReplySuggestion(adapter, { model: 'test' }, context, new AbortController().signal);
  expect(draft).toEqual({ reply: 'Yes, add flowers', usage: { input: 100, output: 8 } });
  expect(adapter.requests).toHaveLength(1);
  expect(adapter.requests[0]).toMatchObject({ tools: [], sameModel: false, maxOutputTokens: 256 });
  expect(adapter.requests[0]!.messages).toEqual([{ role: 'user', text: JSON.stringify(context) }]);
});

it.each(['{"reply":null}', '{"reply":""}', 'Yes', '{"reply":12}', JSON.stringify({ reply: 'x'.repeat(97) }), JSON.stringify({ reply: 'Yes\nbut keep the trees' })])('omits an unavailable or malformed draft: %s', async text => {
  const adapter = createScriptedAdapter([{ events: [{ t: 'text', delta: text }, { t: 'done', stop: 'stop' }] }]);
  expect(await requestReplySuggestion(adapter, { model: 'test' }, context, new AbortController().signal)).toBeNull();
});

it.each(['length', 'aborted', 'error'] as const)('does not display a draft from a %s turn', async stop => {
  const adapter = createScriptedAdapter([{ events: [{ t: 'text', delta: '{"reply":"Yes"}' }, { t: 'done', stop }] }]);
  expect(await requestReplySuggestion(adapter, { model: 'test' }, context, new AbortController().signal)).toBeNull();
});

it('cancels a stalled optional request without waiting for the provider', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const adapter: Adapter = {
    async *stream(_req, nextSignal) {
      signal = nextSignal;
      await new Promise(() => {});
      yield { t: 'done', stop: 'stop' };
    },
    async listModels() { return []; },
  };
  const pending = requestReplySuggestion(adapter, { model: 'test' }, context, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toBeNull();
  expect(signal?.aborted).toBe(true);
});

it('does not contact a provider after cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = createScriptedAdapter([]);
  expect(await requestReplySuggestion(adapter, { model: 'test' }, context, controller.signal)).toBeNull();
  expect(adapter.requests).toHaveLength(0);
});
