/**
 * The runner: live app state assembled into `LoopDeps` per job, and the ONE place `send`/`stop`/
 * `pause`/`resume` reach the log. `makeToolDeps()` is called fresh at every job start (never
 * cached across jobs), which is what keeps a stale `GridState` captured at mount time from ever
 * reaching a later job, which is what the per-job `LoopDeps` shape exists to make impossible.
 *
 * ONE JOB AT A TIME, JOIN NOT ERROR: `composerRoute` already turns a `send` mid-job into a steer
 * once the phase reflects it (an `order`/`resumed` append flips the phase before the caller could
 * possibly re-enter), but the phase read and the append are two separate steps, so this file keeps
 * its own `inflight` promise as a second, unconditional guard — a `send`/`resume` that would
 * otherwise start a second `runJob` over the same leftover calls queues a steer instead. `active()`
 * reads that promise, not a boolean, so it can never desync from whether a job is really running.
 */
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { append } from '../core/log';
import { classify } from '../core/errors';
import { pendingGate, type Oversight } from '../core/gates';
import { isJobActive, runJob, type LoopDeps } from '../core/loop';
import { rawIsAllFrom } from '../core/project-messages';
import { deriveView } from '../core/project-view';
import { createSkippableSleeper } from '../core/skippable-sleep';
import type { JobOutcome } from '../core/types';
import { queueSteer } from '../core/steering';
import { baseUrlFor, QUIRKS, type ProviderId } from '../providers/defaults';
import { createAnthropicAdapter } from '../providers/anthropic';
import { createOpenAIAdapter } from '../providers/openai';
import type { Adapter } from '../providers/types';
import { redactSecrets } from '../security/redact';
import { composerRoute, submitComposer } from '../session/composer-routing';
import { useAgentSession } from '../session/store';
import { buildSystemPrompt } from '../system-prompt';
import { buildMapContext, type AgentToolDeps } from '../tools/tools';
import { regionBounds } from '../tools/tools-common';
import { createExecutor, wireSchemas, type DelegateOpts } from './executor';

/** Same default `runJob` itself falls back to when `contextWindow` is omitted; kept explicit here
 *  since `budgetTokens` (unlike `contextWindow`) has no built-in fallback. */
const DEFAULT_BUDGET_TOKENS = 128_000;

export interface RunnerConfig {
  providerId: ProviderId; apiKey: string; model: string; customBaseUrl?: string;
  /** Which host a region-split platform's key was issued against (Moonshot/Qwen/Zhipu); 0 = global
   *  (the default), 1 = the CN host. Ignored by every other provider. */
  region?: 0 | 1;
  oversight: Oversight;
  /** The editor's display language, as the system prompt's `{uiLanguage}` fallback: the language to
   *  open in when the user has not typed anything readable yet (a first message, bare coordinates).
   *  Absent reads as English, which is the prompt's own default. Read per job, like everything else
   *  here, so changing the editor's language reaches the next one. */
  uiLocale?: string;
  makeToolDeps: () => AgentToolDeps;
  registry: RuleDispatcher;
  /** Test-only escape hatch: skips real adapter construction (and its SDK) entirely. */
  adapterForTest?: Adapter;
}

/**
 * A CONNECTION THAT CANNOT BE BUILT, as an adapter that says so once.
 *
 * `createOpenAIAdapter` refuses outright for a provider whose host is the user's own with no address
 * filed, and that refusal must not throw into whichever surface pressed send: the order is already
 * on the log, so the job would stand with no end and no word. Delivered as the turn's one error
 * event instead, the loop settles it exactly as it settles a refusal from a real endpoint, and the
 * panel's `config` face carries the repair (the endpoint field).
 */
function refusingAdapter(message: string): Adapter {
  const error = classify({ message });
  return {
    // eslint-disable-next-line require-yield
    async *stream() { yield { t: 'error' as const, error }; },
    listModels() { return Promise.reject(new Error(message)); },
  };
}

/** The connection half of `RunnerConfig`: all an adapter is built from. */
export type AdapterConfig = Pick<RunnerConfig, 'providerId' | 'apiKey' | 'customBaseUrl' | 'region' | 'adapterForTest'>;

