/**
 * The played adapter: a model driven through files by whoever is judging. Each `stream` call
 * writes the request a real dialect would have sent as `<dir>/turn-<N>.request.json` and polls
 * for a hand- (or script-) written `<dir>/turn-<N>.response.json` to answer it, so an eval run can
 * be played back turn by turn without any provider on the other end.
 *
 * NODE-ONLY EXCEPTION: this is the one file under `src/` allowed `node:fs`/`node:path` — nothing
 * else under `src/` imports it (only offline eval scripts do), so it never reaches a browser
 * bundle. See the eval plan's Global Constraints.
 */
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';
import type { ErrorClass, FinalToolCall, StopReason, StreamEvent } from '../core/types';
import type { Adapter, AdapterRequest } from '../providers/types';

export interface PlayedResponse {
  text?: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  stop?: StopReason;
  /** Script a FAILED turn instead of an answer: converts to one `{t:'error'}` event, and `text`/
   *  `toolCalls` are ignored when this is set (an error answer IS the whole answer — there is no
   *  such thing as a turn that both fails and says something). Pick `cls` for what the fixture
   *  means to exercise: a RETRYABLE class (`rate-limit`/`overloaded`/`network`, `core/errors.ts:
   *  isRetryable`) walks the loop's retry ladder before the job can reach `incident`; anything
   *  else (`auth`/`quota`/`overflow`/`cors`/`abort`/`unknown`) reaches `incident` on this turn
   *  alone, which is what a fixture wanting a FAST, deterministic incident should use. */
  error?: { cls: ErrorClass; detail?: string };
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 250;

function requestPath(dir: string, n: number): string {
  return join(dir, `turn-${n}.request.json`);
}

function responsePath(dir: string, n: number): string {
  return join(dir, `turn-${n}.response.json`);
}

type WaitResult =
  | { status: 'ready'; response: PlayedResponse }
  | { status: 'timeout' }
  | { status: 'aborted' };

/** Players (humans and subagents) write a response file non-atomically, so a poll
 *  can catch it mid-write: absent entirely (ENOENT racing the writer's create), or present but
 *  holding half a JSON document. Both read as "not ready yet" rather than a failure — the read and
 *  the parse are folded into one attempt so neither kind of tear can surface past this function. */
function tryReadResponse(path: string): PlayedResponse | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as PlayedResponse;
  } catch {
    return undefined;
  }
}

/** Polls for `path` to hold a complete, parseable response, stopping on whichever of the three
 *  outcomes comes first. Both resolve paths (and the abort listener) clear the interval, so an
 *  aborted or timed-out wait never leaves a timer running past this call. */
function waitForFile(path: string, timeoutMs: number, pollMs: number, signal: AbortSignal): Promise<WaitResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let finished = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const finish = (result: WaitResult): void => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearInterval(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ status: 'aborted' });
    signal.addEventListener('abort', onAbort);

    const check = (): void => {
      const response = tryReadResponse(path);
      if (response !== undefined) finish({ status: 'ready', response });
      else if (signal.aborted) finish({ status: 'aborted' });
      else if (Date.now() - start >= timeoutMs) finish({ status: 'timeout' });
    };
    check();
    if (!finished) timer = setInterval(check, pollMs);
  });
}

/** The ONE conversion from a played turn's wire shape to what the assembler actually consumes,
 *  shared by the file-polling path here and by the bench's `--script` fixture replay
 *  (the project's dev-only bench harness), so the two ways of playing a turn exercise the assembler
 *  identically rather than drifting apart as two hand-copied event sequences. */
export function playedResponseToEvents(response: PlayedResponse, turnIndex: number): StreamEvent[] {
  if (response.error) {
    return [{ t: 'error', error: { cls: response.error.cls, detail: response.error.detail ?? 'played response scripted a failure' } }];
  }

  const events: StreamEvent[] = [{ t: 'text', delta: response.text ?? '' }];
  const calls = response.toolCalls ?? [];
  const finals: FinalToolCall[] = [];
  for (const [i, call] of calls.entries()) {
    const callId = `p${turnIndex}-${i}`;
    const rawArgs = JSON.stringify(call.args);
    events.push({ t: 'tool-start', callId, name: call.name });
    events.push({ t: 'tool-args', callId, delta: rawArgs });
    finals.push({ callId, name: call.name, args: call.args, rawArgs });
  }
  const stop: StopReason = response.stop ?? (calls.length > 0 ? 'tool-calls' : 'stop');
  events.push({ t: 'done', stop, final: finals });
  return events;
}

export function createPlayedAdapter(dir: string, opts?: { timeoutMs?: number; pollMs?: number }): Adapter {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  let turn = 0;

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      turn += 1;
      const n = turn;
      const request = { system: req.system, messages: req.messages, tools: req.tools, model: req.model };
      writeFileSync(requestPath(dir, n), JSON.stringify(request, null, 2));

      const path = responsePath(dir, n);
      const result = await waitForFile(path, timeoutMs, pollMs, signal);
      if (result.status === 'aborted') {
        yield { t: 'done', stop: 'aborted' };
        return;
      }
      if (result.status === 'timeout') {
        yield { t: 'error', error: { cls: 'network', detail: 'played model did not answer' } };
        return;
      }

      for (const ev of playedResponseToEvents(result.response, n)) yield ev;
    },

    async listModels(): Promise<string[]> {
      return ['played-model'];
    },
  };
}
