/**
 * The adapter contract both provider dialects (Anthropic, OpenAI-compatible) build against.
 * SDK-free by design, like the rest of `core/`: a caller (the loop, a test) can read this file
 * without pulling in either SDK.
 */
import type { ModelCapabilities } from './model-catalog';
import type { ThinkingChoice } from './reasoning';
import type { ProviderMessage } from '../core/project-messages';
import type { StreamEvent } from '../core/types';

export interface AdapterRequest {
  system: string;
  messages: ProviderMessage[];
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  model: string;
  /** True when the history was produced by this same provider+model; only then is `raw` echoed
   *  back into the request (see each adapter's message-mapping function). */
  sameModel: boolean;
  maxOutputTokens?: number;
  capabilities?: ModelCapabilities;
  thinking?: ThinkingChoice;
}

export interface Adapter {
  /** Never throws: every failure, including a mid-stream abort, ends the generator with one
   *  final event (`error`, or `done` with `stop: 'aborted'`) rather than rejecting. */
  stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent>;
  listModels(signal: AbortSignal): Promise<string[]>;
}
