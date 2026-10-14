import type { SessionLog } from './log';
import { eventsOf } from './log';
import { PROTOCOL } from './protocol';
import { sanitizeSuggestion } from './reply-suggestion';
import { undeliveredSteers } from './steering';
import { retainedWrite } from './tool-result';
import { DROPPED_STOPS, parseStages, stageProgress } from './types';
import type { Part } from './types';
import { GATE_VERDICT, markChars, newJob, settle, stamp, thoughtOf, thoughtTextOf, type JobBuilder } from './view-job';
import { foldedPhase, phaseStep, type PhaseFold } from './view-phase';
import type { AskRecord, JobView, PanelView, ProjectionFacts } from './view-types';

export type {
  AskRecord, GateVerdict, JobView, OpRow, PanelView, ProjectionFacts, SessionPhase, ThoughtTurn,
} from './view-types';
export { derivePhase } from './view-phase';

/**
 * Projects the append-only log into the panel view. The forward fold builds job spans and tracks
 * session-wide markers; the phase comes from the same `phaseStep` fold `derivePhase` runs. Live
 * non-reasoning parts promote thinking or retrying to streaming or executing after the fold.
 */
export function deriveView(log: SessionLog, opts?: { live?: readonly Part[]; facts?: ProjectionFacts }): PanelView {
  const jobs: JobView[] = [];
  let currentJob: JobBuilder | undefined;
  const fold: PhaseFold = { phase: 'idle', inJob: false };
  // Reply suggestions survive settlement and clear when the next order starts.
  let suggestion: string | null = null;
  const vitals = { cells: 0, objects: 0, reverts: 0, jobs: 0 };
  const steerBySeq = new Map<number, string>();
  const recalledSteerSeqs = new Set<number>();
  let lastEventAt = 0;
  // `allow-always` survives job settlement for the rest of the session.
  let allowAll = false;

  for (const e of eventsOf(log)) {
    // Turn spans begin at the preceding log event because stream deltas carry no timestamps.
    const sinceAt = lastEventAt;
    lastEventAt = e.at;
    phaseStep(fold, e);
    switch (e.kind) {
      case 'order':
        // A new order replaces any malformed unterminated job span.
        currentJob = newJob(e.seq, e.text, e.at, e.region, e.mapId);
        suggestion = null; // a fresh order carries no suggestion of its own yet
        break;
      case 'assistant':
        if (currentJob) {
          // Position the thought mark before this turn's tool rows are registered.
          const beforeIndex = currentJob.callOrder.length;
          for (const p of e.parts) {
            if (p.kind === 'tool' && p.argsDone && p.rawInput === undefined) currentJob.inputs.set(p.callId, p.input);
            if (p.kind === 'tool' && !currentJob.names.has(p.callId)) {
              currentJob.names.set(p.callId, p.name);
              currentJob.callOrder.push(p.callId);
              currentJob.stageByCall.set(p.callId, currentJob.stageAt);
            }
            // Suggestions from dropped turns may be incomplete and are not offered to the user.
            if (p.kind === 'tool' && p.name === PROTOCOL.reply && !DROPPED_STOPS.has(e.stop)) {
              suggestion = sanitizeSuggestion(p.input.reply);
            }
            if (p.kind === 'tool' && p.name === PROTOCOL.plan) {
              const stages = parseStages(p.input.stages);
              if (stages) currentJob.planStagesByCall.set(p.callId, stages);
            }
          }
          // Reasoning totals include stopped turns because their work was observed.
          const thought = thoughtOf(e.parts);
          if (thought > 0) {
            currentJob.thoughtChars += thought;
            currentJob.thoughtTurns += 1;
            const text = thoughtTextOf(e.parts);
            currentJob.thoughtMarks.push({
              seq: e.seq,
              ms: sinceAt > 0 ? Math.max(0, e.at - sinceAt) : 0,
              chars: text !== undefined ? markChars(e.parts, text) : thought,
              beforeIndex,
              ...(text !== undefined ? { text } : {}),
            });
          }
        }
        break;
      case 'toolResult':
        vitals.cells += e.detail?.cells ?? 0;
        vitals.objects += e.detail?.objects ?? 0;
        if (e.detail?.reverted) vitals.reverts += 1;
        if (currentJob) {
          currentJob.results.set(e.callId, e);
          if (currentJob.checkpoints.length > 0) currentJob.checkpointByCall.set(e.callId, currentJob.checkpoints.length - 1);
          if (!currentJob.names.has(e.callId)) {
            currentJob.names.set(e.callId, e.name);
            currentJob.callOrder.push(e.callId);
            currentJob.stageByCall.set(e.callId, currentJob.stageAt);
          }
          // Only an explicit write stamp classifies the job as a build; older records omit it.
          if (e.write === true) {
            currentJob.writeIssued = true;
            if (retainedWrite(e)) currentJob.writeApplied = true;
          }
          const loadedSkill = e.detail?.skill;
          if (loadedSkill && !e.isError) {
            currentJob.skills = [...currentJob.skills.filter((s) => s.name !== loadedSkill.name), loadedSkill];
          }
          if (e.detail?.damper) stamp(currentJob, 'damper');
        }
        break;
      case 'steer':
        steerBySeq.set(e.seq, e.text);
        break;
      case 'steerDelivered':
        if (currentJob && steerBySeq.has(e.steerSeq)) currentJob.steerNoteSeqs.push(e.steerSeq);
        break;
      case 'steerRecalled':
        recalledSteerSeqs.add(e.steerSeq);
        break;
      case 'noteRefused':
        // A refused note leaves the queue like a recalled one; a refused typed answer reads as a skip.
        if (e.steerSeq !== undefined) recalledSteerSeqs.add(e.steerSeq);
        if (currentJob) {
          currentJob.refusals.push(e.reply);
          const ask = e.gateId !== undefined ? currentJob.asks.find((a) => a.gateId === e.gateId) : undefined;
          if (ask) {
            ask.verdict = GATE_VERDICT.skip;
            delete ask.words;
          }
          const callId = e.gateId !== undefined ? currentJob.gateIdToCallId.get(e.gateId) : undefined;
          if (callId !== undefined) {
            currentJob.wordsCallIds.delete(callId);
            currentJob.skippedCallIds.add(callId);
          }
        }
        break;
      case 'gateAsked':
        if (currentJob) {
          const ask: AskRecord = { gateId: e.gateId, scope: e.scope, summary: e.summary };
          if (e.quickAnswers && e.quickAnswers.length > 0) ask.quickAnswers = e.quickAnswers;
          if (e.options && e.options.length > 0) ask.options = e.options;
          if (e.callId !== undefined) {
            ask.callId = e.callId;
            const stages = currentJob.planStagesByCall.get(e.callId);
            if (e.scope === 'plan' && stages) ask.stages = stages;
          }
          currentJob.asks.push(ask);
        }
        if (currentJob && e.scope === 'tool' && e.callId !== undefined) {
          currentJob.gateIdToCallId.set(e.gateId, e.callId);
          currentJob.pendingGateCallIds.add(e.callId);
          // A tool gate implies an issued write even when the user skips it before execution.
          currentJob.writeIssued = true;
        }
        break;
      case 'gateAnswered':
        if (e.answer === 'allow-always') allowAll = true;
        if (currentJob) {
          const ask = currentJob.asks.find((a) => a.gateId === e.gateId);
          if (ask) {
            ask.verdict = GATE_VERDICT[e.answer];
            if (e.words !== undefined) ask.words = e.words;
          }
          const callId = currentJob.gateIdToCallId.get(e.gateId);
          if (callId !== undefined) {
            currentJob.pendingGateCallIds.delete(callId);
            if (e.answer === 'skip') currentJob.skippedCallIds.add(callId);
            if (e.answer === 'words') currentJob.wordsCallIds.add(callId);
          }
        }
        break;
      case 'plan':
        if (currentJob) {
          currentJob.plan = { stages: e.stages, currentIndex: 0, doneCount: 0, revision: e.revision };
          currentJob.stageAt = 0;
        }
        break;
      case 'stage':
        if (currentJob?.plan) {
          const { done, current } = stageProgress(e.index, currentJob.plan.stages.length);
          currentJob.plan = { ...currentJob.plan, currentIndex: current, doneCount: done };
          currentJob.stageAt = Math.max(currentJob.stageAt, current);
        }
        break;
      case 'checkpoint':
        if (currentJob) {
          const row: JobView['checkpoints'][number] = { undoIndex: e.undoIndex, label: e.label };
          if (e.stageIndex !== undefined) {
            row.stageIndex = e.stageIndex;
            currentJob.stageAt = Math.max(currentJob.stageAt, e.stageIndex);
          }
          currentJob.checkpoints.push(row);
        }
        break;
      case 'resumed':
        if (currentJob) stamp(currentJob, 'interrupted');
        break;
      case 'pauseRequested':
      case 'paused':
      case 'retry':
        break; // phase markers only, read by `phaseStep`
      case 'systemNote':
        // Loop-authored nudges mark the job as damped for the UI summary.
        if (currentJob) stamp(currentJob, 'damper');
        break;
      case 'compaction':
        if (currentJob) stamp(currentJob, 'compaction');
        break;
      case 'incident':
        if (currentJob) {
          const settled = settle(currentJob, { outcome: 'incident' }, { recalled: recalledSteerSeqs, steerBySeq }, { facts: opts?.facts });
          // Preserve the incident class used to select the panel's failure message.
          settled.errorCls = e.error.cls;
          jobs.push(settled);
          currentJob = undefined;
        }
        break;
      case 'replySuggested': {
        const last = jobs[jobs.length - 1];
        if (!currentJob && last?.orderSeq === e.orderSeq && last.outcome === 'done' && last.question) {
          suggestion = sanitizeSuggestion(e.reply);
        }
        break;
      }
      case 'jobEnd':
        vitals.jobs += 1;
        if (currentJob) {
          jobs.push(settle(
            currentJob, { outcome: e.outcome, summary: e.summary, question: e.question, undoIndex: e.undoIndex },
            { recalled: recalledSteerSeqs, steerBySeq }, { facts: opts?.facts },
          ));
          currentJob = undefined;
        }
        break;
      default: {
        // Exhaustiveness guard: a new SessionEvent kind must be handled above, not silently
        // dropped here as a no-op.
        const _exhaustive: never = e;
        void _exhaustive;
      }
    }
  }

  let phase = foldedPhase(fold);
  const { openGate, openRetry } = fold;

  // Only visible text or tool parts promote thinking/retrying; reasoning alone keeps the prior phase.
  if ((phase === 'thinking' || phase === 'retrying') && opts?.live && opts.live.length > 0) {
    const newest = [...opts.live].reverse().find((p) => p.kind !== 'reasoning');
    if (newest) {
      phase = newest.kind === 'tool' && !currentJob?.results.has(newest.callId) ? 'executing' : 'streaming';
    }
  }

  const queuedSteers = undeliveredSteers(log);

  const view: PanelView = { phase, jobs, queuedSteers, vitals, suggestion, lastEventAt };
  if (allowAll) view.allowAll = true;
  if (currentJob) view.current = settle(currentJob, undefined, { recalled: recalledSteerSeqs, steerBySeq }, { live: opts?.live, facts: opts?.facts });
  // Publish a gate only while the running loop can receive its answer.
  if (openGate && phase === 'gated') {
    view.gate = { gateId: openGate.gateId, scope: openGate.scope, summary: openGate.summary };
    if (openGate.callId !== undefined) view.gate.callId = openGate.callId;
  }
  // Publish retry timing only while backoff is the session's active phase.
  if (openRetry && phase === 'retrying') {
    view.retry = { attempt: openRetry.attempt, cls: openRetry.cls, delayMs: openRetry.delayMs, since: openRetry.at };
  }
  return view;
}