/** Exported for the one-shot capability checks (the panel's vision probe): a probe must reach the
 *  endpoint exactly as a job would, or its verdict is about a different connection. */
export function buildAdapter(cfg: AdapterConfig): Adapter {
  if (cfg.adapterForTest) return cfg.adapterForTest;
  if (cfg.providerId === 'claude') return createAnthropicAdapter({ apiKey: cfg.apiKey });
  try {
    return createOpenAIAdapter({
      apiKey: cfg.apiKey,
      baseUrl: baseUrlFor(cfg.providerId, { customBaseUrl: cfg.customBaseUrl, region: cfg.region }),
      quirks: QUIRKS[cfg.providerId],
    });
  } catch (err) {
    return refusingAdapter(redactSecrets(err instanceof Error ? err.message : String(err)));
  }
}

/**
 * THE CONNECTION A RUNNING JOB IS BOUND TO, as the launch froze it.
 *
 * A JOB IS ONE CONTRACT. `launch()` builds the adapter and copies the model out of the config, so
 * every turn of a job reaches the same host with the same model however the settings move under it —
 * a mid-thought swap would change the author mid-sentence, and on the Anthropic dialect it would
 * feed one model's signed thinking blocks to another. This is that frozen answer, published so a
 * settings surface can say which of its rows the job in flight is actually using.
 */
export interface LiveConnection {
  providerId: ProviderId;
  model: string;
  customBaseUrl?: string;
  region?: 0 | 1;
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
  // One sleeper per runner (not per job): a retryNow() call is a user gesture with no view of job
  // boundaries, and the sleeper only ever resolves a sleep genuinely pending when skip() runs, so
  // sharing it across a runner's whole life is exactly as safe as building a fresh one per launch.
  const sleeper = createSkippableSleeper();

