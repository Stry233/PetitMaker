import { afterEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { responsesInput, streamResponses } from '../../../agent/providers/openai-responses';
import type { AdapterRequest } from '../../../agent/providers/types';
import type { ProviderMessage } from '../../../agent/core/project-messages';
const create = vi.fn();
const client = { responses: { create } } as unknown as OpenAI;
const req: AdapterRequest = { system: 'Help edit a map', messages: [], tools: [{ name: 'paint_terrain', description: 'Paint', parameters: { type: 'object', properties: { x: { type: 'number' } } } }], model: 'gpt-6-astra', sameModel: true };
const fn = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'paint_terrain', arguments: '{"x":3}', status: 'completed' };
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
async function* events(items: unknown[]) { yield* items; }
async function collect(request = req, signal = new AbortController().signal) {
  const result = [];
  for await (const event of streamResponses(client, request, signal, 'secret-test-key')) result.push(event);
  return result;
}
afterEach(() => vi.resetAllMocks());

describe('Responses tool transport', () => {
  it('streams thinking and tool arguments separately and retains raw output for continuation', async () => {
    create.mockResolvedValue(events([
      { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', delta: 'Check the shore' },
      { type: 'response.output_item.added', item: { ...fn, arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"x":3}' },
      { type: 'response.completed', response: { output: [reasoning, fn], usage: { input_tokens: 30, output_tokens: 10, input_tokens_details: { cached_tokens: 4 } } } },
    ]));
    const result = await collect({ ...req, thinking: { effort: 'high' } });
    expect(result.slice(0, 3)).toEqual([{ t: 'reasoning', delta: 'Check the shore' }, { t: 'tool-start', callId: 'call_1', name: 'paint_terrain' }, { t: 'tool-args', callId: 'call_1', delta: '{"x":3}' }]);
    expect(result[3]).toMatchObject({ t: 'done', stop: 'tool-calls', final: [{ callId: 'call_1', args: { x: 3 } }], raw: { dialect: 'responses', output: [reasoning, fn] }, usage: { input: 30, output: 10, cacheRead: 4 } });
    expect(create.mock.calls[0]![0]).toMatchObject({ store: false, stream: true, include: ['reasoning.encrypted_content'], reasoning: { effort: 'high', summary: 'auto' }, tools: [{ type: 'function', strict: false }] });
  });
  it('replays same-model reasoning and call IDs, then all results before tool images', () => {
    const messages: ProviderMessage[] = [
      { role: 'assistant', text: '', toolCalls: [{ callId: 'call_1', name: 'paint_terrain', args: { x: 3 } }], raw: { dialect: 'responses', output: [reasoning, fn] } },
      { role: 'tool', results: [{ callId: 'call_1', name: 'paint_terrain', content: 'done', isError: false, image: 'data:image/png;base64,AA==' }] },
    ];
    const same = responsesInput(messages, true);
    expect(same.slice(0, 2)).toEqual([reasoning, fn]);
    expect(same[2]).toMatchObject({ type: 'function_call_output', call_id: 'call_1' });
    expect(same[3]).toMatchObject({ role: 'user', content: [{ type: 'input_image' }] });
    expect(JSON.stringify(responsesInput(messages, false))).not.toContain('opaque');
    messages[0] = { ...messages[0], toolCalls: [] } as ProviderMessage;
    expect(JSON.stringify(responsesInput(messages, true))).not.toContain('opaque');
  });
  it('does not duplicate streamed answer text at completion', async () => {
    create.mockResolvedValue(events([{ type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Ready' }, { type: 'response.completed', response: { output: [{ type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'Ready' }] }] } }]));
    expect((await collect()).filter((e) => e.t === 'text')).toEqual([{ t: 'text', delta: 'Ready' }]);
  });
  it('reports truncated output, connection failures and cancellation through terminal events', async () => {
    create.mockResolvedValueOnce(events([{ type: 'response.incomplete', response: { output: [], incomplete_details: { reason: 'max_output_tokens' } } }]));
    expect(await collect()).toContainEqual(expect.objectContaining({ t: 'done', stop: 'length' }));
    create.mockRejectedValueOnce(new Error('secret-test-key failed'));
    const failed = await collect();
    expect(failed[0]?.t).toBe('error');
    expect(JSON.stringify(failed)).not.toContain('secret-test-key');
    const controller = new AbortController(); controller.abort();
    create.mockRejectedValueOnce(new Error('aborted'));
    expect(await collect(req, controller.signal)).toEqual([{ t: 'done', stop: 'aborted' }]);
  });
});
