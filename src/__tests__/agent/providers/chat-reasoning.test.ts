import { afterEach, expect, it, vi } from 'vitest';
import { ChatReasoning } from '../../../agent/providers/chat-reasoning';
import { __resetProseEndpoints, createOpenAIAdapter } from '../../../agent/providers/openai';
import { QUIRKS } from '../../../agent/providers/defaults';
import type { ProviderMessage } from '../../../agent/core/project-messages';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: createMock } }; } }));
afterEach(() => { createMock.mockReset(); __resetProseEndpoints(); });

/** The history turn an adapter for the custom endpoint `baseUrl` sends for `messages`. */
async function sentTurn(baseUrl: string, messages: ProviderMessage[], sameModel: boolean): Promise<unknown> {
  createMock.mockReset();
  createMock.mockResolvedValue({ async *[Symbol.asyncIterator]() { yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }; } });
  const adapter = createOpenAIAdapter({ apiKey: 'sk-test', providerId: 'custom', quirks: QUIRKS.custom, baseUrl });
  for await (const _event of adapter.stream({ system: 'System', messages, tools: [], model: 'gpt-x', sameModel }, new AbortController().signal)) { /* drained */ }
  return (createMock.mock.calls[0] as [{ messages: unknown[] }])[0].messages[1];
}

it('keeps reasoning separate from prose and replays it for tool continuations only on the same model and endpoint', async () => {
  const trace = new ChatReasoning(['reasoning_content', 'reasoning'], 'https://one.example/v1');
  expect(trace.add({ reasoning_content: 'Plan ', reasoning: 'Plan ' })).toEqual(['Plan ']);
  expect(trace.add({ reasoning_content: 'the shore' })).toEqual(['the shore']);
  trace.tool('c1', { google: { thought_signature: 'signed' } });
  const messages: ProviderMessage[] = [{ role: 'assistant', text: 'Building', toolCalls: [{ callId: 'c1', name: 'paint_terrain', args: {} }], raw: trace.raw() }];
  expect(await sentTurn('https://one.example/v1', messages, true)).toMatchObject({ content: 'Building', reasoning_content: 'Plan the shore', tool_calls: [{ id: 'c1', extra_content: { google: { thought_signature: 'signed' } } }] });
  const switched = await sentTurn('https://one.example/v1', messages, false);
  expect(switched).not.toHaveProperty('reasoning_content');
  expect(JSON.stringify(switched)).not.toContain('signed');
  expect(await sentTurn('https://two.example/v1', messages, true)).not.toHaveProperty('reasoning_content');
});

it('retains ordered opaque reasoning details without displaying encrypted material or duplicating text', () => {
  const trace = new ChatReasoning(['reasoning']);
  const a = { type: 'reasoning.text', text: 'Look around', signature: 'sig', index: 0 };
  const b = { type: 'reasoning.encrypted', data: 'opaque', index: 1 };
  expect(trace.add({ reasoning: 'Look around', reasoning_details: [a] })).toEqual(['Look around']);
  expect(trace.add({ reasoning_details: [b] })).toEqual([]);
  expect(trace.raw()?.fields.reasoning_details).toEqual([a, b]);
  expect(new ChatReasoning([]).add({ reasoning_details: [{ type: 'reasoning.summary', summary: 'Check terrain' }] })).toEqual(['Check terrain']);
});
