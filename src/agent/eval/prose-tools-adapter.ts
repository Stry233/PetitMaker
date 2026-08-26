/**
 * The prose-tools adapter: tool calling over an endpoint that refuses the `tools` parameter,
 * carried entirely in text. Wraps any real `Adapter`; the loop above keeps its native tool
 * surface and never learns the wire had none. An eval-seam rig like its siblings here — nothing
 * in the product imports it.
 *
 * REQUEST SIDE. `tools` goes down empty and the schemas are stated in the system prompt instead
 * (`proseToolsSystemSection`), and the history is rewritten so nothing tool-shaped reaches the
 * wire: an assistant turn's calls are re-rendered as the fenced blocks the model is told to
 * write, and a tool-result message becomes a user message of fenced result blocks (images ride
 * that user message, the one place the plain wire accepts them).
 *
 * THE EMISSION FORMAT, stated to the model by the injected section:
 *
 *   ```tool_call
 *   {"tool": "<name>", "args": { ... }}
 *   ```
 *
 * One fenced block per call, tag exactly `tool_call`, one JSON object per block. Several blocks
 * are several calls, run in written order; text outside the blocks is narration and is kept.
 * Results return in the next user message as ```tool_result``` blocks, one per call, in order:
 * `{"tool": "<name>", "ok": true|false, "content": "..."}`. A reply with no `tool_call` block is
 * the finishing turn.
 *
 * RESPONSE SIDE. Text is held to the end of the turn (a block published as it streams would be
 * prose the log cannot take back), then parsed: blocks become tool calls, the surrounding text
 * stays narration. A block whose JSON is broken or is not one call, but which still names a
 * tool, is delivered with UNPARSEABLE args on purpose: the loop's own reissue result is the
 * correction prompt, and its dampers own the escalation, so no second retry channel exists here.
 * A block naming no tool at all stays in the narration verbatim. A whole message body that is one
 * bare `{"name", "arguments"}` object is recognized through `toolCallInProse` — the reader
 * `providers/openai.ts` normalizes that wire shape with — rather than a second parser. Every turn
 * whose calls came out of prose carries the `tool-call-as-prose` quirk.
 */
import { parseArgs } from '../core/json';
import type { ProviderMessage } from '../core/project-messages';
import type { FinalToolCall, StreamEvent, TurnQuirk } from '../core/types';
import { toolCallInProse } from '../providers/openai';
import type { Adapter, AdapterRequest } from '../providers/types';

export const PROSE_CALL_TAG = 'tool_call';
export const PROSE_RESULT_TAG = 'tool_result';

type WireTool = AdapterRequest['tools'][number];
type DoneEvent = Extract<StreamEvent, { t: 'done' }>;

/** The protocol contract plus every tool's schema, appended to the system prompt of a prose run. */
export function proseToolsSystemSection(tools: readonly WireTool[]): string {
  const lines: string[] = [
    '## Tool calls, in text',
    '',
    'This endpoint has no native tool-calling channel, so you call tools by writing them into '
    + `your reply. Emit one fenced code block per call, tagged exactly \`${PROSE_CALL_TAG}\`:`,
    '',
    '```' + PROSE_CALL_TAG,
    '{"tool": "<tool name>", "args": { ... }}',
    '```',
    '',
    '- One JSON object per block: "tool" names one of the tools listed below, "args" is an object '
    + 'matching that tool\'s parameters schema (use {} for a tool that takes nothing).',
    '- Write several blocks to make several calls in one reply; they run in the order written.',
    '- Text outside the blocks is your own narration; write it as you normally would.',
    '- Each result arrives in the next user message as a fenced block tagged '
    + `\`${PROSE_RESULT_TAG}\`, one per call, in the same order:`,
    '',
    '```' + PROSE_RESULT_TAG,
    '{"tool": "<tool name>", "ok": true, "content": "<the tool\'s answer>"}',
    '```',
    '',
    '- When the job is finished, reply with no tool_call block at all; that closing reply ends the job.',
    '',
    '## Tools',
  ];
  for (const t of tools) {
    lines.push('', `### ${t.name}`, t.description, `Parameters (JSON Schema): ${JSON.stringify(t.parameters)}`);
  }
  return lines.join('\n');
}

