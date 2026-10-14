/**
 * Streams one model turn through the adapter: the request with its idle deadline, retries of
 * retryable faults with their logged delays, and the assembled turn appended to the log.
 */
import type { AdapterRequest } from './adapter';
import { createAssembler, type AssembledTurn } from './assembler';
import { compact } from './compaction';
import { isRetryable } from './errors';
import { append, type SessionLog } from './log';
import { retryDelayMs, MAX_TURN_ATTEMPTS } from './retry';
import { withIdleTimeout } from './stream-idle';
import { linkedController } from '../../platform/async/abort';
import { type AssistantEvent, retryAttemptsLogged } from './job-reads';
import type { LoopDeps } from './loop';

/** Streams one attempt with a child abort controller so an idle timeout does not abort the job. */
async function streamOnce(deps: LoopDeps, req: AdapterRequest): Promise<AssembledTurn> {
  const assembler = createAssembler();
  const turn = linkedController(deps.signal);
  try {
    const source = deps.adapter.stream(req, turn.signal);
    for await (const ev of withIdleTimeout(source, { onIdle: () => turn.abort(), signal: deps.signal })) {
      assembler.push(ev);
      deps.onLive?.(assembler.snapshot());
    }
  } finally {
    turn.dispose();
  }
  return assembler.finish();
}

/** Runs one logical turn, reusing its request across retries and rebuilding it after compaction. */
export async function runAdapterTurn(
  log: SessionLog, deps: LoopDeps, buildRequest: () => AdapterRequest,
  opts: { budgetTokens: number; estimate: (s: string) => number; sleep: (ms: number, signal: AbortSignal) => Promise<void> },
): Promise<AssistantEvent | 'incident' | 'aborted'> {
  let req = buildRequest();
  let attempt = retryAttemptsLogged(log);
  for (;;) {
    if (deps.signal.aborted) { deps.onLive?.(null); return 'aborted'; }
    const assembled = await streamOnce(deps, req);

    if (!assembled.error && !deps.signal.aborted) {
      const ev = append(log, {
        kind: 'assistant', parts: assembled.parts, stop: assembled.stop,
        ...(assembled.usage !== undefined ? { usage: assembled.usage } : {}),
        // Raw provider blocks are replayable only with the model that produced them.
        ...(assembled.raw !== undefined ? { raw: assembled.raw, rawModel: deps.model } : {}),
        // Record adapter normalization quirks beside the normalized parts.
        ...(assembled.quirks !== undefined ? { quirks: assembled.quirks } : {}),
      });
      deps.onLive?.(null);
      return ev as AssistantEvent;
    }

    const err = deps.signal.aborted ? { cls: 'abort' as const, detail: 'The turn was aborted.' } : assembled.error!;
    if (err.cls === 'abort') {
      const ev = append(log, {
        kind: 'assistant', parts: assembled.parts, stop: 'aborted',
        ...(assembled.usage !== undefined ? { usage: assembled.usage } : {}),
        ...(assembled.raw !== undefined ? { raw: assembled.raw, rawModel: deps.model } : {}),
      });
      deps.onLive?.(null);
      return ev as AssistantEvent;
    }

    if (err.cls === 'overflow') {
      const ok = await compact(log, {
        adapter: deps.adapter, model: deps.model, budgetTokens: opts.budgetTokens, signal: deps.signal, estimate: opts.estimate,
      });
      if (deps.signal.aborted) { deps.onLive?.(null); return 'aborted'; }
      if (!ok) {
        deps.onLive?.(null);
        append(log, { kind: 'incident', error: err });
        return 'incident';
      }
      req = buildRequest(); // replay on the (now hopefully smaller) derived window
      continue;
    }

    attempt++;
    if (!isRetryable(err.cls) || attempt >= MAX_TURN_ATTEMPTS) {
      deps.onLive?.(null);
      append(log, { kind: 'incident', error: err });
      return 'incident';
    }
    const delayMs = retryDelayMs(attempt, err);
    append(log, { kind: 'retry', attempt, cls: err.cls, delayMs });
    try {
      await opts.sleep(delayMs, deps.signal);
    } catch {
      deps.onLive?.(null);
      return 'aborted';
    }
  }
}
