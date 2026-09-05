/*
 * Renders the fixed-height assistant status dock and character seat. Face identity controls keyed
 * flips; clock and metadata changes repaint in place. Context screens can override session state.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotionConfig, AnimatePresence } from 'framer-motion';
import type { ErrorClass } from '../../agent/core/types';
import { MAX_TURN_RETRIES } from '../../agent/core/retry';
import type { AskRecord, JobView, PanelView, SessionPhase } from '../../agent/core/project-view';
import { useT } from '../../i18n/context';
import { IconButton, Pill } from './atoms';
import { Character } from './character/Character';
import { poseForPhase, type PoseName } from './character/poses';
import { setSurfacePose } from './character/surface-pose';
import { fmtClock, readCount, RUNNING, STALL_MS, useLastActivity, WORD_FOR_PHASE } from './dock-face';
import type { SetupFace, SetupStep } from './setup-parts';
import { Icon, type IconId } from './icons';
import { metaInk, statePaper, type PaperState } from './tokens';
import { CHARACTER_SEAT } from '../shell/panel-frame';
import { amplitude, cssMotion, flipProfile, framerMotion, outMotion, turnSeconds } from './motion';
import { TimedButton } from '../primitives/TimedButton';
import { INK } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';

/** Dock-card height in pixels. */
export const DOCK_HEIGHT = 74;

/** Gap between the externally hosted character seat and dock card. */
const DESK_GAP = 10;

/** Dock-card flip perspective in pixels. */
const PERSPECTIVE = 520;

/** Dock-card landing overshoot in degrees. */
const FLIP_OVERSHOOT = 7;

/** Full dock-card turn duration from the motion registry, in milliseconds. */
const TURN_MS = turnSeconds('panel.dock.flip') * 1000;

/** Time before an unanswered stop confirmation retracts, in milliseconds. */
const STOP_CONFIRM_MS = 4000;

/** Post-retraction delay before the restored action seat accepts input, in milliseconds. */
const SEAT_NUMB_MS = 250;

/** Phases in which the loop still owns a job, including gates, retry backoff and pending pause. */
const IN_FLIGHT: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing',
]);

/** The disconnected sleep face applies only when no job or incident has a stronger status. */
function keylessSleep(view: PanelView, ctx: DockContext): boolean {
  return ctx.connected === false && !IN_FLIGHT.has(view.phase) && view.phase !== 'incident';
}

/** Whether a keyless session still has an active, paused, aborted or authentication-failed job to show. */
export function keyGone(view: PanelView, connected: boolean, cls: ErrorClass | undefined): boolean {
  if (connected) return false;
  if (view.phase === 'incident') return cls === 'auth';
  return IN_FLIGHT.has(view.phase) || view.phase === 'paused' || view.phase === 'aborted';
}

/** Returns setup status only when it is the strongest available keyless face. */
function setupFaceOf(view: PanelView, ctx: DockContext): SetupFace | null {
  return ctx.setup && keylessSleep(view, ctx) ? ctx.setup : null;
}

/** Paper, pose and copy for each setup step. */
const SETUP_FACE: Record<SetupStep, {
  paper: PaperState; pose: PoseName; word: string; meta?: string;
}> = {
  awake: { paper: 'idle', pose: 'idle', word: 'agent3.dock_setup_awake', meta: 'agent3.dock_setup_show_key' },
  typing: { paper: 'idle', pose: 'keylean', word: 'agent3.dock_setup_reading', meta: 'agent3.dock_setup_watching' },
  shaped: { paper: 'work', pose: 'keylean', word: 'agent3.dock_setup_reading', meta: 'agent3.dock_setup_shaped' },
  ambiguous: { paper: 'work', pose: 'keylean', word: 'agent3.dock_setup_asking_both', meta: 'agent3.setup_row_two' },
  unknown: { paper: 'ask', pose: 'asking', word: 'agent3.dock_setup_new_one', meta: 'agent3.setup_row_whose' },
  refused: { paper: 'danger', pose: 'trouble', word: 'agent3.dock_setup_refused', meta: 'agent3.dock_setup_paste_again' },
  'no-answer': { paper: 'danger', pose: 'trouble', word: 'agent3.dock_setup_no_provider', meta: 'agent3.setup_row_no_answer' },
  endpoint: { paper: 'idle', pose: 'idle', word: 'agent3.dock_setup_point_me' },
  confirmed: { paper: 'work', pose: 'pleased', word: 'agent3.dock_setup_confirmed', meta: 'agent3.dock_setup_confirmed_sub' },
  // The chosen step reports the selected model; the provider remains visible below.
  chosen: { paper: 'work', pose: 'pleased', word: 'agent3.dock_setup_confirmed', meta: 'agent3.dock_setup_chosen_sub' },
};

/** Exhaustive dock-paper mapping for every session phase. */
const PAPER_FOR_PHASE: Record<SessionPhase, PaperState> = {
  idle: 'idle',
  thinking: 'think',
  streaming: 'think',
  executing: 'work',
  gated: 'ask',
  retrying: 'wait',
  pausing: 'work',
  paused: 'wait',
  aborted: 'stop',
  incident: 'danger',
};

/** Transient failures that retain waiting-paper styling after retry exhaustion. */
const EXHAUSTED: ReadonlySet<ErrorClass> = new Set<ErrorClass>(['network', 'overloaded', 'rate-limit']);

/** Retry glyph by `ErrorClass`: offline, rate-limit clock or generic warning. */
const RETRY_ICON: Record<ErrorClass, IconId> = {
  auth: 'pw-warning',
  quota: 'pw-warning',
  'rate-limit': 'pw-retry-clock',
  overloaded: 'pw-warning',
  network: 'pw-cloud-off',
  cors: 'pw-warning',
  overflow: 'pw-warning',
  abort: 'pw-warning',
  config: 'pw-warning',
  model: 'pw-warning',
  unknown: 'pw-warning',
};