/** One call, re-rendered the way the model is told to write it, for replayed history. */
export function renderCallBlock(name: string, args: Record<string, unknown>): string {
  return '```' + PROSE_CALL_TAG + '\n' + JSON.stringify({ tool: name, args }) + '\n```';
}

function renderResultBlock(r: { name: string; content: string; isError: boolean }): string {
  return '```' + PROSE_RESULT_TAG + '\n' + JSON.stringify({ tool: r.name, ok: !r.isError, content: r.content }) + '\n```';
}

/** History with every tool shape folded into the text protocol: assistant calls become
 *  `tool_call` blocks appended to the turn's own text, tool results become a user message of
 *  `tool_result` blocks. `raw` is dropped with the rewrite — a rewritten turn is not the bytes
 *  any provider minted. */
export function proseMessages(messages: readonly ProviderMessage[]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push(m);
    } else if (m.role === 'assistant') {
      const blocks = m.toolCalls.map((c) => renderCallBlock(c.name, c.args));
      const text = [m.text, ...blocks].filter((s) => s.length > 0).join('\n\n');
      out.push({ role: 'assistant', text, toolCalls: [] });
    } else {
      const text = m.results.map(renderResultBlock).join('\n\n');
      const images = m.results.map((r) => r.image).filter((i): i is string => i !== undefined);
      out.push({ role: 'user', text, ...(images.length > 0 ? { images } : {}) });
    }
  }
  return out;
}

/** A call read out of the turn's text. `args` absent means the block named a tool but its
 *  arguments did not parse as one object: the call is delivered anyway so the loop's reissue
 *  result corrects the model through the ordinary tool-result channel. */
export interface ProseCall { name: string; args?: Record<string, unknown>; rawArgs: string }

export interface ProseParsedTurn { narration: string; calls: ProseCall[] }

const BLOCK_RE = new RegExp('```' + PROSE_CALL_TAG + '[^\\S\\n]*\\n([\\s\\S]*?)```', 'g');
const SALVAGE_NAME_RE = /"(?:tool|name)"\s*:\s*"([^"]+)"/;

/** Prefixed onto a malformed block's raw bytes so no later reader can parse them into an object:
 *  `parseArgs` REPAIRS truncated JSON, so the raw block handed down bare could re-parse downstream
 *  (the assembler re-derives args from `rawArgs`) and run the `{tool, args}` wrapper itself as the
 *  tool's own arguments. The prefix keeps the bytes readable and honestly unparseable. */
export const MALFORMED_ARGS_PREFIX = '(malformed tool_call block) ';

/** The block's `args`/`arguments` field as one object: absent reads as no arguments, a JSON
 *  string is parsed, anything else is malformed. The same tolerance `providers/openai.ts` extends
 *  to the bare wire shape, since models emitting calls in prose use both spellings. */
