/**
 * The runner: live app state assembled into `LoopDeps` per job, and the one place `send`, `stop`,
 * `pause` and `resume` reach the log. `makeToolDeps()` is called fresh at every job start, so a
 * `GridState` captured at mount time never reaches a later job.
 *
 * One job runs at a time. `composerRoute` turns a mid-job `send` into a steer once the phase shows
 * the job, and the `inflight` promise guards the gap between reading the phase and appending: a
 * `send` or `resume` that would start a second `runJob` queues a steer instead. `active()` reads
 * that promise, so it always matches whether a job is running.
 */
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { append, type SessionLog } from '../core/log';
import type { Adapter } from '../core/adapter';
import { pendingGate, type Oversight } from '../core/gates';
import { runJob, type LoopDeps } from '../core/loop';
import { isJobActive } from '../core/job-reads';
import { rawIsAllFrom } from '../core/project-messages';
import { derivePhase, deriveView } from '../core/project-view';
import { createSkippableSleeper } from '../core/skippable-sleep';
import { requestReplySuggestion } from '../core/reply-suggestion';
import type { JobOutcome } from '../core/types';
import { queueSteer } from '../core/steering';
import { buildAdapter } from '../providers/connect';
import type { ProviderId, ProviderRegion } from '../providers/defaults';
import { modelCapabilities } from '../providers/model-catalog';
import { lightestEffort, thinkingChoices, thinkingChoiceKey } from '../providers/reasoning';
import { redactSecrets } from '../../platform/remote/redact';
import { composerRoute, submitComposer } from '../session/composer-routing';
import { buildSystemPrompt } from '../prompts';
import { buildMapContext, wireSchemas, type AgentToolDeps } from '../tools';
import { regionBounds } from '../../core/grid/rect';
import { createExecutor, type DelegateOpts } from './executor';
import { screenText } from './screen';
import type { SessionPort } from './session-port';

export interface RunnerConfig {
  providerId: ProviderId; apiKey: string; model: string; customBaseUrl?: string;
  /** Ignored by every provider that is not region-split. */
  region?: ProviderRegion;
  oversight: Oversight;
  effort?: string;
  /** The editor's display language, as the system prompt's `{uiLanguage}` fallback: the language to
   *  open in when the user has not typed anything readable yet (a first message, bare coordinates).
   *  Absent reads as English, which is the prompt's own default. Read per job, like everything else
   *  here, so changing the editor's language reaches the next one. */
  uiLocale?: string;
  makeToolDeps: () => AgentToolDeps;
  registry: RuleDispatcher;
  /** The session the runner reads its log from and publishes live parts to. */
  session: SessionPort;
}

/**
 * The connection a running job is bound to, as its launch froze it. Every turn of a job reaches the
 * same host and model whatever the settings do meanwhile, since the Anthropic dialect must not feed
 * one model's signed thinking to another. Settings read this to mark the row the job is using.
 */
export interface LiveConnection {
  providerId: ProviderId;
  model: string;
  customBaseUrl?: string;
  region?: ProviderRegion;
}

/**
 * When the latest job ended on a question with no suggestion of its own, asks the model for a reply
 * the user may send, and files it while that job is still the latest settled one on the session's
 * log. Returns the request's cancel.
 */
function suggestReply(
  session: SessionPort,
  log: SessionLog,
  adapter: Adapter,
  connection: Parameters<typeof requestReplySuggestion>[1],
): () => void {
  const view = deriveView(log);
  const job = view.jobs[view.jobs.length - 1];
  const current = () => {
    if (!job || session.log() !== log || session.isFiled(job.orderSeq) || isJobActive(log)) return false;
    const jobs = deriveView(log).jobs;
    return jobs[jobs.length - 1]?.orderSeq === job.orderSeq;
  };
  if (!job?.question || !job.summary || view.suggestion || !current()) return () => {};
  const controller = new AbortController();
  const unwatch = session.watch(() => { if (!current()) controller.abort(); });
  void requestReplySuggestion(adapter, connection, { request: job.orderText, question: job.summary }, controller.signal)
    .then((result) => {
      if (result && !controller.signal.aborted && current()) {
        append(log, { kind: 'replySuggested', orderSeq: job.orderSeq, ...result });
      }
    }).finally(unwatch);
  return () => { controller.abort(); unwatch(); };
}

