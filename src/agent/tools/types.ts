/**
 * Wire types for the tool layer (schemas, calls, results) — what a tool declares to a provider and
 * what running one hands back. This is the tool layer's OWN contract, held apart from the harness's
 * (`agent/core/types.ts`) so a tool depends on nothing above it: the two meet only where the
 * executor adapts a `ToolResult` into the core's `ExecutedResult`.
 */
import type { ToolResultDetail } from '../core/types';

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
  /** What the edit AMOUNTED to, for the panel's op rows: the handlers compute it as they run
   *  (tools-common.ts's `ToolResultBody`) and `exec/executor.ts` passes it through. Never sent to
   *  the provider. */
  detail?: ToolResultDetail;
}