/** Leading retry status copy by failure class. */
const RETRY_WORD: Record<ErrorClass, string> = {
  auth: 'agent3.dock_retry_again',
  quota: 'agent3.dock_retry_again',
  'rate-limit': 'agent3.dock_retry_busy',
  overloaded: 'agent3.dock_retry_busy',
  network: 'agent3.dock_retry_offline',
  cors: 'agent3.dock_retry_again',
  overflow: 'agent3.dock_retry_again',
  abort: 'agent3.dock_retry_again',
  config: 'agent3.dock_retry_again',
  model: 'agent3.dock_retry_again',
  unknown: 'agent3.dock_retry_again',
};

/** Leading terminal-error copy by failure class; keyGone selects the missing-key variant. */
const ERROR_WORD: Record<ErrorClass, string> = {
  auth: 'agent3.dock_err_auth',
  quota: 'agent3.dock_err_quota',
  cors: 'agent3.dock_err_cors',
  overflow: 'agent3.dock_err_overflow',
  network: 'agent3.dock_err_no_answer',
  overloaded: 'agent3.dock_err_no_answer',
  'rate-limit': 'agent3.dock_err_no_answer',
  abort: 'agent3.dock_incident',
  config: 'agent3.dock_err_config',
  model: 'agent3.dock_err_model',
  unknown: 'agent3.dock_incident',
};

/** Action identities exposed by dock-card repair faces. */
export type DockActId = 'try-again' | 'new-order' | 'fix-key' | 'edit-endpoint' | 'edit-model';

