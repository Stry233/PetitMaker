/**
 * The resumable turn loop. Durable state comes from the event log; only the currently streaming
 * turn has transient state. Gates, pending calls, counters, checkpoints and plans survive reloads.
 */
import type { Adapter, AdapterRequest } from './adapter';
import { compact, needsCompaction, COMPACTION_RESERVE } from './compaction';
import type { Oversight } from './gates';
import { consecutiveLengthStops, hasLandedWrite, hasRecentVerification, landedWriteCount, planProgress, MAX_TURNS_DEFAULT, REVIEW_MIN_TURNS_LEFT, REVIEW_MIN_WRITES } from './governor';
import {
  budgetWarning, capMessage, contextOverflow, deliveryNudge, emptyTurnNudge, lengthStopNudge, lengthStreakOverflow,
  reasoningOnlyNudge, reviewNudge, unfinishedPlanNudge, NUDGE_RETRIES,
} from './nudges';
import { append, eventsOf, type SessionLog } from './log';
import { deriveMessages } from './project-messages';
import { PROTOCOL } from './protocol';
import { deliverScreenedSteers, deliverSteers } from './steering';
import { estimateTokens, type JobOutcome, type Part, type SessionEvent, type ToolResultDetail } from './types';
import { writesMap, type ToolFacts } from './tool-facts';
import { endJob, isToolPart, parkIfPausePending, processCalls, realSleep, resumeLeftoverCalls, syncStageCheckpoints } from './calls';
import { countAssistantTurns, deriveBadCallIds, jobEvents, pacingWaitMs, silentTurnState } from './job-reads';
import { runAdapterTurn } from './turn';

export interface ExecutedResult { content: string; isError: boolean; image?: string; detail?: ToolResultDetail }
export interface ToolExecutor {
  /** The loop converts thrown errors into redacted tool results. */
  execute(call: { callId: string; name: string; args: Record<string, unknown> }): Promise<ExecutedResult>;
  /** What each tool may do to the map and whether a call reviews it. */
  facts: ToolFacts;
  describe(call: { name: string; args: Record<string, unknown> }): string; // the gate's human sentence
}
export interface LoopDeps {
  adapter: Adapter; model: string; system: string;
  capabilities?: AdapterRequest['capabilities'];
  thinking?: AdapterRequest['thinking'];
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  executor: ToolExecutor;
  oversight: Oversight;
  sameModel: boolean;
  estimate?: (s: string) => number;
  maxTurns?: number;
  signal: AbortSignal;
  undoStackSize: () => number;
  /** Local content check of the user's text: the order before the first turn, then each queued note
   *  and typed gate answer before a model reads it. A returned line refuses the text; null allows it,
   *  including when the check is unavailable. */
  screen?: (text: string) => Promise<string | null>;
  onLive?: (parts: readonly Part[] | null) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>; // injected for fake-timer tests
  /** The model's context window in tokens (`ModelCapabilities.context`); DEFAULT_CONTEXT_TOKENS when unknown. */
  contextWindow?: number;
}

