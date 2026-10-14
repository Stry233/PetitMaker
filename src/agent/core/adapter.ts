/**
 * The adapter contract the loop runs against and both provider dialects (Anthropic,
 * OpenAI-compatible) implement in `providers/`. SDK-free: the loop and the tests read it without
 * either SDK.
 */
import type { ProviderMessage } from './project-messages';
import type { StreamEvent } from './types';

/** What a model can do, merged from the bundled catalog and native discovery. */
export interface ModelCapabilities {
  name?: string;
  tools?: boolean;
  input?: string[];
  output?: string[];
  reasoning?: boolean;
  efforts?: string[];
  budget?: { min: number; max?: number };
  context?: number;
  maxOutput?: number;
}

/** One thinking setting a model offers: a named effort or a token budget. */
export interface ThinkingChoice { effort?: string; budget?: number }

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