/** Repair action for each terminal failure class. */
const ERROR_ACT: Record<ErrorClass, { id: DockActId; labelKey: string }> = {
  auth: { id: 'fix-key', labelKey: 'agent3.dock_act_fix_key' },
  quota: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  cors: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  overflow: { id: 'new-order', labelKey: 'agent3.dock_act_new_order' },
  network: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  overloaded: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  'rate-limit': { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  abort: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  // Configuration failures require an endpoint before another request can be sent.
  config: { id: 'edit-endpoint', labelKey: 'agent3.banner_action_edit_endpoint' },
  // Model failures retain the working endpoint and reopen model selection.
  model: { id: 'edit-model', labelKey: 'agent3.banner_action_edit_model' },
  unknown: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
};

/** Settled result distinctions not represented by the idle phase alone. */
type Settled = 'none' | 'build' | 'answer' | 'quiet' | 'capped' | 'question';

function settledKind(view: PanelView): { job?: JobView; kind: Settled } {
  const job = view.jobs[view.jobs.length - 1];
  if (!job) return { kind: 'none' };
  if (job.question === true) return { job, kind: 'question' };
  if (job.outcome === 'capped') return { job, kind: 'capped' };
  if (job.outcome !== 'done') return { job, kind: 'none' };
  return { job, kind: job.kind === 'answer' ? 'answer' : job.kind === 'quiet' ? 'quiet' : 'build' };
}

/** Live shell context that is not part of the replayable session projection. */
export interface DockContext {
  connected?: boolean;
  mapName?: string;
  providerName?: string;
  /** Display-ready armed model name. */
  modelName?: string;
  /** Region-marking state, which takes visual priority while the map owns input. */
  marking?: 'blank' | 'painted';
  /** Whether connection management currently replaces the job zone. */
  managing?: boolean;
  /** Display-ready live connection summary for the management face. */
  connectionMeta?: string;
  /** Provenance text for the past record currently replacing the job zone. */
  reading?: string;
  /** Which step the setup screen standing in the job zone has reached, where one is. */
  setup?: SetupFace | null;
  /** Whether an ephemeral delegated task is active. */
  helper?: boolean;
  /** Whether the latest settled record has been filed into history. */
  recordFiled?: boolean;
  /** Whether a restored hold is being offered rather than shown as a live pause. */
  heldOffer?: boolean;
  /** Multi-cell extent of the gated call, measured by the live tool surface. */
  gateCells?: number;
  /** Local storage is full, so the session is not currently being persisted. */
  unsaved?: boolean;
  /** Whether unreadable saved-session data was set aside during load. */
  setAside?: boolean;
}

/** Settled states that remain owed after their record is filed. */
const OWED_AFTER_FILING: ReadonlySet<Settled> = new Set<Settled>(['capped', 'question']);

/** The paper the dock paints for this view. */
export function dockPaper(view: PanelView, ctx: DockContext = {}): PaperState {
  if (ctx.marking !== undefined) return 'think';
  if (ctx.managing === true) return 'idle';
  if (ctx.reading !== undefined) return 'idle';
  const step = setupFaceOf(view, ctx);
  if (step) return SETUP_FACE[step.step].paper;
  if (keylessSleep(view, ctx)) return 'idle';
  if (view.phase === 'incident') {
    return EXHAUSTED.has(settledKind(view).job?.errorCls ?? 'unknown') ? 'wait' : 'danger';
  }
  if (view.phase === 'idle') {
    const settled = settledKind(view);
    // Only a question with no applied edits owns the ask-paper face.
    if (settled.kind === 'question' && editCount(settled.job!) === 0) return 'ask';
  }
  return PAPER_FOR_PHASE[view.phase];
}

/** Returns the glyph for the highest-priority dock state. */
export function dockGlyph(view: PanelView, ctx: DockContext = {}): IconId {
  if (ctx.marking !== undefined) return 'pw-region-frame';
  if (ctx.managing === true) return 'pw-settings';
  if (ctx.reading !== undefined) return 'pw-history';
  if (view.phase === 'retrying' && view.retry) return RETRY_ICON[view.retry.cls];
  if (setupFaceOf(view, ctx)) return 'pw-key';
  if (keylessSleep(view, ctx)) return 'pw-disconnected';
  if (view.phase === 'pausing' || view.phase === 'paused') return 'pw-pause';
  if (view.phase === 'incident') return 'pw-warning';
  if (view.phase === 'aborted') return 'pw-stop';
  if (view.phase === 'gated') return 'pw-question';
  if (view.phase === 'idle') {
    switch (settledKind(view).kind) {
      case 'question': return 'pw-question';
      case 'answer': return 'pw-reply-bubble';
      case 'quiet': return 'pw-history';
      case 'build': return 'pw-check';
      // Capped work retains the flag rather than the completion check.
      case 'capped': return 'pw-flag';
      default: return 'pw-flag';
    }
  }
  return 'pw-resume';
}

/** The one seat above the gear: which control it holds, what pressing it does, and how it reads. */
export interface DockSeat {
  id: 'pause' | 'stop' | 'resume';
  /** Invoked verb, or null while the seat is temporarily noninteractive. */
  act: 'pause' | 'stop' | 'resume' | null;
  icon: IconId;
  labelKey: string;
}

const SEATS = {
  pause: { id: 'pause', act: 'pause', icon: 'pw-pause', labelKey: 'agent3.dock_pause_at_step' },
  stop: { id: 'stop', act: 'stop', icon: 'pw-stop', labelKey: 'agent3.action_stop' },
  resume: { id: 'resume', act: 'resume', icon: 'pw-resume', labelKey: 'agent3.action_resume' },
} as const satisfies Record<string, DockSeat>;

/** Pause is available only while a current job ticket is present. */
function canPause(view: PanelView): boolean {
  return view.current !== undefined;
}

/** Resolves the dock action seat for current session and shell context. */
export function dockSeat(view: PanelView, ctx: DockContext = {}): DockSeat | null {
  // Region marking owns input and suppresses job controls.
  if (ctx.marking !== undefined) return null;
  // Management provides its own job controls.
  if (ctx.managing === true) return null;
  // Past records provide their own navigation and no live job controls.
  if (ctx.reading !== undefined) return null;
  // Setup provides its own actions.
  if (setupFaceOf(view, ctx)) return null;
  if (keylessSleep(view, ctx)) return null;
  // A keyless in-flight job remains stoppable but cannot offer a resumable pause.
  if (ctx.connected === false && IN_FLIGHT.has(view.phase)) return SEATS.stop;
  if (view.phase === 'retrying' || view.phase === 'gated') return SEATS.stop;
  if (RUNNING.has(view.phase)) return canPause(view) ? SEATS.pause : null;
  // Pending pause remains stoppable until the loop reaches a boundary.
  if (view.phase === 'pausing') return SEATS.stop;
  if (view.phase === 'paused') return SEATS.resume;
  return null;
}

/** Returns the stable face identity used to distinguish flips from in-place updates. */
export function dockFaceKey(view: PanelView, ctx: DockContext = {}): string {
  if (ctx.marking !== undefined) return `marking:${ctx.marking}`;
  if (ctx.managing === true) return 'manage';
  if (ctx.reading !== undefined) return 'reading';
  const step = setupFaceOf(view, ctx);
  if (step) return `setup:${step.step}`;
  if (keylessSleep(view, ctx)) return 'disconnected';
  if (view.phase === 'retrying') return `retrying:${view.retry?.cls ?? 'unknown'}`;
  if (view.phase === 'incident') {
    const cls = settledKind(view).job?.errorCls ?? 'unknown';
    return `incident:${cls}${keyGone(view, ctx.connected !== false, cls) ? ':gone' : ''}`;
  }
  if (view.phase === 'idle') return `idle:${settledKind(view).kind}`;
  return view.phase;
}

/** Returns a context-specific pose, or null when the session phase owns the pose. */
export function dockPose(view: PanelView, ctx: DockContext = {}): PoseName | null {
  if (ctx.marking !== undefined) return 'watching';
  // Opening history does not change the underlying session pose.
  if (ctx.reading !== undefined) return null;
  const step = setupFaceOf(view, ctx);
  if (step) return SETUP_FACE[step.step].pose;
  if (view.phase === 'idle') {
    const settled = settledKind(view);
    if (settled.kind === 'question' && editCount(settled.job!) === 0) return 'asking';
  }
  return null;
}

/* ── the face, as data ────────────────────────────────────── */

type FaceKind = 'plain' | 'retry' | 'act' | 'confirm';

/** The card's four seats, resolved to the text and the controls this face stands. */
interface Face {
  kind: FaceKind;
  paper: PaperState;
  glyph: IconId;
  word: string;
  datum?: string;
  meta?: string;
  /** The elapsed reading, absent on a face that carries no clock. */
  clock?: string;
  act?: { id: DockActId; label: string };
  retry?: { secs: number; spent: number; spanMs: number; timed: boolean };
  /** Stall copy split around its ticking time leaf. */
  stall?: { prefix: string; suffix: string; clock: string };
}

/** What a job actually changed on the map, as its own ops recorded it. */
function editCount(job: JobView): number {
  return job.ops.reduce((sum, op) => sum + (op.detail?.cells ?? 0) + (op.detail?.objects ?? 0), 0);
}

export interface DeskHeaderProps {
  view: PanelView;
  /** Connection readiness; callers explicitly report disconnected state. */
  connected?: boolean;
  /** The map the session is standing on, for the meta's fallback. */
  mapName?: string;
  /** The armed provider's display name, which the key faces say as their datum (`DockContext`). */
  providerName?: string;
  /** The armed model's display name, the unserved-model face's own datum (`DockContext`). */
  modelName?: string;
  /** One-shot pose override; the phase decides when absent. */
  pose?: PoseName;
  /** Clock source for elapsed time and retry countdowns. */
  now?: number;
  onPause?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onRetryNow?: () => void;
  /** The gear: one press back to the connection surface. */
  onManage?: () => void;
  /** Whether that surface is what the panel is showing right now, which lights the gear AND turns
   *  the card into the connection's own face. */
  managing?: boolean;
  /** The live connection as one line, said on the manage face's meta deck. */
  connectionMeta?: string;
  /** A past record is open over the job zone, and this is its provenance (`DockContext.reading`). */
  readingRecord?: string;
  /** A delegate is at work (`DockContext.helper`). */
  helper?: boolean;
  /** Setup step currently replacing the job zone. */
  setupFace?: SetupFace | null;
  /** A saved session came back unreadable and was set aside on load (`DockContext.setAside`). */
  storageSetAside?: boolean;
  /** The map holds the pencil, and whether a stroke has landed yet (`DockContext.marking`). */
  marking?: 'blank' | 'painted';
  /** How many cells the call at the open gate would touch (`DockContext.gateCells`). */
  gateCells?: number;
  /** The settled record has been put away (`DockContext.recordFiled`). */
  recordFiled?: boolean;
  /** Whether the hold is a restored offer rather than a live pause. */
  heldOffer?: boolean;
  /** Whether local storage is full and the session is currently unsaved. */
  unsaved?: boolean;
  /** Nonce that opens this card's shared stop confirmation from elsewhere in the panel. */
  askStop?: number;
  /** A terminal face's worded act, reported by its own id (the verbs live with the caller). */
  onDockAct?: (act: DockActId) => void;
  /** External live-character seat; defaults to an inline Character. */
  characterSlot?: ReactNode;
}

export function DeskHeader({
  view,
  connected = true,
  mapName,
  providerName,
  modelName,
  pose,
  now = Date.now(),
  onPause,
  onStop,
  onResume,
  onRetryNow,
  onManage,
  managing = false,
  connectionMeta,
  readingRecord,
  helper = false,
  setupFace,
  askStop,
  onDockAct,
  characterSlot,
  storageSetAside = false,
  marking,
  gateCells,
  recordFiled = false,
  heldOffer = false,
  unsaved = false,
}: DeskHeaderProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  // Live view updates provide activity timestamps that are not stored in the projection.
  const activeAt = useLastActivity(view, now);
  const ctx: DockContext = {
    connected,
    managing,
    ...(mapName !== undefined ? { mapName } : {}),
    ...(providerName !== undefined ? { providerName } : {}),
    ...(modelName !== undefined ? { modelName } : {}),
    ...(connectionMeta !== undefined ? { connectionMeta } : {}),
    ...(readingRecord !== undefined ? { reading: readingRecord } : {}),
    ...(helper ? { helper } : {}),
    ...(setupFace ? { setup: setupFace } : {}),
    ...(storageSetAside ? { setAside: true } : {}),
    ...(marking ? { marking } : {}),
    ...(gateCells !== undefined ? { gateCells } : {}),
    ...(recordFiled ? { recordFiled: true } : {}),
    ...(heldOffer ? { heldOffer: true } : {}),
    ...(unsaved ? { unsaved: true } : {}),
  };
  const key = dockFaceKey(view, ctx);

  // Publish surface-specific poses to the externally hosted live character.
  const surfacePose = dockPose(view, ctx);
  useEffect(() => {
    setSurfacePose(surfacePose);
    return () => setSurfacePose(null);
  }, [surfacePose]);

  // Stop confirmation is card-local because the session is unchanged until confirmed.
  const [asking, setAsking] = useState(false);
  // The stable desk wrapper pauses retraction because browsers do not re-fire pointerenter on a face mounted under the cursor.
  const [reading, setReading] = useState(false);
  /** Whether the restored action seat is within its post-retraction input delay. */
  const [numb, setNumb] = useState(false);
  /** Remaining confirmation lifetime, preserved while pointer reading pauses it. */
  const confirmLeft = useRef(STOP_CONFIRM_MS);

  // Face replacement can unmount before pointerleave, so it clears both confirmation and hover state.
  useEffect(() => { setAsking(false); setReading(false); }, [key]);
  // Process external stop nonces after the face-reset effect.
  const askedAt = useRef(askStop);
  useEffect(() => {
    if (askStop === undefined || askStop === askedAt.current) return;
    askedAt.current = askStop;
    setAsking(true);
  }, [askStop]);
  useEffect(() => { if (!asking) confirmLeft.current = STOP_CONFIRM_MS; }, [asking]);
  useEffect(() => {
    if (!asking || reading) return undefined;
    const from = Date.now();
    const timer = setTimeout(() => { setAsking(false); setNumb(true); }, confirmLeft.current);
    return () => {
      clearTimeout(timer);
      confirmLeft.current = Math.max(0, confirmLeft.current - (Date.now() - from));
    };
  }, [asking, reading]);
  useEffect(() => {
    if (!numb) return undefined;
    const timer = setTimeout(() => setNumb(false), SEAT_NUMB_MS);
    return () => clearTimeout(timer);
  }, [numb]);

  const seat = dockSeat(view, ctx);
  const face = buildFace(view, ctx, now, activeAt, t);
  const showing: Face = asking
    ? { kind: 'confirm', paper: face.paper, glyph: 'pw-stop', word: t('agent3.dock_stop_question') }
    : face;
  /** Stop confirmation is a separate face that retains the interrupted paper color. */
  const faceKey = asking ? `confirm|${face.paper}` : key;
  // Disable input for the turn duration so a stationary pointer cannot activate the incoming face.
  const [turning, setTurning] = useState(false);
  const firstFace = useRef(true);
  useEffect(() => {
    if (firstFace.current) { firstFace.current = false; return undefined; }
    if (reduced) return undefined;
    setTurning(true);
    const timer = setTimeout(() => setTurning(false), TURN_MS);
    return () => clearTimeout(timer);
  }, [faceKey, reduced]);
  // A delayed seat stays in layout while temporarily noninteractive.
  const shown: DockSeat | null = showing.kind === 'confirm'
    ? null
    : numb && seat ? { ...seat, act: null } : seat;
  // Oversight status appears only on a face backed by an active session.
  const showAllow = view.allowAll === true && showing.kind === 'plain' && !keylessSleep(view, ctx);

  const card = (
    <DockCard
      face={showing}
      seat={shown}
      gear={connected && !managing}
      allowAll={showAllow}
      reduced={reduced}
      t={t}
      onSeat={(act) => {
        if (act === 'pause') onPause?.();
        // Stop first opens the dock-card confirmation.
        else if (act === 'stop') setAsking(true);
        else if (act === 'resume') onResume?.();
      }}
      onManage={onManage}
      onConfirmStop={() => { setAsking(false); onStop?.(); }}
      onCancelStop={() => setAsking(false)}
      onRetryNow={onRetryNow}
      onDockAct={onDockAct}
    />
  );

  return (
    <div
      data-testid="desk-header"
      onPointerEnter={() => setReading(true)}
      onPointerLeave={() => setReading(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: DESK_GAP,
        flex: '0 0 auto',
        // Perspective belongs to the card's untransformed parent.
        perspective: `${PERSPECTIVE}px`,
      }}
    >
      <div
        data-testid="desk-header-char-slot"
        style={{
          width: CHARACTER_SEAT.w,
          height: CHARACTER_SEAT.h,
          flex: '0 0 auto',
          position: 'relative',
        }}
      >
        {characterSlot
          ?? <Character pose={pose ?? dockPose(view, ctx) ?? poseForPhase(view.phase, { connected })} size={56} />}
      </div>
      {/* Face changes run sequentially; reduced motion renders the incoming state immediately. */}
      {reduced ? card : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={faceKey}
            style={{
              display: 'flex', flex: 1, minWidth: 0,
              // Hide the reverse face if a future curve overshoots beyond ninety degrees.
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              ...(turning ? { pointerEvents: 'none' as const } : {}),
            }}
            initial={{ rotateX: 90 }}
            animate={{ rotateX: [90, -FLIP_OVERSHOOT, 0] }}
            exit={{ rotateX: -90, transition: outMotion('panel.dock.flip') }}
            transition={flipProfile('panel.dock.flip')}
          >
            {card}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

/* ── the faces ────────────────────────────────────────────── */

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Highest-priority transient detail for a running job: a refusal, queued guidance or live helper.
 * Each source clears itself when the condition ends, so the dock cannot retain stale status.
 */
function runningSub(view: PanelView, ctx: DockContext, t: T): string | undefined {
  if (!RUNNING.has(view.phase)) return undefined;
  // Only a settled operation can supply a result for the running-status line.
  const settledOp = [...(view.current?.ops ?? [])].reverse()
    .find((op) => op.status !== 'run' && op.status !== 'pending-gate');
  if (settledOp?.status === 'blocked') return t('agent3.dock_region_held');
  const queued = view.queuedSteers.length;
  if (queued === 1) return t('agent3.dock_steer_next');
  if (queued > 1) return t('agent3.dock_steers_queued', { n: queued });
  if (ctx.helper === true) return t('agent3.dock_helper');
  const playbook = dockSkill(view.current);
  if (playbook !== undefined) return t('agent3.dock_playbook', { title: playbook });
  if (ctx.unsaved === true) return t('agent3.dock_unsaved');
  return undefined;
}

/** Returns option, plan-stage or cell count for the open gate without repeating its question. */
function gateSize(view: PanelView, ctx: DockContext, t: T): string | undefined {
  const open = view.gate;
  if (!open) return undefined;
  const ask = openAsk(view);
  const options = ask?.options?.length ?? 0;
  if (options > 0) return t(options === 1 ? 'agent3.dock_options_one' : 'agent3.dock_options', { n: options });
  if (open.scope === 'plan') {
    const stages = ask?.stages?.length;
    return stages !== undefined && stages > 0
      ? t(stages === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: stages })
      : undefined;
  }
  return ctx.gateCells === undefined ? undefined : t('agent3.ticket_stage_cells', { n: ctx.gateCells });
}

/** Returns the ask record associated with the currently open gate. */
function openAsk(view: PanelView): AskRecord | undefined {
  const gate = view.gate;
  return gate === undefined ? undefined : view.current?.asks.find((ask) => ask.gateId === gate.gateId);
}

/** Returns the newest style skill, or the newest skill when no style is loaded. */
function dockSkill(job: JobView | undefined): string | undefined {
  const skills = job?.skills ?? [];
  const styles = skills.filter((skill) => skill.kind === 'style');
  return (styles.length > 0 ? styles[styles.length - 1] : skills[skills.length - 1])?.title;
}

/** Provider-stream phases eligible for silence detection; local tool execution is excluded. */
const AWAITING_STREAM: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['thinking', 'streaming']);

/** The state's own card, as data: what the four seats hold. */
function buildFace(view: PanelView, ctx: DockContext, now: number, activeAt: number, t: T): Face {
  const paper = dockPaper(view, ctx);
  const glyph = dockGlyph(view, ctx);
  /** Filing hides completed records but not capped jobs or standing questions. */
  const settledNow = settledKind(view);
  const settled = ctx.recordFiled === true && !OWED_AFTER_FILING.has(settledNow.kind)
    ? { kind: 'none' as const }
    : settledNow;

  if (ctx.marking !== undefined) {
    // Marking copy distinguishes the invitation from a completed paint stroke.
    return {
      kind: 'plain', paper, glyph, word: t('agent3.dock_marking'),
      meta: t(ctx.marking === 'painted' ? 'agent3.dock_marking_down' : 'agent3.dock_marking_sub'),
    };
  }

  if (ctx.managing === true) {
    return {
      kind: 'plain', paper, glyph, word: t('agent3.dock_connection'),
      ...(ctx.connectionMeta ? { meta: ctx.connectionMeta } : {}),
    };
  }

  if (ctx.reading !== undefined) {
    return {
      kind: 'plain', paper, glyph, word: t('agent3.dock_reading_record'),
      ...(ctx.reading === '' ? {} : { meta: ctx.reading }),
    };
  }

  const setupStep = setupFaceOf(view, ctx);
  if (setupStep) {
    const row = SETUP_FACE[setupStep.step];
    const params = { name: setupStep.name ?? '' };
    // Steps without fixed metadata report their contextual name.
    const meta = row.meta ? t(row.meta, params) : setupStep.name;
    return { kind: 'plain', paper, glyph, word: t(row.word, params), ...(meta ? { meta } : {}) };
  }

  if (keylessSleep(view, ctx)) {
    return { kind: 'plain', paper, glyph, word: t('agent3.dock_disconnected'), meta: t('agent3.dock_no_key') };
  }

  // Network retries wait for connectivity and use an untimed action; other retries show their backoff.
  if (view.phase === 'retrying' && view.retry) {
    const { attempt, cls, delayMs, since } = view.retry;
    const remaining = Math.max(0, since + delayMs - now);
    return {
      kind: 'retry',
      paper,
      glyph,
      word: t(RETRY_WORD[cls]),
      datum: t('agent3.dock_try_of', { n: attempt, m: MAX_TURN_RETRIES }),
      retry: {
        secs: Math.ceil(remaining / 1000),
        spent: delayMs > 0 ? Math.min(1, Math.max(0, 1 - remaining / delayMs)) : 1,
        spanMs: delayMs,
        timed: cls !== 'network' && delayMs > 0,
      },
    };
  }

  // Terminal faces reserve the second line for their repair action.
  if (view.phase === 'incident') {
    const cls = settled.job?.errorCls ?? 'unknown';
    // Any keyless incident must restore a key before retrying.
    const act = ctx.connected === false ? ERROR_ACT.auth : ERROR_ACT[cls];
    // Key failures report the provider; model failures report the model.
    const datum = cls === 'auth'
      ? ctx.providerName
      : cls === 'model' ? ctx.modelName
        : EXHAUSTED.has(cls) ? t('agent3.dock_after_tries', { n: MAX_TURN_RETRIES }) : undefined;
    return {
      kind: 'act',
      paper,
      glyph,
      word: keyGone(view, ctx.connected !== false, cls) ? t('agent3.dock_err_key_missing') : t(ERROR_WORD[cls]),
      ...(datum ? { datum } : {}),
      act: { id: act.id, label: t(act.labelKey) },
    };
  }

  // Paused plans report completed stages; active plans report the current stage.
  const step = view.current?.plan
    ? view.phase === 'paused'
      ? t('agent3.dock_stage_of', { n: view.current.plan.doneCount, m: view.current.plan.stages.length })
      : t('agent3.dock_step_of', { n: view.current.plan.doneCount + 1, m: view.current.plan.stages.length })
    : undefined;
  /** Reports remaining stages from the settled capped job's retained plan. */
  const cappedPlan = settled.job?.plan;
  const left = cappedPlan ? Math.max(0, cappedPlan.stages.length - cappedPlan.doneCount) : 0;
  const stagesLeft = left > 0
    ? t(left === 1 ? 'agent3.dock_stage_left_one' : 'agent3.dock_stages_left', { n: left })
    : undefined;
  const onMap = ctx.mapName ? t('agent3.dock_on_map', { name: ctx.mapName }) : undefined;

  /** Active clocks use now; settled clocks end at the final recorded event. */
  const running = RUNNING.has(view.phase) || view.phase === 'gated' || view.phase === 'pausing';
  const anchor = view.phase === 'aborted' ? settled.job : view.current;
  // Restored offers omit elapsed time because their persisted timestamps do not preserve a reliable span.
  const clock = anchor && ctx.heldOffer !== true
    ? fmtClock(((running ? now : view.lastEventAt) - anchor.orderAt) / 1000) ?? undefined
    : undefined;

  if (view.phase === 'idle') {
    const face: Face = { kind: 'plain', paper, glyph, word: t('agent3.dock_idle') };
    switch (settled.kind) {
      case 'build': {
        const edits = editCount(settled.job!);
        return {
          ...face,
          word: t('agent3.dock_done'),
          // Zero applied edits use a state description instead of a misleading count.
          meta: edits === 0
            ? t('agent3.dock_no_edits')
            : t(edits === 1 ? 'agent3.history_edits_one' : 'agent3.history_edits', { n: edits }),
        };
      }
      case 'answer': {
        // Zero reads use the same unchanged-map description as zero edits.
        const n = readCount(settled.job!);
        return {
          ...face,
          word: t('agent3.dock_answered'),
          meta: n === 0
            ? t('agent3.dock_no_edits')
            : t(n === 1 ? 'agent3.dock_reads_one' : 'agent3.dock_reads', { n }),
        };
      }
      case 'quiet':
        return { ...face, word: t('agent3.dock_ended'), meta: t('agent3.dock_nothing_said') };
      case 'capped':
        return {
          ...face,
          word: t('agent3.dock_capped'),
          ...(stagesLeft ? { meta: stagesLeft } : onMap ? { meta: onMap } : {}),
        };
      case 'question': {
        // A trailing question follows completed work; a question with no edits remains blocking.
        const edits = editCount(settled.job!);
        if (edits > 0) {
          return { ...face, word: t('agent3.dock_done'), meta: t('agent3.dock_one_question') };
        }
        return { ...face, word: t('agent3.dock_gated') };
      }
      default:
        // A set-aside storage notice takes priority over the ordinary map-name metadata.
        return { ...face, ...(ctx.setAside ? { meta: t('agent3.dock_set_aside') } : onMap ? { meta: onMap } : {}) };
    }
  }

  /** Silence uses the last observed stream activity and repaints without changing face identity. */
  const silence = AWAITING_STREAM.has(view.phase) ? now - activeAt : 0;
  const stalled = silence >= STALL_MS;
  const stallClock = stalled ? fmtClock(silence / 1000) : null;
  /** Whether the current hold immediately follows a declined call. */
  const heldAtSkip = view.phase === 'paused'
    && view.current?.ops[view.current.ops.length - 1]?.status === 'skipped';
  /** Whether the open gate presents selectable option cards. */
  const picking = view.phase === 'gated' && (openAsk(view)?.options?.length ?? 0) > 0;
  const word = stalled
    ? t('agent3.dock_still_thinking')
    : picking ? t('agent3.dock_pick_one')
    // Restored holds describe their saved position instead of a live pause action.
    : ctx.heldOffer === true && view.phase === 'paused' ? t('agent3.dock_stopped_partway')
      : heldAtSkip ? t('agent3.dock_holding') : t(WORD_FOR_PHASE[view.phase]);
  const thought = view.current?.thought;
  /** A paused job can retain an unanswered ask even though view.gate is absent outside gated. */
  const heldQuestion = view.phase === 'paused'
    && view.current?.asks.some((ask) => ask.verdict === undefined) === true;
  // Gate metadata reports extent while the ask card carries the full question.
  const meta = view.phase === 'gated'
    ? gateSize(view, ctx, t)
    : view.phase === 'aborted'
      ? (settled.job && editCount(settled.job) > 0 ? t('agent3.dock_edits_kept') : onMap)
      // Pending pause status replaces a disabled resume control.
      : view.phase === 'pausing'
        ? t('agent3.dock_resume_pending')
        // An unanswered held question takes priority over the plan-stage count.
        : heldQuestion
          ? t('agent3.dock_question_held')
          // A decline supplies the held job's immediate cause.
          : heldAtSkip
            ? t('agent3.dock_skipped')
            // Stream silence takes priority over other running details.
            : stallClock !== null
              ? t('agent3.dock_stall', { t: stallClock })
              : runningSub(view, ctx, t)
                ?? (thought && (view.phase === 'thinking' || view.phase === 'streaming')
                  // Thought totals count turns, not streaming character bytes.
                  ? t(thought.turns === 1 ? 'agent3.dock_thoughts_one' : 'agent3.dock_thoughts', { n: thought.turns })
                  : step);

  // Keep the ticking stall value in its own text node between stable translated fragments.
  const [stallHead, stallTail] = splitOnToken(t('agent3.dock_stall'), '{t}');
  const stall = stallClock !== null
    ? { prefix: stallHead, suffix: stallTail, clock: stallClock }
    : undefined;

  return {
    kind: 'plain', paper, glyph, word,
    ...(meta ? { meta } : {}),
    ...(stall ? { stall } : {}),
    ...(clock ? { clock } : {}),
  };
}

/* ── the card ─────────────────────────────────────────────── */

const GLYPH_SLOT: CSSProperties = {
  width: 28, height: 28, flex: '0 0 auto', display: 'flex',
  alignItems: 'center', justifyContent: 'center', color: 'inherit', opacity: 0.9,
};

/** Out-of-flow beta tag at the dock card's top-left corner. */
const BETA_TAG: CSSProperties = {
  ...roleFont('small'),
  position: 'absolute', top: 6, left: 14,
  lineHeight: 1, letterSpacing: 0.5,
  color: 'inherit', opacity: 0.45,
  pointerEvents: 'none', userSelect: 'none',
};

/** Primary dock-card line. */
const WORD_STYLE: CSSProperties = {
  ...roleFont('menu'),
  fontFamily: font.family,
  color: 'inherit',
  lineHeight: 1.25,
  marginRight: 'auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Ellipsizing text fragment that preserves translated whitespace beside a separate value node. */
const CLIPPED: CSSProperties = {
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre',
};

const META_STYLE: CSSProperties = {
  ...roleFont('caption'),
  fontFamily: font.family,
  lineHeight: 1.25,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

/** Trailing datum keeps its width and ellipsizes only when it exceeds the entire word deck. */
const DATUM_STYLE: CSSProperties = {
  ...roleFont('caption'),
  fontFamily: font.family,
  color: metaInk.figure,
  flex: '0 0 auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginLeft: 6,
  fontVariantNumeric: 'tabular-nums',
};

/** Dock actions use the shared inset window-pill treatment. */
const ACT_PILL: CSSProperties = { ...windowPill('quiet', false, 'inset'), boxShadow: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 };

/** Caps translated action copy within the dock's word deck. */
const BOUND_PILL: CSSProperties = { ...ACT_PILL, maxWidth: '100%', minWidth: 0 };

/** How far a fresh countdown digit rises from, per its declaration. */
const DIGIT_RISE = amplitude('panel.retry.digit') ?? 0;

/** Splits a translation template around a live-value placeholder; missing tokens leave one prefix. */
function splitOnToken(template: string, token: string): [string, string] {
  const i = template.indexOf(token);
  return i < 0 ? [template, ''] : [template.slice(0, i), template.slice(i + token.length)];
}

interface DockCardProps {
  face: Face;
  seat: DockSeat | null;
  gear: boolean;
  allowAll: boolean;
  reduced: boolean;
  t: T;
  onSeat(act: 'pause' | 'stop' | 'resume'): void;
  onManage?: () => void;
  onConfirmStop(): void;
  onCancelStop(): void;
  onRetryNow?: () => void;
  onDockAct?: (act: DockActId) => void;
}

function DockCard({
  face, seat, gear, allowAll, reduced, t,
  onSeat, onManage, onConfirmStop, onCancelStop, onRetryNow, onDockAct,
}: DockCardProps) {
  const ink = face.paper === 'danger' ? colors.dangerDeep : INK;
  const factInk = face.paper === 'danger' ? metaInk.danger : metaInk.fact;
  // Action faces reserve their second line for controls rather than metadata.
  const acting = face.kind !== 'plain';
  const solo = !acting && face.meta === undefined && !allowAll;

  return (
    <div
      data-testid="dock"
      data-paper={face.paper}
      data-face={face.kind}
      data-solo={String(solo)}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        height: DOCK_HEIGHT,
        boxSizing: 'border-box',
        borderRadius: 12,
        padding: '0 8px 0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflow: 'hidden',
        color: ink,
        background: statePaper[face.paper],
        // CSS owns the in-place paper crossfade and the global reduced-motion override.
        transition: cssMotion('panel.dock.paper', ['background-color'], reduced),
      }}
    >
      <span data-testid="dock-beta" aria-hidden="true" style={BETA_TAG}>{t('agent3.beta_tag')}</span>

      <span data-testid="dock-glyph" data-icon={face.glyph} style={GLYPH_SLOT}>
        <Icon id={face.glyph} size={20} />
      </span>

      <div
        data-testid="dock-col-words"
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          // Border-box keeps vertical padding within the fixed dock height.
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: acting ? 'flex-start' : 'center',
          // Confirmation pills sit two pixels lower because they have no external retry ring.
          paddingTop: face.kind === 'confirm' ? 12 : acting ? 10 : 0,
        }}
      >
        <div data-testid="dock-deck-word" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span data-testid="dock-sentence" style={WORD_STYLE}>{face.word}</span>
          {face.datum !== undefined && (
            <span data-testid="dock-datum" style={DATUM_STYLE}>{face.datum}</span>
          )}
          {/* On a solo face the clock steps up beside the word, where the meta line would have been. */}
          {solo && face.clock !== undefined && <Elapsed text={face.clock} />}
        </div>

        {!solo && (
          <div
            data-testid="dock-deck-meta"
            style={{
              display: 'flex', alignItems: 'center', minWidth: 0,
              // Confirmation answers use a slightly wider line gap than single actions.
              marginTop: face.kind === 'confirm' ? 8 : acting ? 7 : 2,
              color: factInk, ...META_STYLE,
            }}
          >
            {face.kind === 'retry' && face.retry && (
              <RetryPill retry={face.retry} t={t} reduced={reduced} {...(onRetryNow ? { onRetryNow } : {})} />
            )}
            {face.kind === 'act' && face.act && (
              <Pill
                variant="quiet"
                on="inset"
                data-testid="dock-act"
                onClick={() => onDockAct?.(face.act!.id)}
              >
                {face.act.label}
              </Pill>
            )}
            {face.kind === 'confirm' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill variant="danger" data-testid="dock-confirm-stop" onClick={onConfirmStop}>
                  {t('agent3.action_stop')}
                </Pill>
                <Pill variant="quiet" on="inset" data-testid="dock-confirm-cancel" onClick={onCancelStop}>
                  {t('agent3.action_cancel')}
                </Pill>
              </span>
            )}
            {face.kind === 'plain' && (
              <>
                {/* The stall time keeps its own fixed-width leaf while translated fragments ellipsize around it. */}
                {face.stall ? (
                  <span
                    data-testid="dock-meta"
                    style={{ display: 'flex', minWidth: 0, marginRight: 'auto' }}
                  >
                    <span style={CLIPPED}>{face.stall.prefix}</span>
                    <span data-testid="dock-stall-clock" style={{ flex: '0 0 auto' }}>
                      {face.stall.clock}
                    </span>
                    <span style={CLIPPED}>{face.stall.suffix}</span>
                  </span>
                ) : face.meta !== undefined && (
                  <span
                    data-testid="dock-meta"
                    style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', marginRight: 'auto' }}
                  >
                    {face.meta}
                  </span>
                )}
                {/* Session-wide oversight status shares the line and can ellipsize beside state metadata. */}
                {allowAll && (
                  <span
                    data-testid="dock-allow-mark"
                    style={{
                      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginLeft: face.meta !== undefined || face.stall !== undefined ? 6 : 0,
                      marginRight: 'auto', opacity: 0.75,
                    }}
                  >
                    {t('agent3.dock_asks_off')}
                  </span>
                )}
                {face.clock !== undefined && <Elapsed text={face.clock} />}
              </>
            )}
          </div>
        )}
      </div>

      <span
        data-testid="dock-col"
        style={{
          alignSelf: 'stretch', flex: '0 0 auto', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {seat ? (
          <IconButton
            testId="dock-seat"
            icon={seat.icon}
            label={t(seat.labelKey)}
            data-act={seat.act ?? undefined}
            disabled={seat.act === null}
            {...(seat.act ? { onClick: () => onSeat(seat.act!) } : {})}
          />
        ) : (
          <Ghost />
        )}
        {gear ? (
          <IconButton
            testId="dock-gear"
            icon="pw-settings"
            label={t('agent3.dock_manage')}
            data-act="manage"
            door
            // Standalone mounts without a management callback render the gear disabled.
            disabled={onManage === undefined}
            {...(onManage ? { onClick: onManage } : {})}
          />
        ) : (
          <Ghost />
        )}
      </span>
    </div>
  );
}

/** Isolates the elapsed value so a tick replaces one text leaf. */
function Elapsed({ text }: { text: string }) {
  return (
    <span
      data-testid="dock-elapsed"
      style={{ ...roleFont('caption'), fontFamily: font.family, color: metaInk.figure, flex: '0 0 auto', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}
    >
      {text}
    </span>
  );
}

/** The seat that is empty, holding its own space so the column's other control never moves. */
function Ghost() {
  return <span aria-hidden style={{ width: 28, height: 28, flex: '0 0 auto', visibility: 'hidden' }} />;
}


/** Renders timed retry progress from the loop, or a plain action for connectivity-gated retry. */
function RetryPill(
  { retry, t, reduced, onRetryNow }:
  { retry: NonNullable<Face['retry']>; t: T; reduced: boolean; onRetryNow?: () => void },
) {
  if (!retry.timed) {
    return (
      <Pill variant="quiet" on="inset" data-testid="dock-retry-pill" onClick={() => onRetryNow?.()}>
        {t('agent3.action_retry_now')}
      </Pill>
    );
  }
  const [prefix, suffix] = splitOnToken(t('agent3.dock_retrying'), '{s}');
  // A spent retry ring is already fired and no longer accepts input.
  const fired = retry.spent >= 1;
  return (
    <TimedButton
      after={retry.secs}
      // Bound the translated label within the deck; spanMs interpolates between one-second samples.
      external={{ fraction: retry.spent, spanMs: retry.spanMs }}
      onPress={() => { if (!fired) onRetryNow?.(); }}
      data-testid="dock-retry-pill"
      style={fired ? { ...BOUND_PILL, pointerEvents: 'none' } : BOUND_PILL}
    >
      {/* Static sentence fragments ellipsize around the fixed-width countdown value. */}
      <span style={{ display: 'flex', minWidth: 0 }}>
        <span style={CLIPPED}>{prefix}</span>
        <b style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', display: 'inline-block', flex: '0 0 auto' }}>
          {/* Keying by value mounts one clipped upward roll per countdown second. */}
          <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}>
            <motion.span
              key={retry.secs}
              data-testid="retry-seconds"
              style={{ display: 'inline-block' }}
              initial={reduced ? false : { y: DIGIT_RISE, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={framerMotion('panel.retry.digit')}
            >
              {retry.secs}
            </motion.span>
          </span>
        </b>
        <span style={CLIPPED}>{suffix}</span>
      </span>
    </TimedButton>
  );
}