export function createRunner(cfg: RunnerConfig): {
  send(text: string): void;
  stop(): void;
  pause(): void;
  /** Continues a paused job with no note (the panel's Resume button, as opposed to `send` with
   *  typed text, which carries the note as a queued steer). */
  resume(): void;
  /** Settles and files a held job as aborted. A live job remains the responsibility of `stop()`. */
  setAside(): void;
  active(): boolean;
  /** Ends a standing retry backoff early (the dock's countdown press); a no-op when none is
   *  pending. Never touches `withIdleTimeout`'s stream-idle bound or the summary idle bound: this
   *  is the retry ladder's own wait, and skipping it changes timing and nothing else. */
  retryNow(): void;
  /** The connection the job in flight is bound to, or undefined where none is running. */
  connection(): LiveConnection | undefined;
} {
  let inflight: Promise<JobOutcome | 'paused'> | undefined;
  let abortController: AbortController | undefined;
  // Set beside `inflight` and cleared with it, so the two can never disagree about whether there is
  // a job whose connection this describes.
  let launched: LiveConnection | undefined;
  // One sleeper per runner: a retryNow() press has no view of job boundaries, and skip() resolves
  // only a sleep pending at that moment.
  const sleeper = createSkippableSleeper();
  let cancelReply = () => {};
  const { session } = cfg;

  function launch(toolDeps: AgentToolDeps): void {
    cancelReply();
    const log = session.log();
    const controller = new AbortController();
    abortController = controller;
    // A job owns the log it launched with. Replacing that log aborts the job before it can edit the
    // map behind a fresh session; completion stays on the old log and new-log steers wait there.
    const unwatchLog = session.watch(() => {
      if (session.log() !== log) controller.abort();
    });
    const adapter = buildAdapter(cfg);
    const capabilities = modelCapabilities(cfg.providerId, cfg.model, cfg.customBaseUrl);
    const thinking = thinkingChoices(capabilities, cfg.providerId).find((choice) => thinkingChoiceKey(choice) === cfg.effort);
    const replyEffort = lightestEffort(capabilities);
    const replyConnection = { model: cfg.model, capabilities, thinking: replyEffort ? { effort: replyEffort } : undefined };
    launched = {
      providerId: cfg.providerId,
      model: cfg.model,
      ...(cfg.customBaseUrl !== undefined ? { customBaseUrl: cfg.customBaseUrl } : {}),
      ...(cfg.region !== undefined ? { region: cfg.region } : {}),
    };
    const system = buildSystemPrompt(cfg.registry, cfg.uiLocale !== undefined ? { uiLocale: cfg.uiLocale } : undefined);
    const delegateOpts: DelegateOpts = {
      adapter, // same instance the parent turn itself runs on, never a second build
      model: cfg.model,
      capabilities, thinking,
      system,
      get oversight() { return cfg.oversight; },
      signal: controller.signal,
      log,
      onChildProgress: (p) => {
        if (session.log() === log) session.setChildLive(p);
      },
    };
    const executor = createExecutor(toolDeps, { delegate: delegateOpts });
    const loopDeps: LoopDeps = {
      adapter,
      model: cfg.model,
      capabilities, thinking,
      system,
      tools: wireSchemas(),
      executor,
      // Read at every tool call: `runner-host.ts` mutates this config in place, so a changed
      // oversight tier applies to the next write of the running job.
      get oversight() { return cfg.oversight; },
      // One runner serves successive models over the same log, so raw replay is decided per launch.
      sameModel: rawIsAllFrom(log, cfg.model),
      contextWindow: capabilities?.context,
      signal: controller.signal,
      undoStackSize: () => toolDeps.getExecutor().historyDepth(),
      // The user's words meet the export content check before any provider does.
      screen: (text) => screenText(text, cfg.uiLocale),
      sleep: sleeper.sleep,
      // The turn as it arrives. Everything the panel shows while a turn is in flight comes through
      // here: the loop appends nothing until the turn closes, so without this the phase never
      // leaves `thinking`, the assistant's sentence appears only once it is finished, and a tool
      // call shows no row until its result lands. The loop nulls it at every exit of its own.
      onLive: (parts) => {
        if (session.log() === log) session.setLive(parts);
      },
    };
    inflight = runJob(log, loopDeps)
      .then((outcome) => {
        if (outcome === 'done') cancelReply = suggestReply(session, log, adapter, replyConnection);
        return outcome;
      })
      .catch((err): JobOutcome => {
        // Convert an unexpected rejection into a terminal incident so the job always settles.
        const message = err instanceof Error ? err.message : String(err);
        append(log, { kind: 'incident', error: { cls: 'unknown', detail: redactSecrets(message) } });
        return 'incident';
      })
      .finally(() => {
        inflight = undefined;
        launched = undefined;
        if (abortController === controller) abortController = undefined;
        unwatchLog();
        // The loop clears the live parts on every path it takes itself; this covers the one it
        // does not, the stray throw caught above, which would otherwise leave a half-streamed turn
        // standing in the panel for the rest of the session.
        if (session.log() === log) { session.setLive(null); session.setChildLive(null); }
      });
  }

  /**
   * Settles a job no loop is running as aborted: a parked job, or an order with no end that a reload
   * or a restored session left behind. `stop()`, `setAside()` and a removed key all end here.
   */
  function settleUnheld(): void {
    const log = session.log();
    if (!isJobActive(log)) return;
    append(log, {
      kind: 'jobEnd', outcome: 'aborted',
      undoIndex: cfg.makeToolDeps().getExecutor().historyDepth(),
    });
  }

  /**
   * Pauses a job no loop is running by writing the hold directly, since no loop boundary will grant a
   * request. The job stays resumable through `resumeLeftoverCalls`.
   */
  function parkUnheld(): void {
    const log = session.log();
    if (!isJobActive(log)) return;
    const phase = derivePhase(log);
    // A pause under an open gate would withhold the gate card the answer needs.
    if (phase === 'paused' || phase === 'gated') return;
    append(log, { kind: 'paused' });
  }

  return {
    send(text: string): void {
      const trimmed = text.trim();
      if (trimmed === '') return;
      const log = session.log();
      const phase = derivePhase(log);
      const route = composerRoute(phase);

      if (inflight && (route === 'order' || route === 'resume-note')) {
        queueSteer(log, trimmed); // reentry: a live job already owns this log
        return;
      }

      if (route === 'order') {
        const toolDeps = cfg.makeToolDeps();
        const mapContext = buildMapContext(toolDeps.getState(), toolDeps.getRegion(), toolDeps);
        const region = regionBounds(toolDeps.getRegion());
        // The map the order is filed against, stamped at submission for the panel's rollback guard.
        const mapId = toolDeps.getState().template.id;
        const result = submitComposer(log, phase, trimmed, {
          mapContext, ...(region ? { region } : {}), ...(mapId ? { mapId } : {}),
        });
        if (result.startsJob) launch(toolDeps);
        return;
      }

      const result = submitComposer(log, phase, trimmed);
      if (result.route === 'resume-note') launch(cfg.makeToolDeps());
    },
    stop(): void {
      cancelReply();
      // A job no loop is running is settled directly, including one held when its key is removed.
      if (!inflight) { settleUnheld(); return; }
      abortController?.abort();
    },
    pause(): void {
      // With no loop, the hold is written here rather than requested.
      if (!inflight) { parkUnheld(); return; }
      const log = session.log();
      // Never over an open gate: a gate appended from a promise can precede the frame that hides
      // Pause, and a pause under it would leave `awaitGate` waiting with no question on screen.
      if (pendingGate(log)) return;
      if (isJobActive(log)) append(log, { kind: 'pauseRequested' });
    },
    resume(): void {
      if (inflight) return;
      const log = session.log();
      if (derivePhase(log) !== 'paused') return;
      append(log, { kind: 'resumed' });
      launch(cfg.makeToolDeps());
    },
    setAside(): void {
      if (inflight) return;
      settleUnheld();
    },
    active(): boolean {
      return inflight !== undefined;
    },
    retryNow(): void {
      sleeper.skip();
    },
    connection(): LiveConnection | undefined {
      return inflight === undefined ? undefined : launched;
    },
  };
}
