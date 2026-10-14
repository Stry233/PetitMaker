/*
 * The desk card's face as data. One ladder (`standing`) decides which state owns the card; paper,
 * glyph, control seat, face identity, pose and copy are each read off that one answer.
 */
import {
  type AskRecord,
  type ErrorClass,
  type JobView,
  type PanelView,
  type SessionPhase,
} from '../../../agent/panel';
import { MAX_TURN_ATTEMPTS } from '../../../agent/limits';
import type { Translate, I18nKey } from '../../../i18n/keys';
import type { PoseName } from '../character/poses';
import type { IconId } from '../parts/sprite';
import { editCount, readCount } from './job-stats';
import type { SetupFace, SetupStep } from '../connection/setup-parts';
import type { PaperState } from '../panel-skin';
import { fmtClock } from './clock';
import { PHASE } from './phase';
import { deskActLabel, REPAIR, type RepairAct } from './repair';
import { skillTitle } from '../parts/skill-title';

/** Silence threshold for the informational stall notice, in ms; not a failure classification. */
const STALL_MS = 90_000;

/** Live shell context that is not part of the replayable session projection. */
export interface DeskContext {
  connected?: boolean;
  mapName?: string;
  providerName?: string;
  /** Display-ready armed model name. */
  modelName?: string;
  /** Region marking, which owns the card while the map owns input. */
  marking?: 'blank' | 'painted';
  /** Connection management replaces the job zone. */
  managing?: boolean;
  /** Display-ready live connection summary for the management face. */
  connectionMeta?: string;
  /** Provenance of the past record replacing the job zone. */
  reading?: string;
  /** The setup step standing in the job zone. */
  setup?: SetupFace | null;
  /** An ephemeral delegated task is active. */
  helper?: boolean;
  /** The latest settled record has been filed into history. */
  recordFiled?: boolean;
  /** A restored hold is offered rather than shown as a live pause. */
  heldOffer?: boolean;
  /** Multi-cell extent of the gated call. */
  gateCells?: number;
  /** Local storage is full, so the session is not being persisted. */
  unsaved?: boolean;
  /** Unreadable saved-session data was set aside during load. */
  setAside?: boolean;
}

/** Settled distinctions the idle phase alone does not carry. */
type Settled = 'none' | 'build' | 'answer' | 'quiet' | 'capped' | 'question';

/** Which state owns the card, highest priority first. */
type Standing =
  | { kind: 'marking'; marking: 'blank' | 'painted' }
  | { kind: 'manage' }
  | { kind: 'reading' }
  | { kind: 'setup'; step: SetupFace }
  | { kind: 'asleep' }
  | { kind: 'retrying'; cls?: ErrorClass }
  | { kind: 'incident'; cls: ErrorClass; gone: boolean }
  | { kind: 'idle'; settled: Settled; job?: JobView }
  | { kind: 'phase'; phase: Exclude<SessionPhase, 'idle' | 'retrying' | 'incident'> };

/** Whether a keyless session still has an active, paused, aborted or authentication-failed job to show. */
export function keyGone(view: PanelView, connected: boolean, cls: ErrorClass | undefined): boolean {
  if (connected) return false;
  if (view.phase === 'incident') return cls === 'auth';
  return PHASE[view.phase].inFlight || view.phase === 'paused' || view.phase === 'aborted';
}

function settledKind(view: PanelView, ctx: DeskContext): { job?: JobView; kind: Settled } {
  const job = view.jobs[view.jobs.length - 1];
  if (!job) return { kind: 'none' };
  if (job.question === true) return ctx.recordFiled ? { kind: 'none' } : { job, kind: 'question' };
  if (job.outcome === 'capped') return { job, kind: 'capped' };
  if (job.outcome !== 'done') return { job, kind: 'none' };
  return { job, kind: job.kind === 'answer' ? 'answer' : job.kind === 'quiet' ? 'quiet' : 'build' };
}

/** The disconnected sleep face, only where no job or incident has a stronger status. */
function asleep(view: PanelView, ctx: DeskContext): boolean {
  return ctx.connected === false && !PHASE[view.phase].inFlight && view.phase !== 'incident';
}