function readArgs(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') return raw.trim() === '' ? {} : parseArgs(raw);
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/** One fenced block, read as a call, a malformed call (a tool named, args unusable), or narration
 *  (nothing tool-shaped in it at all). An unknown tool name is still a call: the executor's own
 *  unknown-tool error is the correction, the same answer the native channel gives it. */
function blockToCall(body: string): ProseCall | 'narration' {
  const trimmed = body.trim();
  const parsed = parseArgs(trimmed);
  if (parsed) {
    const name = typeof parsed.tool === 'string' ? parsed.tool
      : typeof parsed.name === 'string' ? parsed.name
      : undefined;
    if (name !== undefined) {
      const args = readArgs(parsed.args ?? parsed.arguments);
      if (args) return { name, args, rawArgs: JSON.stringify(args) };
      return { name, rawArgs: MALFORMED_ARGS_PREFIX + trimmed };
    }
  }
  const salvaged = SALVAGE_NAME_RE.exec(trimmed);
  if (salvaged?.[1]) return { name: salvaged[1], rawArgs: MALFORMED_ARGS_PREFIX + trimmed };
  return 'narration';
}

/** The whole turn's text split into narration and calls. With no fenced block anywhere, a body
 *  that is one bare `{name, arguments}` object is the call it looks like, read by the same
 *  `toolCallInProse` the OpenAI dialect uses for that wire shape. */
export function parseProseTurn(text: string, toolNames: ReadonlySet<string>): ProseParsedTurn {
  const calls: ProseCall[] = [];
  const segments: string[] = [];
  let buffer = '';
  let last = 0;
  for (const m of text.matchAll(BLOCK_RE)) {
    const at = m.index ?? 0;
    buffer += text.slice(last, at);
    last = at + m[0].length;
    const call = blockToCall(m[1] ?? '');
    if (call === 'narration') {
      buffer += m[0];
    } else {
      if (buffer.trim().length > 0) segments.push(buffer.trim());
      buffer = '';
      calls.push(call);
    }
  }
  buffer += text.slice(last);
  if (buffer.trim().length > 0) segments.push(buffer.trim());

  if (calls.length === 0) {
    const bare = toolCallInProse(text, toolNames);
    if (bare) return { narration: '', calls: [{ name: bare.name, args: bare.args, rawArgs: bare.rawArgs }] };
  }
  return { narration: segments.join('\n\n'), calls };
}

export function createProseToolsAdapter(inner: Adapter): Adapter {
  let turn = 0;

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      turn += 1;
      const toolNames = new Set(req.tools.map((t) => t.name));
      const proseReq: AdapterRequest = {
        ...req,
        system: `${req.system}\n\n${proseToolsSystemSection(req.tools)}`,
        messages: proseMessages(req.messages),
        tools: [],
        // The history text was rewritten, so no turn's raw bytes may be replayed as this model's own.
        sameModel: false,
      };

      let text = '';
      let done: DoneEvent | undefined;
      for await (const ev of inner.stream(proseReq, signal)) {
        if (ev.t === 'text') { text += ev.delta; continue; }
        if (ev.t === 'done') { done = ev; break; }
        // Reasoning streams live; native tool events from a gateway that answered in the proper
        // channel anyway pass through and their finals merge below.
        yield ev;
        if (ev.t === 'error') return;
      }
      if (done === undefined) { yield { t: 'done', stop: 'aborted' }; return; }

      if (done.stop === 'length') {
        // A truncated body cannot be trusted to be the whole of any block it opened.
        if (text.length > 0) yield { t: 'text', delta: text };
        yield done;
        return;
      }

      const { narration, calls } = parseProseTurn(text, toolNames);
      if (narration.length > 0) yield { t: 'text', delta: narration };

      const final: FinalToolCall[] = [...(done.final ?? [])];
      for (const [i, call] of calls.entries()) {
        const callId = `prose-${turn}-${i}`;
        yield { t: 'tool-start', callId, name: call.name };
        yield { t: 'tool-args', callId, delta: call.rawArgs };
        final.push({ callId, name: call.name, ...(call.args !== undefined ? { args: call.args } : {}), rawArgs: call.rawArgs });
      }

      const quirks: TurnQuirk[] | undefined = calls.length > 0
        ? [...new Set<TurnQuirk>([...(done.quirks ?? []), 'tool-call-as-prose'])]
        : done.quirks;
      yield {
        t: 'done',
        stop: final.length > 0 ? 'tool-calls' : done.stop,
        ...(final.length > 0 ? { final } : {}),
        ...(done.usage !== undefined ? { usage: done.usage } : {}),
        ...(quirks !== undefined && quirks.length > 0 ? { quirks } : {}),
      };
    },

    listModels(signal: AbortSignal): Promise<string[]> {
      return inner.listModels(signal);
    },
  };
}
