import { parseArgs, parsePartial } from './json';
import type {
  Part, ReasoningPart, StopReason, StreamEvent, TextPart, ToolPart, TurnError, TurnQuirk, Usage,
} from './types';

/** A turn's finished shape: parts as they landed, why the stream stopped, and which tool calls
 *  a caller must not execute (unparseable args, or every call when the whole batch was truncated). */
export interface AssembledTurn {
  parts: Part[];
  stop: StopReason;
  usage?: Usage;
  raw?: unknown;
  error?: TurnError;
  badCalls: string[];
  /** What the adapter had to normalize to deliver these parts, where it normalized anything. */
  quirks?: TurnQuirk[];
}

export interface Assembler {
  push(ev: StreamEvent): void;
  /** Live parts, cheap to call every render: an element unchanged since the last call keeps its
   *  object identity, so a consumer can diff by reference instead of deep-comparing. */
  snapshot(): readonly Part[];
  finish(): AssembledTurn;
}

/** Per-call bookkeeping alongside its `ToolPart`: the raw arg buffer is never re-derivable from
 *  `input` once parsed, so it is kept here rather than read back off the part. `lastKey` is the
 *  `JSON.stringify` of the last parse actually applied to the part, so a delta that grows the raw
 *  buffer but reparses to the same value (e.g. trailing whitespace) can skip the replace and keep
 *  both the part and its `input` at their old identity. */
interface ToolState { index: number; raw: string; lastKey: string }

export function createAssembler(): Assembler {
  const parts: Part[] = [];
  const tools = new Map<string, ToolState>();
  // A turn carries at most one running text part and one running reasoning part: a tool call
  // interposed between two text deltas closes the part (`done: true`) but the NEXT text delta
  // reopens the same object rather than starting a new one, so the two stay one continuous
  // message with tool cards embedded, matching a real reply that talks, calls a tool, and
  // keeps talking.
  let textIndex: number | undefined;
  let reasoningIndex: number | undefined;
  let stop: StopReason | undefined;
  let usage: Usage | undefined;
  let raw: unknown;
  let error: TurnError | undefined;
  let quirks: TurnQuirk[] | undefined;
  const badCalls: string[] = [];

  function closeIfOpen(index: number | undefined): void {
    if (index === undefined) return;
    const part = parts[index];
    if (part && (part.kind === 'text' || part.kind === 'reasoning') && !part.done) {
      parts[index] = { ...part, done: true };
    }
  }

  function appendTextLike(kind: 'text' | 'reasoning', delta: string): void {
    const existing = kind === 'text' ? textIndex : reasoningIndex;
    if (existing !== undefined) {
      const part = parts[existing] as TextPart | ReasoningPart;
      parts[existing] = { ...part, text: part.text + delta, done: false };
      return;
    }
    const index = parts.length;
    parts.push({ kind, text: delta, done: false });
    if (kind === 'text') textIndex = index;
    else reasoningIndex = index;
  }

  function push(ev: StreamEvent): void {
    switch (ev.t) {
      case 'text':
        appendTextLike('text', ev.delta);
        break;
      case 'reasoning':
        appendTextLike('reasoning', ev.delta);
        break;
      case 'tool-start': {
        closeIfOpen(textIndex);
        closeIfOpen(reasoningIndex);
        // Providers repeat the call header across chunks; a repeat must reuse the open part
        // rather than open a second one that never receives another arg delta and never closes.
        if (tools.has(ev.callId)) break;
        const index = parts.length;
        parts.push({ kind: 'tool', callId: ev.callId, name: ev.name, input: {}, argsDone: false });
        tools.set(ev.callId, { index, raw: '', lastKey: '{}' });
        break;
      }
      case 'tool-args': {
        const st = tools.get(ev.callId);
        const part = st && parts[st.index];
        if (!st || !part || part.kind !== 'tool') break; // no matching tool-start: nothing to attach the delta to
        st.raw += ev.delta;
        const input = parsePartial(st.raw);
        const key = JSON.stringify(input);
        if (key === st.lastKey) break; // reparses to the same value: keep the part and its input as they are
        st.lastKey = key;
        parts[st.index] = { ...part, input, rawInput: st.raw };
        break;
      }
      case 'done': {
        stop = ev.stop;
        usage = ev.usage;
        raw = ev.raw;
        if (ev.quirks && ev.quirks.length > 0) quirks = ev.quirks;
        const wholeBatchFailed = ev.stop === 'length';
        for (const call of ev.final ?? []) {
          const args = call.args ?? parseArgs(call.rawArgs);
          const st = tools.get(call.callId);
          const part = st && parts[st.index];
          if (st && part && part.kind === 'tool') {
            const reconciled: ToolPart = { ...part, name: call.name, input: args ?? part.input, argsDone: true };
            if (args === undefined) reconciled.rawInput = call.rawArgs;
            else delete reconciled.rawInput;
            parts[st.index] = reconciled;
          } else {
            // The provider's final list is authoritative: a call it names must exist even if no
            // tool-start/tool-args ever streamed for it (a fast tool call can complete inside one
            // provider-side chunk with no separate start event reaching the adapter).
            const appended: ToolPart = { kind: 'tool', callId: call.callId, name: call.name, input: args ?? {}, argsDone: true };
            if (args === undefined) appended.rawInput = call.rawArgs;
            parts.push(appended);
          }
          if (args === undefined || wholeBatchFailed) badCalls.push(call.callId);
        }
        break;
      }
      case 'error':
        error = ev.error;
        stop = 'error';
        break;
    }
  }

  function snapshot(): readonly Part[] {
    return parts.slice();
  }

  function finish(): AssembledTurn {
    // The stream is over: whatever text/reasoning was still open never gets another delta to
    // close it, so finishing the turn is what marks it done.
    closeIfOpen(textIndex);
    closeIfOpen(reasoningIndex);
    return {
      parts: parts.slice(), stop: stop ?? 'aborted', usage, raw, error, badCalls,
      ...(quirks !== undefined ? { quirks } : {}),
    };
  }

  return { push, snapshot, finish };
}