function standing(view: PanelView, ctx: DeskContext): Standing {
  if (ctx.marking !== undefined) return { kind: 'marking', marking: ctx.marking };
  if (ctx.managing === true) return { kind: 'manage' };
  if (ctx.reading !== undefined) return { kind: 'reading' };
  if (asleep(view, ctx)) return ctx.setup ? { kind: 'setup', step: ctx.setup } : { kind: 'asleep' };
  const { phase } = view;
  if (phase === 'retrying') return view.retry ? { kind: 'retrying', cls: view.retry.cls } : { kind: 'retrying' };
  if (phase === 'incident') {
    const cls = settledKind(view, ctx).job?.errorCls ?? 'unknown';
    return { kind: 'incident', cls, gone: keyGone(view, ctx.connected !== false, cls) };
  }
  if (phase === 'idle') {
    const { kind, job } = settledKind(view, ctx);
    return job ? { kind: 'idle', settled: kind, job } : { kind: 'idle', settled: kind };
  }
  return { kind: 'phase', phase };
}

/** Paper, pose and copy for each setup step. */
const SETUP_FACE: Record<SetupStep, { paper: PaperState; pose: PoseName; word: I18nKey; meta?: I18nKey }> = {
  awake: { paper: 'idle', pose: 'idle', word: 'agent.dock_setup_awake', meta: 'agent.dock_setup_show_key' },
  typing: { paper: 'idle', pose: 'keylean', word: 'agent.dock_setup_reading', meta: 'agent.dock_setup_watching' },
  shaped: { paper: 'work', pose: 'keylean', word: 'agent.dock_setup_reading', meta: 'agent.dock_setup_shaped' },
  ambiguous: { paper: 'work', pose: 'keylean', word: 'agent.dock_setup_asking_both', meta: 'agent.setup_row_two' },
  unknown: { paper: 'ask', pose: 'asking', word: 'agent.dock_setup_new', meta: 'agent.setup_row_whose' },
  refused: { paper: 'danger', pose: 'trouble', word: 'agent.dock_setup_refused', meta: 'agent.dock_setup_paste_again' },
  'no-answer': { paper: 'danger', pose: 'trouble', word: 'agent.dock_setup_no_provider', meta: 'agent.setup_row_no_answer' },
  endpoint: { paper: 'idle', pose: 'idle', word: 'agent.dock_setup_point_me' },
};

/** Whether a settled question with no applied edits owns the ask face. */
function openQuestion(stand: Standing): boolean {
  return stand.kind === 'idle' && stand.settled === 'question' && editCount(stand.job!) === 0;
}

function deskPaper(view: PanelView, ctx: DeskContext = {}): PaperState {
  const stand = standing(view, ctx);
  switch (stand.kind) {
    case 'marking': return 'think';
    case 'manage': case 'reading': case 'asleep': return 'idle';
    case 'setup': return SETUP_FACE[stand.step.step].paper;
    case 'incident': return REPAIR[stand.cls].exhausted ? 'wait' : 'danger';
    case 'idle': return openQuestion(stand) ? 'ask' : 'idle';
    case 'retrying': return PHASE.retrying.paper;
    case 'phase': return PHASE[stand.phase].paper;
  }
}

const SETTLED_GLYPH: Record<Settled, IconId> = {
  question: 'pw-question', answer: 'pw-reply-bubble', quiet: 'pw-history', build: 'pw-check',
  // Capped work keeps the flag rather than the completion check.
  capped: 'pw-flag', none: 'pw-flag',
};

const PHASE_GLYPH: Partial<Record<SessionPhase, IconId>> = {
  pausing: 'pw-pause', paused: 'pw-pause', aborted: 'pw-stop', gated: 'pw-question',
};

function deskGlyph(view: PanelView, ctx: DeskContext = {}): IconId {
  const stand = standing(view, ctx);
  switch (stand.kind) {
    case 'marking': return 'pw-region-frame';
    case 'manage': return 'pw-settings';
    case 'reading': return 'pw-history';
    case 'setup': return 'pw-key';
    case 'asleep': return 'pw-disconnected';
    case 'retrying': return stand.cls ? REPAIR[stand.cls].retryIcon : 'pw-resume';
    case 'incident': return 'pw-warning';
    case 'idle': return SETTLED_GLYPH[stand.settled];
    case 'phase': return PHASE_GLYPH[stand.phase] ?? 'pw-resume';
  }
}

/** The one control above the gear: which it is, what pressing it does, and how it reads. */
export interface DeskSeat {
  id: 'pause' | 'stop' | 'resume';
  /** Invoked verb, or null while the seat is temporarily noninteractive. */
  act: 'pause' | 'stop' | 'resume' | null;
  icon: IconId;
  labelKey: I18nKey;
}

const SEATS = {
  pause: { id: 'pause', act: 'pause', icon: 'pw-pause', labelKey: 'agent.dock_pause_at_step' },
  stop: { id: 'stop', act: 'stop', icon: 'pw-stop', labelKey: 'agent.action_stop' },
  resume: { id: 'resume', act: 'resume', icon: 'pw-resume', labelKey: 'agent.action_resume' },
} as const satisfies Record<string, DeskSeat>;

