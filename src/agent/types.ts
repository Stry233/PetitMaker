/**
 * Provider-neutral message/tool types for the AI Agent harness.
 *
 * The agent core (loop, tools, UI) speaks only these types; each provider
 * adapter converts the full neutral history to its wire format per request
 * (the LLM APIs are stateless). `AgentMessage.raw` lets an adapter round-trip
 * provider-native assistant content losslessly (e.g. Anthropic thinking blocks
 * with signatures, which must be echoed verbatim in tool-use conversations).
 */
export type ProviderId =
  | 'claude'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'openrouter'
  | 'zhipu'
  | 'qwen'
  | 'moonshot'
  /** Any OpenAI-compatible endpoint the user points at (Open WebUI, Ollama,
   *  LiteLLM, vLLM, a campus gateway…) — base URL lives in settings. */
  | 'custom';

export interface PlanStage {
  title: string;
  status: 'pending' | 'active' | 'done';
}

/** Structured tool lifecycle event for the chat timeline rail. */
export type ToolEvent =
  | { kind: 'start'; name: string }
  | { kind: 'result'; name: string; status: 'ok' | 'reverted' | 'error'; summary: string };

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema object ({ type: 'object', properties, required }). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  /** Optional rendered image (PNG data URL) — adapters encode it natively;
   *  only attach when the active model supports vision. */
  image?: { dataUrl: string };
}

export type AgentMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls: ToolCall[];
      /** Provider-native assistant content (e.g. Anthropic content blocks incl.
       *  thinking signatures), echoed back verbatim on the next request when present. */
      raw?: unknown;
    }
  | { role: 'tool'; results: ToolResult[] };

export interface AssistantTurn {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export interface StreamCallbacks {
  onTextDelta(delta: string): void;
  onToolCallStart?(name: string): void;
}

export interface AgentRequest {
  system: string;
  messages: AgentMessage[];
  tools: ToolSchema[];
  model: string;
}

export interface ProviderAdapter {
  /** Model ids offered by the platform for this key. Throws on network/CORS failure
   *  — callers fall back to the provider's static list. */
  listModels(): Promise<string[]>;
  stream(req: AgentRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<AssistantTurn>;
}