  function launch(toolDeps: AgentToolDeps): void {
    const { log } = useAgentSession.getState();
    const controller = new AbortController();
    abortController = controller;
    // A job owns the log it launched with. Replacing that log aborts the job before it can edit the
    // map behind a fresh session; completion stays on the old log and new-log steers wait there.
    const unwatchLog = useAgentSession.subscribe((state) => {
      if (state.log !== log) controller.abort();
    });
    const adapter = buildAdapter(cfg);
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
      system,
      get oversight() { return cfg.oversight; },
      signal: controller.signal,
      log,
      onChildProgress: (p) => {
        const session = useAgentSession.getState();
        if (session.log === log) session.setChildLive(p);
      },
    };
    const executor = createExecutor(toolDeps, { delegate: delegateOpts });
    const loopDeps: LoopDeps = {
      adapter,
      model: cfg.model,
      system,
      tools: wireSchemas(),
      executor,
      // OVERSIGHT IS A LIVE READING, not a launch-time copy. `resolveGate` asks `deps.oversight` at
      // every tool call and the manage card is reachable mid-run, so the tier a call is judged
      // against is the one standing when that call arrives: a tightening reaches the next write and
      // a loosening stops asking. `panel-runner.ts` mutates this config in place, which is what
      // makes reading through it the live answer.
      get oversight() { return cfg.oversight; },
      // ONE RUNNER OUTLIVES THE ARMED MODEL: `ui/agent/panel-runner.ts` mutates this config in
      // place (a rebuilt runner is an in-flight job nobody can stop), so job A can run Claude
      // model A and job B model B over the SAME log — and A's raw thinking blocks, signatures
      // and all, are still sitting in it. So the answer is read from the log per launch rather
      // than assumed for the runner's life.
      sameModel: rawIsAllFrom(log, cfg.model),
      budgetTokens: DEFAULT_BUDGET_TOKENS,
      signal: controller.signal,
      undoStackSize: () => toolDeps.getExecutor().getUndoStackSize(),
      sleep: sleeper.sleep,
      // The turn as it arrives. Everything the panel shows WHILE a turn is in flight comes through
      // here: the loop appends nothing until the turn closes, so without this the phase never
      // leaves `thinking`, the assistant's sentence appears only once it is finished, and a tool
      // call shows no row until its result lands. The loop nulls it at every exit of its own.
      onLive: (parts) => {
        const session = useAgentSession.getState();
        if (session.log === log) session.setLive(parts);
      },
    };
    inflight = runJob(log, loopDeps)
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
        const session = useAgentSession.getState();
        if (session.log === log) { session.setLive(null); session.setChildLive(null); }
      });
  }

  /**
   * Settles a job THIS RUNNER DOES NOT HOLD as the run the user stopped.
   *
   * Two shapes reach it and both are the same fact — there is no loop, so nothing will ever end this
   * job by itself. One is a job the loop parked (`paused`); the other is an order the log carries with
   * no end at all, which is what a reload mid-run or a session adopted from storage leaves behind. A
   * guard on the `paused` phase alone left that second one unstoppable: every surface drew it as
   * running, and the stop it offered reached a loop that was not there.
   *
   * `stop()`, `setAside()` and a key going away are the same act arriving from three places, so they
   * settle it the one way.
   */
  function settleUnheld(): void {
    const { log } = useAgentSession.getState();
    if (!isJobActive(log)) return;
    append(log, {
      kind: 'jobEnd', outcome: 'aborted',
      undoIndex: cfg.makeToolDeps().getExecutor().getUndoStackSize(),
    });
  }

  /**
   * HOLDS a job this runner does not hold, which is the honest answer to a pause pressed over one.
   *
   * The live path REQUESTS a pause and the loop grants it at its next boundary; with no loop there is
   * no next boundary, so the request would stand for the rest of the session under a dock reading
   * "Pausing". The hold is written directly instead — and it is a hold rather than an end, because a
   * parked job is resumable and `resumeLeftoverCalls` is what picks its unfinished calls back up.
   */
  function parkUnheld(): void {
    const { log } = useAgentSession.getState();
    if (!isJobActive(log)) return;
    const phase = deriveView(log).phase;
    // A GATE IS NOT A HOLD TO TAKE. Its own card is the way out of it, and a `paused` written under
    // one would withhold that card and leave the answer with nowhere to land.
    if (phase === 'paused' || phase === 'gated') return;
    append(log, { kind: 'paused' });
  }

  return {
    send(text: string): void {
      const trimmed = text.trim();
      if (trimmed === '') return;
      const { log } = useAgentSession.getState();
      const phase = deriveView(log).phase;
      const route = composerRoute(phase);

      if (inflight && (route === 'order' || route === 'resume-note')) {
        queueSteer(log, trimmed); // reentry: a live job already owns this log
        return;
      }

      if (route === 'order') {
        const toolDeps = cfg.makeToolDeps();
        const mapContext = buildMapContext(toolDeps.getState(), toolDeps.getRegion(), toolDeps);
        const region = regionBounds(toolDeps.getRegion());
        // WHICH MAP THIS ORDER IS FILED AGAINST, stamped here for the same reason the region is:
        // this is the moment the fact is true, and the record must not track the store's later
        // state. The panel's rollback guard reads it back off the record.
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
      // A JOB WITH NO LOOP HAS NOTHING TO ABORT, and an abort that reaches nothing leaves it
      // standing. That is how a key revoked during a hold orphaned one: `settings.ts:forgetKey` calls
      // this so the record survives the disconnection, `inflight` was undefined, and the job kept its
      // phase with its partial edits on the map and no end on the log at all.
      if (!inflight) { settleUnheld(); return; }
      abortController?.abort();
    },
    pause(): void {
      // NO LOOP MEANS NO BOUNDARY TO WAIT FOR, so the hold is taken here rather than asked for.
      if (!inflight) { parkUnheld(); return; }
      const { log } = useAgentSession.getState();
      // AND NEVER OVER A STANDING GATE. Every surface withholds Pause while one is open, but
      // `askGate` appends from a promise continuation rather than a React event handler, so the
      // subscription schedules instead of committing: for one frame the DOM still shows a Pause over
      // a log that is already gated, and a press already travelling lands here. The phase would go
      // `pausing`, the projection would withhold the gate, and `awaitGate` would be left parked with
      // no question on screen. The invariant belongs at the APPEND site, where a frame cannot beat it.
      if (pendingGate(log)) return;
      if (isJobActive(log)) append(log, { kind: 'pauseRequested' });
    },
    resume(): void {
      if (inflight) return;
      const { log } = useAgentSession.getState();
      if (deriveView(log).phase !== 'paused') return;
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