export function deskSeat(view: PanelView, ctx: DeskContext = {}): DeskSeat | null {
  const stand = standing(view, ctx);
  // Marking, management, records and setup carry their own controls.
  if (stand.kind !== 'retrying' && stand.kind !== 'phase') return null;
  // A keyless in-flight job stays stoppable but cannot offer a resumable pause.
  if (ctx.connected === false && PHASE[view.phase].inFlight) return SEATS.stop;
  if (view.phase === 'retrying' || view.phase === 'gated' || view.phase === 'pausing') return SEATS.stop;
  if (PHASE[view.phase].running) return view.current !== undefined ? SEATS.pause : null;
  if (view.phase === 'paused') return SEATS.resume;
  return null;
}

/** Face identity: a change flips the card, anything else repaints in place. */
export function deskFaceKey(view: PanelView, ctx: DeskContext = {}): string {
  const stand = standing(view, ctx);
  switch (stand.kind) {
    case 'marking': return `marking:${stand.marking}`;
    case 'manage': return 'manage';
    case 'reading': return 'reading';
    case 'setup': return `setup:${stand.step.step}`;
    case 'asleep': return 'disconnected';
    case 'retrying': return `retrying:${stand.cls ?? 'unknown'}`;
    case 'incident': return `incident:${stand.cls}${stand.gone ? ':gone' : ''}`;
    case 'idle': return `idle:${stand.settled}`;
    case 'phase': return stand.phase;
  }
}

/** A context-specific pose, or null where the session phase owns the pose. */
export function deskPose(view: PanelView, ctx: DeskContext = {}): PoseName | null {
  // Management leaves the session's own pose standing, so it does not take the ladder here.
  const stand = standing(view, { ...ctx, managing: false });
  if (stand.kind === 'marking') return 'watching';
  if (stand.kind === 'setup') return SETUP_FACE[stand.step.step].pose;
  return openQuestion(stand) ? 'asking' : null;
}

export type FaceKind = 'plain' | 'retry' | 'act';

/** The card's four seats, resolved to the text and the controls this face stands. */
export interface Face {
  kind: FaceKind;
  paper: PaperState;
  glyph: IconId;
  word: string;
  datum?: string;
  meta?: string;
  /** The elapsed reading, absent on a face that carries no clock. */
  clock?: string;
  act?: { id: RepairAct; label: string };
  retry?: { secs: number; spent: number; spanMs: number; timed: boolean };
  /** Stall copy split around its ticking time leaf. */
  stall?: { prefix: string; suffix: string; clock: string };
}

/** Splits a translation template around a live-value placeholder; a missing token leaves one prefix. */
export function splitOnToken(template: string, token: string): [string, string] {
  const i = template.indexOf(token);
  return i < 0 ? [template, ''] : [template.slice(0, i), template.slice(i + token.length)];
}

/** Settled states that remain owed after their record is filed. */
const OWED_AFTER_FILING: ReadonlySet<Settled> = new Set<Settled>(['capped']);

/** The open ask behind the current gate. */
function openAsk(view: PanelView): AskRecord | undefined {
  const gate = view.gate;
  return gate === undefined ? undefined : view.current?.asks.find((ask) => ask.gateId === gate.gateId);
}

/** The newest style skill, or the newest skill when no style is loaded, by its shown title. */
function deskSkill(job: JobView | undefined, t: Translate): string | undefined {
  const skills = job?.skills ?? [];
  const styles = skills.filter((skill) => skill.kind === 'style');
  const skill = styles.length > 0 ? styles[styles.length - 1] : skills[skills.length - 1];
  return skill ? skillTitle(skill, t) : undefined;
}

/** The highest-priority transient detail of a running job; each source clears itself with its condition. */
function runningSub(view: PanelView, ctx: DeskContext, t: Translate): string | undefined {
  if (!PHASE[view.phase].running) return undefined;
  const settledOp = [...(view.current?.ops ?? [])].reverse()
    .find((op) => op.status !== 'run' && op.status !== 'pending-gate');
  if (settledOp?.status === 'blocked') return t('agent.dock_region_held');
  const queued = view.queuedSteers.length;
  if (queued === 1) return t('agent.dock_steer_next');
  if (queued > 1) return t('agent.dock_steers_queued', { n: queued });
  if (ctx.helper === true) return t('agent.dock_helper');
  const playbook = deskSkill(view.current, t);
  if (playbook !== undefined) return t('agent.dock_playbook', { title: playbook });
  if (ctx.unsaved === true) return t('agent.dock_unsaved');
  return undefined;
}

