/**
 * The tool layer's own contract: what one tool declares (`ToolSpec`), what a provider is shown
 * (`ToolSchema`), and what running a call hands back. Held apart from the harness's
 * (`agent/core/types.ts`) so a tool depends on nothing above it: the two meet only where the
 * executor adapts a `ToolResult` into the core's `ExecutedResult`.
 */
import type { ToolAccess, ToolResultDetail } from '../core/types';
import type { AgentToolDeps } from './deps';
import type { AnyObjField, Infer, ObjField, Shape } from './schema';

export type { ToolAccess };

/**
 * Everything one tool is, in one record. The registry derives the wire schemas, the write and wide
 * sets, the subagent surface and dispatch from these fields, so no second table can disagree.
 */
export interface ToolSpec<S extends Shape = Shape> {
  description: string;
  input: ObjField<S>;
  /** `write` edits the map and passes the approval gate; `wide` edits beyond what its arguments
   *  name and is gated on every call under checkpoint oversight. */
  access: ToolAccess;
  /** Offered to the parent job only, never to a delegated helper. */
  parentOnly?: boolean;
  /** A successful call is a look at the map, so it reviews the edits before it. */
  verifies?: boolean;
  /** A minimal valid call in the tool's flat argument shape, shown beside an argument refusal. */
  example?: string | (() => string);
  /** Absent exactly for the protocol tools in `core/protocol.ts`, which the loop or the executor answers. */
  run?(deps: AgentToolDeps, input: Infer<ObjField<S>>): ToolOutcome | Promise<ToolOutcome>;
}

/** Declares one tool with its argument type inferred from its schema. */
export function defineTool<S extends Shape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

/** One tool as a provider sees it. */
export interface ToolSchema {
  name: string;
  description: string;
  /** The arguments as a typed schema: the source of `inputSchema` and of every call's check. */
  input: AnyObjField;
  /** JSON Schema object ({ type: 'object', properties, required }). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** What running one tool hands back. */
export interface ToolOutcome {
  content: string;
  isError: boolean;
  /** Optional rendered image (PNG data URL) — adapters encode it natively;
   *  only attach when the active model supports vision. */
  image?: { dataUrl: string };
  /** What the edit amounted to, for the panel's op rows: the handlers compute it as they run and
   *  `exec/executor.ts` passes it through. Never sent to the provider. */
  detail?: ToolResultDetail;
}

/** One tool's outcome bound to the call that produced it. */
export interface ToolResult extends ToolOutcome {
  toolCallId: string;
}
