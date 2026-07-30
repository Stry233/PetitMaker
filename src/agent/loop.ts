/**
 * The streaming agentic loop: one user turn runs assistant-stream → execute
 * tool calls → feed results back, until the model stops calling tools, the
 * iteration cap is hit, or the run is aborted.
 *
 * The loop is provider-agnostic (ProviderAdapter) and editor-agnostic
 * (execTool injection) — the UI wires both in. Tool execution is synchronous
 * editor work, so Stop (abort) takes effect between API turns.
 */
import type { AgentMessage, ProviderAdapter, ToolCall, ToolResult, ToolSchema, ToolEvent } from './types';

export const MAX_AGENT_TURNS = 40;
/** Cap the messages sent to the API (the UI transcript is unaffected). */
const HISTORY_BUDGET = 60;
/** Warn the model when this many assistant turns remain, so it lands the plan
 *  instead of getting cut off by the cap. */
const BUDGET_WARN_AT = 5;

/** Stable stringify (sorted object keys at every level) so two verbatim
 *  retries hash identically regardless of key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

/** Canonical signature of a tool call — detects verbatim retries. */
function callSignature(name: string, input: Record<string, unknown>): string {
  return `${name}:${canonical(input ?? {})}`;
}

/** Cap in-flight images at one: stale renders of a since-edited map mislead
 *  the model, and every lingering image re-bills tokens on EVERY request.
 *  Returns shallow copies; never mutates the stored history. */
export function keepLatestImageOnly(messages: AgentMessage[]): AgentMessage[] {
  // Find the last tool message that contains at least one image result.
  let lastImageIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'tool' && m.results.some((r) => r.image)) {
      lastImageIdx = i;
      break;
    }
  }
  // Nothing to strip — return the original array reference.
  if (lastImageIdx === -1) return messages;

  return messages.map((m, i) => {
    if (m.role !== 'tool') return m;
    // The last image-bearing tool message keeps its images.
    if (i === lastImageIdx) return m;
    // Only copy messages that actually have an image to strip.
    if (!m.results.some((r) => r.image)) return m;
    return { ...m, results: m.results.map((r) => (r.image ? { ...r, image: undefined } : r)) };
  });
}

export interface AgentTurnParams {
  adapter: ProviderAdapter;
  model: string;
  system: string;
  tools: ToolSchema[];
  history: AgentMessage[];
  userText: string;
  mapContext: string;
  execTool(call: ToolCall): ToolResult | Promise<ToolResult>;
  onTextDelta(delta: string): void;
  onToolEvent(ev: ToolEvent): void;
  /** Called when one assistant message finishes streaming (before its tools run). */
  onAssistantDone?(text: string): void;
  signal: AbortSignal;
  /** Override the assistant-turn budget (e.g. tighter for sub-agents). */
  maxTurns?: number;
  /** Called when the model tries to END its turn: return a "(system)" line to
   *  send it back to work (e.g. a blueprint with unfinished stages), or null
   *  to let it finish. Bounded to two continuations per run. */
  unfinishedWork?(): string | null;
}