/** Option, plan-stage or cell count for the open gate, without repeating its question. */
function gateSize(view: PanelView, ctx: DeskContext, t: Translate): string | undefined {
  const open = view.gate;
  if (!open) return undefined;
  const ask = openAsk(view);
  const options = ask?.options?.length ?? 0;
  if (options > 0) return t('agent.dock_options', { n: options });
  if (open.scope === 'plan') {
    const stages = ask?.stages?.length;
    return stages !== undefined && stages > 0
      ? t('units.steps', { n: stages })
      : undefined;
  }
  return ctx.gateCells === undefined ? undefined : t('units.cells', { n: ctx.gateCells });
}

function settledFace(base: Face, settled: Settled, job: JobView | undefined, ctx: DeskContext, t: Translate): Face {
  const onMap = ctx.mapName ? t('agent.dock_on_map', { name: ctx.mapName }) : undefined;
  switch (settled) {
    case 'build': {
      const edits = editCount(job!);
      return {
        ...base, word: t('agent.dock_done'),
        // Zero applied edits read as a state rather than as a count.
        meta: edits === 0 ? t('agent.dock_no_edits') : t('agent.history_edits', { n: edits }),
      };
    }
    case 'answer': {
      const n = readCount(job!);
      return {
        ...base, word: t('agent.dock_answered'),
        meta: n === 0 ? t('agent.dock_no_edits') : t('agent.dock_reads', { n }),
      };
    }
    case 'quiet':
      return { ...base, word: t('agent.dock_ended'), meta: t('agent.dock_nothing_said') };
    case 'capped': {
      const plan = job?.plan;
      const left = plan ? Math.max(0, plan.stages.length - plan.doneCount) : 0;
      const stagesLeft = left > 0 ? t('agent.dock_stages_left', { n: left }) : undefined;
      return { ...base, word: t('agent.dock_capped'), ...(stagesLeft ? { meta: stagesLeft } : onMap ? { meta: onMap } : {}) };
    }
    case 'question':
      // A trailing question after completed work reports the work; one with no edits stays blocking.
      return editCount(job!) > 0
        ? { ...base, word: t('agent.dock_done'), meta: t('agent.dock_one_question') }
        : { ...base, word: t('agent.dock_gated') };
    case 'none':
      // A set-aside storage notice outranks the map name.
      return { ...base, ...(ctx.setAside ? { meta: t('agent.dock_set_aside') } : onMap ? { meta: onMap } : {}) };
  }
}

/** The state's own card: what the four seats hold. */
export function buildFace(view: PanelView, ctx: DeskContext, now: number, activeAt: number, t: Translate): Face {
  const stand = standing(view, ctx);
  const paper = deskPaper(view, ctx);
  const glyph = deskGlyph(view, ctx);
  const plain = (word: string, meta?: string): Face => ({ kind: 'plain', paper, glyph, word, ...(meta ? { meta } : {}) });

  switch (stand.kind) {
    case 'marking':
      return plain(t('agent.dock_marking'), t(stand.marking === 'painted' ? 'agent.dock_marking_down' : 'agent.dock_marking_sub'));
    case 'manage':
      return plain(t('agent.dock_connection'), ctx.connectionMeta);
    case 'reading':
      return plain(t('agent.dock_reading_record'), ctx.reading);
    case 'setup': {
      const row = SETUP_FACE[stand.step.step];
      const params = { name: stand.step.name ?? '' };
      return plain(t(row.word, params), row.meta ? t(row.meta, params) : stand.step.name);
    }
    case 'asleep':
      return plain(t('agent.dock_disconnected'), t('agent.dock_no_key'));
    case 'retrying':
      if (view.retry) {
        // Network retries wait for connectivity with an untimed action; other retries show their backoff.
        const { attempt, cls, delayMs, since } = view.retry;
        const remaining = Math.max(0, since + delayMs - now);
        return {
          kind: 'retry', paper, glyph,
          word: t(REPAIR[cls].retryWord),
          datum: t('agent.dock_try_of', { n: attempt, m: MAX_TURN_ATTEMPTS }),
          retry: {
            secs: Math.ceil(remaining / 1000),
            spent: delayMs > 0 ? Math.min(1, Math.max(0, 1 - remaining / delayMs)) : 1,
            spanMs: delayMs,
            timed: cls !== 'network' && delayMs > 0,
          },
        };
      }
      break;
    case 'incident': {
      const { cls } = stand;
      // Any keyless incident restores a key before retrying.
      const act = ctx.connected === false ? REPAIR.auth.act : REPAIR[cls].act;
      // Key failures name the provider, model failures the model, exhausted retries the attempts.
      const datum = cls === 'auth' ? ctx.providerName
        : cls === 'model' ? ctx.modelName
          : REPAIR[cls].exhausted ? t('agent.dock_after_tries', { n: MAX_TURN_ATTEMPTS }) : undefined;
      return {
        kind: 'act', paper, glyph,
        word: stand.gone ? t('agent.dock_err_key_missing') : t(REPAIR[cls].errorWord),
        ...(datum ? { datum } : {}),
        act: { id: act, label: t(deskActLabel(act)) },
      };
    }
    case 'idle': {
      // Filing dismisses a completed turn, its closing question included; capped jobs stay owed.
      const filed = ctx.recordFiled === true && !OWED_AFTER_FILING.has(stand.settled);
      return settledFace(plain(t('agent.dock_idle')), filed ? 'none' : stand.settled, filed ? undefined : stand.job, ctx, t);
    }
    case 'phase':
      break;
  }
  return phaseFace(view, ctx, { now, activeAt }, t, { paper, glyph });
}

