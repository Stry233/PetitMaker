import { expect, it } from 'vitest';
import { ChatReasoning } from '../../../agent/providers/chat-reasoning';
import { toOpenAIMessages } from '../../../agent/providers/openai';
import type { ProviderMessage } from '../../../agent/core/project-messages';

it('keeps reasoning separate from prose and replays it for tool continuations only on the same model', () => {
  const trace = new ChatReasoning(['reasoning_content', 'reasoning'], 'https://one.example/v1');
  expect(trace.add({ reasoning_content: 'Plan ', reasoning: 'Plan ' })).toEqual(['Plan ']);
  expect(trace.add({ reasoning_content: 'the shore' })).toEqual(['the shore']);
  trace.tool('c1', { google: { thought_signature: 'signed' } });
  const messages: ProviderMessage[] = [{ role: 'assistant', text: 'Building', toolCalls: [{ callId: 'c1', name: 'paint_terrain', args: {} }], raw: trace.raw() }];
  expect(toOpenAIMessages('System', messages, false, true)[1]).toMatchObject({ content: 'Building', reasoning_content: 'Plan the shore', tool_calls: [{ id: 'c1', extra_content: { google: { thought_signature: 'signed' } } }] });
  const switched = toOpenAIMessages('System', messages, false, false)[1];
  expect(switched).not.toHaveProperty('reasoning_content');
  expect(JSON.stringify(switched)).not.toContain('signed');
  expect(toOpenAIMessages('System', messages, false, true, 'https://two.example/v1')[1]).not.toHaveProperty('reasoning_content');
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