/** Runs one user turn to completion (streams text + tool round-trips). Returns the new history. */
export async function runAgentTurn(p: AgentTurnParams): Promise<AgentMessage[]> {
  const history: AgentMessage[] = [...p.history];
  const user = p.mapContext ? `<map_context>\n${p.mapContext}\n</map_context>\n\n${p.userText}` : p.userText;
  history.push({ role: 'user', content: user });

  const maxTurns = p.maxTurns ?? MAX_AGENT_TURNS;
  // Damper state (per user turn): verbatim-retry counter and per-tool revert
  // counter. A controller that keeps re-issuing a failing action is oscillating
  // — the harness injects escalating guidance instead of letting it burn turns.
  const failCounts = new Map<string, number>();
  const revertCounts = new Map<string, number>();
  // Reasoning-heavy models (gpt-oss, R1, QwQ) sometimes emit a turn with ONLY
  // hidden reasoning — no text, no tool calls. That is not a completion signal;
  // nudge them to continue (bounded, so a dead model still terminates the loop).
  let emptyNudges = 0;
  let unfinishedNudges = 0;
  for (let turn = 0; turn < maxTurns; turn++) {
    if (p.signal.aborted) break;
    const windowed = history.length > HISTORY_BUDGET ? history.slice(history.length - HISTORY_BUDGET) : history;
    // The window must open on a USER message: an orphaned tool result is an API error on
    // every provider, and Anthropic additionally rejects a conversation whose first
    // message is an assistant turn — which is where a mid-run cut usually lands, since
    // the history shape is user, [assistant, tool] × N. If the window holds no user
    // message at all (one giant tool-heavy turn), a stub user line keeps it valid.
    const firstUser = windowed.findIndex((m) => m.role === 'user');
    let msgs: AgentMessage[];
    if (firstUser === 0) {
      msgs = windowed;
    } else if (firstUser > 0) {
      msgs = windowed.slice(firstUser);
    } else {
      // No user message in the window at all: keep the assistant/tool pairing intact
      // (an assistant tool_use with no following results is itself an API error) and
      // open with a stub user line.
      const firstNonTool = windowed.findIndex((m) => m.role !== 'tool');
      const tail = firstNonTool > 0 ? windowed.slice(firstNonTool) : windowed;
      msgs = [{ role: 'user', content: '(system) Earlier context was trimmed to fit; continue the task.' }, ...tail];
    }
    const trimmed = keepLatestImageOnly(msgs);
    let turnResult;
    try {
      turnResult = await p.adapter.stream(
        { system: p.system, messages: trimmed, tools: p.tools, model: p.model },
        { onTextDelta: p.onTextDelta, onToolCallStart: (name) => p.onToolEvent({ kind: 'start', name }) },
        p.signal,
      );
    } catch (err) {
      // A pause aborts the in-flight stream; the completed rounds of this run are
      // real work the model must remember, so they are still the return value.
      if (p.signal.aborted) break;
      // Other stream failures (rate limit, network): the caller decides what to do,
      // but it gets the completed rounds alongside the error.
      (err as { partialHistory?: AgentMessage[] }).partialHistory = history;
      throw err;
    }
    history.push({ role: 'assistant', content: turnResult.text, toolCalls: turnResult.toolCalls, raw: turnResult.raw });
    p.onAssistantDone?.(turnResult.text);
    if (p.signal.aborted) break;
    if (turnResult.toolCalls.length === 0) {
      if (turnResult.text.trim() === '' && emptyNudges < 2) {
        emptyNudges++;
        history.push({
          role: 'user',
          content: '(system) Your last reply was empty — no text and no tool calls. If the task is complete, reply with a brief summary for the user; otherwise continue with the next step now.',
        });
        continue;
      }
      // The model is signing off — if it committed to a plan that is not
      // finished, send it back to work (bounded: a stuck model still ends).
      const leftover = unfinishedNudges < 2 ? p.unfinishedWork?.() : null;
      if (leftover) {
        unfinishedNudges++;
        history.push({ role: 'user', content: leftover });
        continue;
      }
      break;
    }
    emptyNudges = 0;

    const results: ToolResult[] = [];
    for (const call of turnResult.toolCalls) {
      const r = await p.execTool(call);
      let content = r.content;
      const reverted = content.startsWith('REVERTED');
      if (r.isError) {
        // Verbatim-retry damper: the same call with the same input failing again
        // will fail forever — say so explicitly, with a way out.
        const sig = callSignature(call.name, call.input);
        const n = (failCounts.get(sig) ?? 0) + 1;
        failCounts.set(sig, n);
        if (n >= 2) {
          content += `\n(system) This exact ${call.name} call has now failed ${n} times with identical input — repeating it unchanged will fail again. Change the inputs or the approach: use find_flat_areas / find_bridge_sites / find_ramp_sites for validated anchors, inspect_region to re-read the area, load_skill for a proven recipe, or ask the user.`;
        }
        // Rollback damper: repeated post-stroke reverts on one tool mean the
        // strategy (not the coordinates) is wrong.
        if (reverted) {
          const m = (revertCounts.get(call.name) ?? 0) + 1;
          revertCounts.set(call.name, m);
          if (m >= 2) {
            content += `\n(system) ${call.name} has been rolled back ${m} times this run. Change strategy: satisfy the POST-CHECK rule inside ONE call (build support/containment first, then the feature), or use a higher-level tool that is legal by construction (sculpt_terrace, carve_river, run_generator).`;
          }
        }
      }
      results.push(content === r.content ? r : { ...r, content });
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      const first = lines[0] ?? '';
      const summary = (first === 'REVERTED:' && lines[1] ? `REVERTED: ${lines[1]}` : first).slice(0, 120);
      p.onToolEvent({
        kind: 'result',
        name: call.name,
        status: r.isError ? (summary.startsWith('REVERTED') ? 'reverted' : 'error') : 'ok',
        summary,
      });
    }
    // Budget governor: tell the model the cap is near while it can still adapt,
    // appended to the last tool result (no extra message, provider-safe).
    const remaining = maxTurns - (turn + 1);
    if (remaining === BUDGET_WARN_AT && results.length > 0) {
      const last = results[results.length - 1]!;
      results[results.length - 1] = {
        ...last,
        content: `${last.content}\n(system) Turn budget: ${remaining} assistant turns remain in this run — finish the essential edits, then wrap up with a short summary.`,
      };
    }
    history.push({ role: 'tool', results });

    // suggest_reply is a SIGN-OFF companion: a round consisting only of it
    // needs no further assistant message — the turn ends right here. (Without
    // this, attaching it to a final summary forced one more round trip, so
    // models simply never attached it.)
    if (turnResult.toolCalls.length > 0 && turnResult.toolCalls.every((c) => c.name === 'suggest_reply')) break;

    if (turn === maxTurns - 1) {
      history.push({ role: 'user', content: '(system) Iteration limit reached — summarize progress and stop.' });
    }
  }
  return history;
}