/** Closing emphasis and quotation marks do not change a question's ending. */
const QUESTION_END = /[?\uFF1F][\s*_~`"'”’\u300D\u300F\uFF09)\]]*$/;

/**
 * Puts the user's mid-job words through `deps.screen` before the next turn reads them. Queued notes
 * are delivered or refused; a refused typed gate answer is recorded as refused, which every
 * projection reads as a skip. `checked` holds the gate answers this run has already cleared.
 */
async function screenNotes(log: SessionLog, deps: LoopDeps, checked: Set<string>): Promise<void> {
  const screen = deps.screen;
  if (!screen) { deliverSteers(log); return; }
  await deliverScreenedSteers(log, screen, deps.signal);
  for (const e of jobEvents(log)) {
    if (deps.signal.aborted) return;
    if (e.kind !== 'gateAnswered' || e.answer !== 'words' || e.words === undefined || checked.has(e.gateId)) continue;
    checked.add(e.gateId);
    if (jobEvents(log).some((r) => r.kind === 'noteRefused' && r.gateId === e.gateId)) continue;
    const reply = await screen(e.words);
    if (reply !== null && !deps.signal.aborted) append(log, { kind: 'noteRefused', gateId: e.gateId, reply });
  }
}

/** The context window a job assumes when its model reports none. */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

export async function runJob(log: SessionLog, deps: LoopDeps): Promise<JobOutcome | 'paused'> {
  const maxTurns = deps.maxTurns ?? MAX_TURNS_DEFAULT;
  const contextWindow = deps.contextWindow ?? DEFAULT_CONTEXT_TOKENS;
  const estimate = deps.estimate ?? estimateTokens;
  const budgetTokens = contextWindow - COMPACTION_RESERVE;
  const sleep = deps.sleep ?? realSleep;
  const toolNames = new Set(deps.tools.map((t) => t.name));
  // Delivery and review nudges apply only when the advertised tool set can write.
  const canWrite = deps.tools.some((t) => writesMap(deps.executor.facts, t.name));

  const abort = (): 'aborted' => { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; };
  const resumed = await resumeLeftoverCalls(log, deps, toolNames);
  if (resumed) return resumed;
  const checkedAnswers = new Set<string>();

  if (deps.screen && countAssistantTurns(log) === 0) {
    const order = [...eventsOf(log)].reverse().find((e): e is Extract<SessionEvent, { kind: 'order' }> => e.kind === 'order');
    const refusal = order ? await deps.screen(order.text) : null;
    if (deps.signal.aborted) return abort();
    if (refusal) {
      append(log, { kind: 'assistant', parts: [{ kind: 'text', text: refusal, done: true }], stop: 'stop' });
      endJob(log, deps, { outcome: 'done' });
      return 'done';
    }
  }

  for (;;) {
    if (deps.signal.aborted) return abort();
    if (parkIfPausePending(log)) return 'paused';
    await screenNotes(log, deps, checkedAnswers);
    if (deps.signal.aborted) return abort();
    syncStageCheckpoints(log, deps);

    if (needsCompaction(log, { contextWindow, estimate })) {
      const ok = await compact(log, { adapter: deps.adapter, model: deps.model, budgetTokens, signal: deps.signal, estimate });
      if (deps.signal.aborted) return abort();
      if (!ok && needsCompaction(log, { contextWindow, estimate })) {
        append(log, { kind: 'incident', error: { cls: 'overflow', detail: contextOverflow() } });
        endJob(log, deps, { outcome: 'incident' });
        return 'incident';
      }
    }

    const turnsUsed = countAssistantTurns(log);
    if (turnsUsed >= maxTurns) { endJob(log, deps, { outcome: 'capped' }); return 'capped'; }

    const silent = silentTurnState(log);
    if (silent.n > NUDGE_RETRIES) { endJob(log, deps, { outcome: 'done' }); return 'done'; }

    // Length-stopped turns leave the replay window; a nudge carries the failure into the next try.
    const lengthStreak = consecutiveLengthStops(log);
    if (lengthStreak > NUDGE_RETRIES) {
      append(log, { kind: 'incident', error: { cls: 'overflow', detail: lengthStreakOverflow() } });
      endJob(log, deps, { outcome: 'incident' });
      return 'incident';
    }

    const isFinalTurn = turnsUsed === maxTurns - 1;
    const appendSystemNote = isFinalTurn
      ? capMessage()
      : lengthStopNudge(lengthStreak) ?? budgetWarning(turnsUsed, maxTurns)
        ?? (silent.reasoningOnly ? reasoningOnlyNudge(silent.n) : emptyTurnNudge(silent.n));

    const buildRequest = (): AdapterRequest => ({
      system: deps.system,
      messages: deriveMessages(log, { budgetTokens, estimate, appendSystemNote }),
      tools: deps.tools, model: deps.model, sameModel: deps.sameModel,
      capabilities: deps.capabilities, thinking: deps.thinking,
    });

    // Apply the provider pacing floor learned from rate-limit responses; the job signal can skip it.
    const wait = pacingWaitMs(log);
    if (wait > 0) {
      try {
        await sleep(wait, deps.signal);
      } catch {
        return abort();
      }
    }

    const turnOutcome = await runAdapterTurn(log, deps, buildRequest, { budgetTokens, estimate, sleep });
    if (turnOutcome === 'incident') { endJob(log, deps, { outcome: 'incident' }); return 'incident'; }
    if (turnOutcome === 'aborted') return abort();

    // Preserve all terminal text, but mark a question only when the model chose the ending.
    // Provider truncation and aborts may leave question-mark fragments that must not await input.
    const finalText = turnOutcome.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('').trim();
    const question = turnOutcome.stop !== 'length' && QUESTION_END.test(finalText);
    const settle = (outcome: 'done' | 'capped' | 'aborted'): void => {
      endJob(log, deps, {
        outcome,
        ...(finalText ? { summary: finalText } : {}),
        ...(question && outcome !== 'aborted' ? { question: true as const } : {}),
      });
    };

    // Before settling a write-capable job, request delivery when nothing landed and review when a
    // substantial build landed with enough turns remaining. Each nudge fires once and is recorded
    // as a systemNote for replay. Delivery and review may occur on separate closes of the same job.
    const nudgeDelivery = (): boolean => {
      if (hasLandedWrite(log)) return false;
      if (jobEvents(log).some((e) => e.kind === 'systemNote' && e.note === 'delivery')) return false;
      append(log, { kind: 'systemNote', note: 'delivery', text: deliveryNudge() });
      return true;
    };
    const nudgeReview = (): boolean => {
      if (landedWriteCount(log) < REVIEW_MIN_WRITES) return false;
      if (hasRecentVerification(log, deps.executor.facts)) return false;
      if (maxTurns - countAssistantTurns(log) < REVIEW_MIN_TURNS_LEFT) return false;
      if (jobEvents(log).some((e) => e.kind === 'systemNote' && e.note === 'review')) return false;
      append(log, { kind: 'systemNote', note: 'review', text: reviewNudge(deps.executor.facts.guides) });
      return true;
    };
    // An unfinished filed plan receives one close nudge to continue or identify the blocked stage.
    const nudgePlanClose = (): boolean => {
      const text = unfinishedPlanNudge(deps.executor.facts.guides, planProgress(log));
      if (text === undefined) return false;
      if (jobEvents(log).some((e) => e.kind === 'systemNote' && e.note === 'plan-close')) return false;
      append(log, { kind: 'systemNote', note: 'plan-close', text });
      return true;
    };
    // A closing question settles directly unless a substantial landed build still needs review.
    const answerClose = (): boolean => {
      if (!canWrite) return false;
      if (question) return landedWriteCount(log) >= REVIEW_MIN_WRITES && nudgeReview();
      return nudgeDelivery() || nudgePlanClose() || nudgeReview();
    };

    if (turnOutcome.stop === 'aborted') { settle('aborted'); return 'aborted'; }
    if (isFinalTurn) { settle('capped'); return 'capped'; }

    const toolParts = turnOutcome.parts.filter(isToolPart);
    if (toolParts.length === 0) {
      if (finalText.length > 0) {
        if (answerClose()) continue;
        settle('done');
        return 'done';
      }
      continue; // a silent turn: the next iteration nudges, or settles past NUDGE_RETRIES
    }

    const callOutcome = await processCalls(log, deps, toolParts, { badCallIds: deriveBadCallIds(turnOutcome), assistantSeq: turnOutcome.seq, toolNames });
    if (callOutcome === 'paused') return 'paused';
    if (callOutcome === 'aborted') return abort();
    // A text response followed only by reply suggestions is already a complete closing turn.
    if (finalText.length > 0 && toolParts.every((p) => p.name === PROTOCOL.reply && toolNames.has(p.name))) {
      if (answerClose()) continue;
      settle('done');
      return 'done';
    }
  }
}
