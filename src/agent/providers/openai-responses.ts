/** Stateless Responses transport for OpenAI models whose tools require this protocol. */
import type OpenAI from 'openai';
import type { ProviderMessage } from '../core/project-messages';
import type { FinalToolCall, StreamEvent } from '../core/types';
import { parseArgs } from '../core/json';
import { PROVIDER_SILENCE } from '../core/errors';
import { streamFailureEvent } from './http-failure';
import type { AdapterRequest } from './types';

type Input = OpenAI.Responses.ResponseInput;
type Output = Extract<OpenAI.Responses.ResponseOutputItem, { type: 'message' | 'reasoning' | 'function_call' }>;

function savedOutput(raw: unknown): Output[] | undefined {
  if (!raw || typeof raw !== 'object' || !('dialect' in raw) || raw.dialect !== 'responses') return undefined;
  return 'output' in raw && Array.isArray(raw.output) ? raw.output.filter((item): item is Output => item && ['message', 'reasoning', 'function_call'].includes(item.type)) : undefined;
}

/** Replays encrypted reasoning only with the model that produced it and unchanged call identities. */
export function responsesInput(messages: ProviderMessage[], sameModel: boolean): Input {
  const input: Input = [];
  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: [
        { type: 'input_text', text: message.text },
        ...(message.images ?? []).map((url) => ({ type: 'input_image' as const, image_url: url, detail: 'auto' as const })),
      ] });
    } else if (message.role === 'assistant') {
      const output = sameModel ? savedOutput(message.raw) : undefined;
      const calls = output?.filter((item) => item.type === 'function_call');
      if (output && calls?.length === message.toolCalls.length
        && calls.every((call, i) => call.call_id === message.toolCalls[i]?.callId)) {
        input.push(...output);
        continue;
      }
      if (message.text) input.push({ role: 'assistant', content: message.text });
      for (const call of message.toolCalls) input.push({
        type: 'function_call', call_id: call.callId, name: call.name, arguments: JSON.stringify(call.args),
      });
    } else {
      for (const result of message.results) {
        input.push({ type: 'function_call_output', call_id: result.callId, output: result.isError ? `Error: ${result.content}` : result.content });
      }
      // Complete every call/result pair before adding images as a user message.
      const images = message.results.flatMap((result) => result.image ? [{ type: 'input_image' as const, image_url: result.image, detail: 'auto' as const }] : []);
      if (images.length) input.push({ role: 'user', content: images });
    }
  }
  return input;
}

export async function* streamResponses(
  client: OpenAI, req: AdapterRequest, signal: AbortSignal, apiKey: string,
): AsyncGenerator<StreamEvent> {
  const calls = new Map<string, { callId: string; name: string }>();
  const textItems = new Set<string>();
  try {
    const stream = await client.responses.create({
      model: req.model,
      instructions: req.system,
      input: responsesInput(req.messages, req.sameModel),
      tools: req.tools.map((tool) => ({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
      ...(req.thinking?.effort ? { reasoning: { effort: req.thinking.effort as OpenAI.ReasoningEffort, summary: 'auto' as const } } : req.capabilities?.reasoning ? { reasoning: { summary: 'auto' as const } } : {}),
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(req.maxOutputTokens !== undefined ? { max_output_tokens: req.maxOutputTokens } : {}),
      stream: true,
    }, { signal });
    for await (const event of stream) {
      if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
        calls.set(event.item.id!, { callId: event.item.call_id, name: event.item.name });
        yield { t: 'tool-start', callId: event.item.call_id, name: event.item.name };
      } else if (event.type === 'response.function_call_arguments.delta') {
        const call = calls.get(event.item_id);
        if (call) yield { t: 'tool-args', callId: call.callId, delta: event.delta };
      } else if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        textItems.add(event.item_id);
        yield { t: 'text', delta: event.delta };
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        yield { t: 'reasoning', delta: event.delta };
      } else if (event.type === 'error') {
        yield streamFailureEvent({ message: event.message }, signal.aborted, [apiKey]);
        return;
      } else if (event.type === 'response.failed') {
        yield streamFailureEvent(event.response.error ?? { message: PROVIDER_SILENCE }, signal.aborted, [apiKey]);
        return;
      } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        const response = event.response;
        const final: FinalToolCall[] = [];
        for (const item of response.output) {
          if (item.type === 'function_call') {
            if (!calls.has(item.id!)) yield { t: 'tool-start', callId: item.call_id, name: item.name };
            final.push({ callId: item.call_id, name: item.name, args: parseArgs(item.arguments), rawArgs: item.arguments });
          } else if (item.type === 'message' && !textItems.has(item.id)) {
            for (const part of item.content) {
              if (part.type === 'output_text') yield { t: 'text', delta: part.text };
              if (part.type === 'refusal') yield { t: 'text', delta: part.refusal };
            }
          }
        }
        yield {
          t: 'done', stop: event.type === 'response.incomplete' ? 'length' : final.length ? 'tool-calls' : 'stop',
          final, raw: { dialect: 'responses', output: response.output },
          ...(response.usage ? { usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, cacheRead: response.usage.input_tokens_details.cached_tokens } } : {}),
        };
        return;
      }
    }
    yield streamFailureEvent({ message: PROVIDER_SILENCE }, signal.aborted, [apiKey]);
  } catch (err) {
    yield streamFailureEvent(err, signal.aborted, [apiKey]);
  }
}