function phaseFace(
  view: PanelView, ctx: DeskContext, time: { now: number; activeAt: number }, t: Translate, look: { paper: PaperState; glyph: IconId },
): Face {
  const { now, activeAt } = time;
  const { paper, glyph } = look;
  const { phase, current } = view;
  const traits = PHASE[phase];
  const plan = current?.plan;
  // Paused plans report completed stages; active plans the stage in progress.
  const step = plan
    ? phase === 'paused'
      ? t('agent.dock_stage_of', { n: plan.doneCount, m: plan.stages.length })
      : t('agent.dock_step_of', { n: plan.doneCount + 1, m: plan.stages.length })
    : undefined;
  const aborted = phase === 'aborted' ? settledKind(view, ctx).job : undefined;
  const onMap = ctx.mapName ? t('agent.dock_on_map', { name: ctx.mapName }) : undefined;
  // Active clocks run to now, settled ones end at the last recorded event; restored offers carry none.
  const anchor = phase === 'aborted' ? aborted : current;
  const clock = anchor && ctx.heldOffer !== true
    ? fmtClock(((traits.running || phase === 'gated' || phase === 'pausing' ? now : view.lastEventAt) - anchor.orderAt) / 1000) ?? undefined
    : undefined;

  const silence = traits.awaitingStream ? now - activeAt : 0;
  const stallClock = silence >= STALL_MS ? fmtClock(silence / 1000) : null;
  const heldAtSkip = phase === 'paused' && current?.ops[current.ops.length - 1]?.status === 'skipped';
  const picking = phase === 'gated' && (openAsk(view)?.options?.length ?? 0) > 0;
  const word = stallClock !== null ? t('agent.dock_still_thinking')
    : picking ? t('agent.dock_pick')
      : ctx.heldOffer === true && phase === 'paused' ? t('agent.dock_stopped_partway')
        : heldAtSkip ? t('agent.dock_holding') : t(traits.word);
  // A paused job can hold an unanswered ask even though `view.gate` is absent outside gated.
  const heldQuestion = phase === 'paused' && current?.asks.some((ask) => ask.verdict === undefined) === true;
  const thought = current?.thought;
  const meta = phase === 'gated' ? gateSize(view, ctx, t)
    : phase === 'aborted' ? (aborted && editCount(aborted) > 0 ? t('agent.dock_edits_kept') : onMap)
      : phase === 'pausing' ? t('agent.dock_resume_pending')
        : heldQuestion ? t('agent.dock_question_held')
          : heldAtSkip ? t('agent.dock_skipped')
            : stallClock !== null ? t('agent.dock_stall', { t: stallClock })
              : runningSub(view, ctx, t)
                ?? (thought && traits.awaitingStream
                  ? t('agent.dock_thoughts', { n: thought.turns })
                  : step);
  // The ticking stall value keeps its own text node between stable translated fragments.
  const [prefix, suffix] = splitOnToken(t('agent.dock_stall'), '{t}');
  return {
    kind: 'plain', paper, glyph, word,
    ...(meta ? { meta } : {}),
    ...(stallClock !== null ? { stall: { prefix, suffix, clock: stallClock } } : {}),
    ...(clock ? { clock } : {}),
  };
}

/** Whether the session-wide asks-off mark belongs on this face. */
export function showsAllowAll(view: PanelView, ctx: DeskContext, face: Face): boolean {
  return view.allowAll === true && face.kind === 'plain' && !asleep(view, ctx);
}
