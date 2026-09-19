/*
 * Assembles the assistant panel's desk, record, steering and composer zones from PanelView.
 * Character-seat ancestors remain untransformed because the fixed character uses their measured rectangles.
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import {
  motion, useMotionValue, useReducedMotionConfig, useTransform, type Variants,
} from 'framer-motion';
import { composerRoute } from '../../agent/session/composer-routing';
import type { AskRecord, JobView, PanelView, SessionPhase } from '../../agent/core/project-view';
import type { GateOption, JobOutcome } from '../../agent/core/types';
import { useT } from '../../i18n/context';
import { helpTargetAttr } from '../chrome/modals/help/targets';
import { PLATE, PLATE_INK } from '../design/tokens';
import { radii } from '../design/styles';
import { useFollowNewest } from './use-follow-newest';
import { AnswerPaper, isAnswerJob } from './AnswerPaper';
import { IconButton, PIN_KNOB, PIN_KNOB_OUT, PinKnob, Pill, RESUME_PRIMARY } from './atoms';
import { Banner, type BannerActionId, type BannerClass } from './Banner';
import { ArchiveCard, FlipTicket, IncidentCard, StopCard, type Checkpoint } from './FlipTicket';
import { Composer, COMPOSER_HEIGHT } from './Composer';
import { CHIP_VIGNETTE, RegionButton, RegionChip, TICKET_VIGNETTE } from './region-chip';
import { DeskHeader, DOCK_HEIGHT, keyGone, type DockActId } from './DeskHeader';
import { AskDeck, deckRuns } from './AskDeck';
import { GateBlock } from './GateBlock';
import { OptionPick, optionAskFrom } from './OptionPick';
import { PlanGate } from './PlanGate';
import { HistoryStrip } from './HistoryStrip';
import { IconSprite } from './icons';
import { JobTicket, jobStamps, pausedWhere } from './JobTicket';
import { ResumeCard } from './ResumeCard';
import { SteerQueue } from './SteerQueue';
import type { LaneView } from './Lane';
import type { RegionBounds } from '../../state/region-bounds';
import { edge, PANEL_MIN_HEIGHT, PANEL_PAD, PANEL_WIDTH } from './tokens';
import { DOCK_CHROME, DOCK_CHROME_FILE_H, DOCK_CHROME_W, type DockSide } from '../shell/panel-frame';
import { fmtClock, useSecondClock } from './dock-face';
import { easingCss, framerMotion, seconds } from './motion';
import { SetupScreen } from './SetupScreen';
import { DreamOffice } from './DreamOffice';
import { getCharacterHandle } from './character/Character';
import { setDeskSeat, setPanelCarriage } from './character/seat';
import { useUiPreviewPose } from '../primitives/ui-preview';
import { ManageScreen } from './ManageScreen';
import type { LiveConnection } from '../../agent/exec/runner';
import type { SetupEntry, SetupFace } from './setup-parts';
import { windowPill } from '../design/window-skin';
import { useScrollFade } from '../primitives/scroll-fade';
import { useViewportEpoch } from '../hooks/use-viewport-epoch';
import { useCelebrateEdge } from './character/use-celebrate-edge';

/**
 * Panel entry uses clip-path instead of transforms so the fixed character keeps its containing block.
 * Four-component insets keep browser interpolation stable between the seed, open and docked shapes.
 */
/** Floating plate radius in frame pixels, shared by its border, wipe and dock-knob placement. */
export const PANEL_RADIUS = 28;

const WIPE_SEED = `inset(0% 92% 92% 0% round ${PANEL_RADIUS}px)`;
const WIPE_OPEN = `inset(0% -1% -1% 0% round ${PANEL_RADIUS}px)`;
const WIPE_GROUND = 'inset(0% -1% -1% 0%)';

/** Carries the external dock knob along the plate's animated inset, accepting every CSS inset arity. */
export function knobCarry(clip: string): { x: number; y: number; scale: number } {
  const inset = /inset\(([^)]*)\)/.exec(clip)?.[1];
  if (inset === undefined) return { x: 0, y: 0, scale: 1 };
  const edges = (inset.split('round')[0] ?? '').trim().split(/\s+/).map((v) => parseFloat(v));
  const right = Math.max(0, (edges.length > 1 ? edges[1] : edges[0]) ?? 0) / 100;
  const bottom = Math.max(0, (edges.length > 2 ? edges[2] : edges[0]) ?? 0) / 100;
  return {
    x: 0 - PANEL_WIDTH * right,
    y: 0 - (PANEL_RADIUS + PIN_KNOB.size / 2) * bottom,
    scale: 1 - right,
  };
}

/** The holder owns opacity while the plate owns the matching clip-path wipe. */
export const panelVariants: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1 },
  ground: { opacity: 1 },
  gone: { opacity: 0, transition: framerMotion('panel.close') },
};

export const plateVariants: Variants = {
  hidden: { clipPath: WIPE_SEED },
  shown: { clipPath: WIPE_OPEN },
  ground: { clipPath: WIPE_GROUND },
  gone: { clipPath: WIPE_SEED, transition: framerMotion('panel.close') },
};

/** Docked plates are immediately square and opaque; the surrounding sheet supplies their entrance. */
const REVEALED = { type: false } as const;

/** Phases whose dock face shows a ticking elapsed time or countdown. */
const TICKING: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'thinking', 'streaming', 'executing', 'gated', 'pausing', 'retrying',
]);

/** Phases in which the composer has no running job to stop. */
const AT_REST: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['idle', 'paused', 'aborted', 'incident']);

/** Open-job phases that freeze the ticket's progress tape. */
const HELD: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'gated', 'retrying', 'pausing', 'paused',
]);

/** Phases with landed pause controls. */
const ON_HOLD: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['paused']);

/**
 * Animates committed CSS heights without transforming the fixed character's containing block.
 * First paint, reduced motion and viewport changes establish a new baseline immediately.
 */
function useHeightTween(
  ref: RefObject<HTMLElement | null>, shape: unknown, reduced: boolean, viewport: string,
): void {
  const painted = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  const room = useRef(viewport);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reroomed = room.current !== viewport;
    room.current = viewport;
    // Only a running animation still owns the displayed height.
    const live = running.current;
    const held = live !== null && live.playState === 'running';
    const from = held ? el.offsetHeight : painted.current;
    live?.cancel();
    running.current = null;
    const to = el.offsetHeight;
    painted.current = to;
    if (from === null || reduced || reroomed || Math.abs(to - from) < 1) return;
    if (typeof el.animate !== 'function') return; // jsdom, and any engine without Web Animations
    running.current = el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: seconds('panel.height') * 1000, easing: easingCss('panel.height') },
    );
  }, [ref, shape, reduced, viewport]);
  useLayoutEffect(() => () => { running.current?.cancel(); }, []);
}

/** Gap between panel zones in frame pixels. */
const ZONE_GAP = 10;

/** How many gaps stand between the four zones. */
const ZONE_GAPS = 3;

/** Height reserved for the fixed desk, composer, gaps and plate padding. */
export const PINNED_HEIGHT = PANEL_PAD * 2 + DOCK_HEIGHT + COMPOSER_HEIGHT + ZONE_GAP * ZONE_GAPS;


/** Returns the height occupied by the first ticket heading currently stuck to the zone's top edge. */
function stickyBand(zone: HTMLElement): number {
  const top = zone.getBoundingClientRect().top;
  for (const order of zone.querySelectorAll('[data-testid="ticket-order"]')) {
    const box = order.getBoundingClientRect();
    // Ignore headings that have not reached the edge or have already scrolled past it.
    if (box.bottom <= top || box.top > top + 1) continue;
    return Math.max(0, box.bottom - top);
  }
  return 0;
}

/** Unpainted positioning box shared by the plate and its external dock tab. */
const PLATE_HOLDER: CSSProperties = { position: 'relative', display: 'flex' };

/** Individual border and padding properties let React restore every edge after docking overrides. */
const PANEL_STYLE: CSSProperties = {
  width: PANEL_WIDTH,
  boxSizing: 'border-box',
  background: PLATE,
  borderTop: edge,
  borderRight: edge,
  borderBottom: edge,
  borderLeft: edge,
  borderRadius: PANEL_RADIUS,
  paddingTop: PANEL_PAD,
  paddingRight: PANEL_PAD,
  paddingBottom: PANEL_PAD,
  paddingLeft: PANEL_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: ZONE_GAP,
  color: PLATE_INK,
  minHeight: PANEL_MIN_HEIGHT,
  overflow: 'hidden',
};

/** Docked plates fill the available height, square their corners and retain only the sheet seam. */
function dockedStyle(cap: string | undefined, side: DockSide): CSSProperties {
  const atSeam = side === 'left' ? 'right' : 'left';
  return {
    ...PANEL_STYLE,
    width: PANEL_WIDTH + DOCK_CHROME_W,
    minHeight: 0,
    height: cap ?? '100%',
    maxHeight: cap ?? '100%',
    borderRadius: radii.none,
    borderTop: '0',
    borderBottom: '0',
    borderLeft: atSeam === 'left' ? edge : '0',
    borderRight: atSeam === 'right' ? edge : '0',
  };
}

function panelStyle(cap: string | undefined, hug: boolean): CSSProperties {
  // Setup and management forms hug their content while remaining bounded by the available height.
  if (hug) return { ...PANEL_STYLE, minHeight: 0, ...(cap === undefined ? null : { maxHeight: cap }) };
  if (cap === undefined) return PANEL_STYLE;
  return { ...PANEL_STYLE, maxHeight: cap, minHeight: `min(${PANEL_MIN_HEIGHT}px, ${cap})` };
}

/** The record is the only scrolling zone; side gutters contain scaled hover feedback inside its clip. */
const JOB_ZONE_STYLE: CSSProperties = {
  // Grow as well as shrink so unused panel height keeps the composer on the bottom edge.
  flex: '1 1 auto',
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '1px 6px',
  margin: '0 -5px',
  // Stable gutters create permanent asymmetric padding on classic scrollbars. Native scroll
  // anchoring also conflicts with useFollowNewest's explicit ownership of the scroll position.
  overflowAnchor: 'none',
};

/** Shared empty deck state preserves referential stability across mounts. */
const NO_DECKS: ReadonlySet<string> = new Set();

/** Minimum useful record height in frame pixels. */
export const JOB_ZONE_FLOOR = 72;

/** Readable height for the largest plan gate; the panel may borrow this room from the bottom bar. */
const PLAN_GATE_ROOM = 419;

/** Extra height needed beyond the record floor to show the largest plan gate. */
export const GATE_BORROW = Math.max(0, PLAN_GATE_ROOM - JOB_ZONE_FLOOR);

/**
 * Caps the record floor at the height left after the fixed desk and composer. Closed-history rest
 * states waive the floor, and uncapped standalone mounts use the full default.
 */
function jobZoneFloor(cap: string | undefined, waived: boolean): string | number {
  if (waived) return 0;
  if (cap === undefined) return JOB_ZONE_FLOOR;
  return `min(${JOB_ZONE_FLOOR}px, max(0px, calc(${cap} - ${PINNED_HEIGHT}px)))`;
}

/** Settled jobs whose first checkpoint is at or above the current undo depth. */
function rolledBackSeqs(jobs: readonly JobView[], undoDepth: number | undefined): ReadonlySet<number> {
  if (undoDepth === undefined) return new Set();
  const out = new Set<number>();
  for (const job of jobs) {
    const first = job.checkpoints[0];
    if (first !== undefined && undoDepth <= first.undoIndex) out.add(job.orderSeq);
  }
  return out;
}

/** Outcomes that retain a terminal card. */
const CARDED: ReadonlySet<JobOutcome> = new Set<JobOutcome>(['done', 'capped', 'aborted', 'incident']);

/** Which of the terminal family's cards a settled job earns. */
type TerminalShape = 'paper' | 'stop' | 'receipt' | 'stalled';

/** Duration from the job order to the session's final recorded event. */
function clockOf(view: PanelView, job: JobView): string | null {
  return fmtClock((view.lastEventAt - job.orderAt) / 1000);
}

/** Chooses the visible terminal card for the newest unfiled, settled job. */
function terminal(
  view: PanelView, filed: ReadonlySet<number>, held?: JobView,
): { job: JobView; shape: TerminalShape } | null {
  if (view.current) return null;
  const job = view.jobs[view.jobs.length - 1];
  if (!job || job.outcome === undefined || !CARDED.has(job.outcome)) return null;
  if (filed.has(job.orderSeq)) return null;
  // A held offer replaces the terminal card for the same job.
  if (held !== undefined && job === held) return null;
  const shape: TerminalShape = job.outcome === 'aborted'
    ? 'stop'
    : job.outcome === 'incident'
      ? 'stalled'
      : isAnswerJob(job) ? 'paper' : 'receipt';
  return { job, shape };
}

/** Shared layout for hold controls whether they follow a ticket or an ask. */
const HOLD_ACTIONS_STYLE: CSSProperties = { display: 'flex', gap: 8, flex: '0 0 auto' };

/** No records filed, for a caller that keeps no such marks. */
const NONE_FILED: ReadonlySet<number> = new Set();

/** Composer guidance and disabled state for faults that require a specific repair. */
const COMPOSER_BLOCKED: Partial<Record<BannerClass, { key: string; off: boolean }>> = {
  auth: { key: 'agent3.composer_blocked_key', off: true },
  'key-cleared': { key: 'agent3.composer_disconnected', off: true },
  quota: { key: 'agent3.composer_blocked_provider', off: true },
  cors: { key: 'agent3.composer_blocked_endpoint', off: true },
  // The address is fine and the model is not, so the instruction is the model rather than the URL.
  model: { key: 'agent3.composer_blocked_model', off: true },
  network: { key: 'agent3.composer_blocked_waiting', off: true },
  overloaded: { key: 'agent3.composer_blocked_waiting', off: true },
  'rate-limit': { key: 'agent3.composer_blocked_waiting', off: true },
  overflow: { key: 'agent3.composer_shorter', off: false },
};

/** Returns the active incident class and its job identity; -1 represents an incident without a job. */
function trouble(view: PanelView): { cls: BannerClass; seq: number } | null {
  if (view.phase !== 'incident') return null;
  const last = view.jobs[view.jobs.length - 1];
  return { cls: last?.errorCls ?? 'unknown', seq: last?.orderSeq ?? -1 };
}

export interface PanelShellProps {
  view: PanelView;
  /** Whether a credential is available. */
  connected: boolean;
  /** Whether the credential, endpoint and model form a usable connection. */
  ready?: boolean;
  /** Current map name for dock metadata. */
  mapName?: string;
  /** Armed provider display name. */
  providerName?: string;
  /** Armed model display name. */
  modelName?: string;
  /** Connection captured by the running job. */
  liveConnection?: LiveConnection;
  /** Runner activity; inferred from the phase when omitted. */
  running?: boolean;
  /** Live undo depth used to identify rolled-back jobs. */
  undoDepth?: number;
  /** Settled records filed into history. */
  filed?: ReadonlySet<number>;
  /** Session-storage health reported by the store. */
  storageNotice?: 'pruned' | 'lost' | 'corrupt' | null;
  onDismissStorage?(): void;
  /** Whether the session is an untouched restoration. */
  restored?: boolean;
  /** Settles and files a currently held job. */
  onSetAside?(orderSeq: number): void;
  /** Record identities removed from both the active card and history. */
  cleared?: ReadonlySet<number>;
  /** Records tied to another known map. */
  otherMap?: ReadonlySet<number>;
  /** Records with no map identity. */
  unknownMap?: ReadonlySet<number>;
  /** History record currently replacing the job zone. */
  openRecord?: number | null;
  /** Clock override used by deterministic mounts. */
  now?: number;
  /** Maximum height supplied by the surrounding frame. */
  maxHeight?: string;

  onSend(text: string): void;
  onStop(): void;
  onPause(): void;
  onResume?(): void;
  /** `words` carries a quick answer or selected option back as user guidance. */
  onGateAnswer(gateId: string, answer: 'allow' | 'skip' | 'words', words?: string): void;
  onRetryNow?(): void;
  onManage?(): void;
  managing?: boolean;
  connectionMeta?: string;
  jobCount?: number;
  onManageDone?(): void;
  onClearJobs?(): void;
  onDockAct?(act: DockActId): void;
  onRecallSteer?(steerSeq: number): void;
  onRewind?(checkpoint: Checkpoint): void;
  onFileAway?(orderSeq: number): void;
  onDropSuggestion?(): void;
  onBannerAction?(action: BannerActionId): void;
  onOpenTicket?(job: JobView): void;
  onCloseRecord?(): void;
  onClearRecord?(orderSeq: number): void;
  onRollBack?(job: JobView): void;
  onRewindAll?(job: JobView): void;
  onKeepGoing?(job: JobView): void;
  onSetupDone?(): void;
  /** Hides the panel without changing runner state. */
  onCollapse?(): void;

  /** Per-ask map thumbnail supplied by the renderer owner. */
  gateThumb?(ask: AskRecord): ReactNode;
  /** Per-option map thumbnail supplied by the renderer owner. */
  optionThumb?(option: GateOption): ReactNode;
  /** Ephemeral helper progress, kept outside the replayable PanelView. */
  lane?: LaneView;
  /** Live painted region. Running tickets retain their own captured JobView region. */
  region?: RegionBounds | null;
  /** Whether the map is currently selecting a region. */
  marking?: boolean;
  /** Cell count affected by the open gate. */
  gateCells?: number;
  onMarkRegion?(): void;
  onClearRegion?(): void;
  /** Captures a live map region at the requested size. */
  regionShot?(bounds: RegionBounds, width: number, height: number): ReactNode;
  /** Captures a settled build for its receipt. */
  recordShot?(job: JobView): ReactNode;
  recordStamp?(job: JobView): string;
  /** Optional idle sketch card, already rendered by the caller. */
  sketchbook?: ReactNode;
  /** External composer fill; seq distinguishes repeated identical text. */
  fill?: { text: string; seq: number };
  /** Whether CharacterHost owns the live character outside this tree. */
  hosted?: boolean;
  /** Whether the panel fills a side region instead of floating over the map. */
  pinned?: boolean;
  /** Dock side, read only while pinned. */
  dockSide?: DockSide;
  /** Intermediate dock-transition state; folded is hidden beneath the covering sheet. */
  away?: 'leaving' | 'folded';
  onTogglePin?(): void;
  onSwitchSide?(): void;
  /** Whether the current viewport is too narrow to dock. */
  pinBlocked?: boolean;
}

export function PanelShell({
  view,
  connected,
  ready = true,
  mapName,
  providerName,
  modelName,
  liveConnection,
  running,
  undoDepth,
  filed = NONE_FILED,
  cleared = NONE_FILED,
  otherMap,
  unknownMap,
  openRecord = null,
  now,
  maxHeight,
  onSend,
  onStop,
  onPause,
  onResume,
  onGateAnswer,
  onRetryNow,
  onManage,
  managing = false,
  connectionMeta,
  jobCount,
  onManageDone,
  onClearJobs,
  onDockAct,
  onRecallSteer,
  onRewind,
  onFileAway,
  onDropSuggestion,
  onBannerAction,
  storageNotice,
  onDismissStorage,
  restored = false,
  onSetAside,
  onOpenTicket,
  onCloseRecord,
  onClearRecord,
  onRollBack,
  onRewindAll,
  onKeepGoing,
  onSetupDone,
  onCollapse,
  gateThumb,
  optionThumb,
  lane,
  region = null,
  marking = false,
  gateCells,
  onMarkRegion,
  onClearRegion,
  regionShot,
  recordShot,
  recordStamp,
  sketchbook,
  fill,
  hosted = false,
  pinned = false,
  dockSide = 'left',
  away,
  onTogglePin,
  onSwitchSide,
  pinBlocked = false,
}: PanelShellProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  /** Help figures render the panel without taking ownership of live character seams. */
  const previewPose = useUiPreviewPose();
  const pictured = previewPose !== null;
  const rootRef = useRef<HTMLElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const jobZoneRef = useRef<HTMLDivElement>(null);
  /** One motion value drives both the plate clip and the dock knob's derived carry. */
  const wipe = useMotionValue(pinned ? WIPE_GROUND : reduced ? WIPE_OPEN : WIPE_SEED);
  const knobX = useTransform(wipe, (clip: string) => knobCarry(clip).x);
  const knobY = useTransform(wipe, (clip: string) => knobCarry(clip).y);
  const knobScale = useTransform(wipe, (clip: string) => knobCarry(clip).scale);
  const [dismissed, setDismissed] = useState<number | null>(null);
  /** Lost and pruned notices demote locally; corrupt data is cleared through the store action. */
  const [dismissedStorage, setDismissedStorage] = useState<'pruned' | 'lost' | null>(null);
  // Clearing the store notice re-arms any later failure of the same class.
  useEffect(() => { if (storageNotice !== 'lost' && storageNotice !== 'pruned') setDismissedStorage(null); }, [storageNotice]);
  /** Setup remains mounted through provider verification and model selection. */
  const [inSetup, setInSetup] = useState(false);
  /** Keeps an explicitly requested key field open across the key-clearing commit and refusals. */
  const askedForField = useRef(false);
  useEffect(() => { if (!connected) setInSetup((was) => was || askedForField.current); }, [connected]);
  // Persisted partial connections open setup unless the management screen already owns the zone.
  useEffect(() => { if (connected && !ready && !managing) setInSetup(true); }, [connected, ready, managing]);
  const showSetup = inSetup;
  /** Current job, or the newest settled job when the current seat is empty. */
  const owedJob = view.current ?? view.jobs[view.jobs.length - 1];
  /** A keyless session with an unfiled job keeps that job and its repair visible. */
  const keyCleared = owedJob !== undefined
    && keyGone(view, connected, owedJob.errorCls)
    && !filed.has(owedJob.orderSeq);
  /** Keyless rest state with no outstanding job. */
  const showWelcome = !connected && !inSetup && !keyCleared;
  const formOwnsZone = showSetup || showWelcome;
  /** Setup, welcome and management provide their own footer and suppress the composer. */
  const notReady = formOwnsZone || managing;
  /** Setup step mirrored into the desk status. */
  const [setupFace, setSetupFace] = useState<SetupFace | null>(null);
  /** Locally dismissed suggestion text; the suggestion itself is a log projection. */
  const [droppedGhost, setDroppedGhost] = useState<string | null>(null);
  /** Whether the composer contains user text, used to demote gate actions. */
  const [drafting, setDrafting] = useState(false);
  /** Lifted above HistoryStrip so opening and closing a record preserves the expanded list. */
  const [historyOpen, setHistoryOpen] = useState(previewPose?.historyOpen ?? false);
  const closeRecord = onCloseRecord
    ? () => { setHistoryOpen(true); onCloseRecord(); }
    : undefined;

  // Height animations rebaseline when either viewport geometry or UI scale changes.
  const viewport = useViewportEpoch();

  const [readingThoughts, setReadingThoughts] = useState(false);

  /** Open ask decks participate in panel height and reset for each order. */
  const [openDecks, setOpenDecks] = useState<ReadonlySet<string>>(NO_DECKS);
  const currentOrderSeq = view.current?.orderSeq;
  useEffect(() => { setOpenDecks(NO_DECKS); }, [currentOrderSeq]);

  /** Nonce that asks DeskHeader to open the shared stop confirmation. */
  const [stopAsks, setStopAsks] = useState(0);

  const focusComposer = useRef<(() => void) | null>(null);

  // Forms and expanded reasoning are read in place; record and deck changes follow only when pinned.
  useFollowNewest(
    jobZoneRef, view, `${viewport}|${[...openDecks].sort().join(',')}`,
    !formOwnsZone && !managing && !readingThoughts,
  );

  const celebrate = useCelebrateEdge(view);

  const rolledBack = useMemo(() => rolledBackSeqs(view.jobs, undoDepth), [view.jobs, undoDepth]);
  const ticked = useSecondClock(TICKING.has(view.phase) && now === undefined);
  const clock = now ?? ticked;
  const incident = trouble(view);
  // Dismissal demotes an incident banner but keeps the underlying fault visible.
  const showTrouble = incident !== null;
  const standingTrouble = incident !== null && incident.seq === dismissed;
  const route = composerRoute(view.phase);
  const isRunning = running ?? !AT_REST.has(view.phase);

  /** Offers restored pauses for resume, and key-cleared settled jobs as blocked repairs. */
  const offered = keyCleared
    ? (AT_REST.has(view.phase) ? owedJob : undefined)
    : restored && view.phase === 'paused' ? view.current
      : undefined;
  const heldOffer = offered === undefined ? null : {
    job: offered,
    blocked: keyCleared,
    note: offered.plan && offered.plan.doneCount > 0
      ? t('agent3.ticket_stages_done', { n: offered.plan.doneCount, m: offered.plan.stages.length })
      : undefined,
  };

  /** Handles panel-local banner state before forwarding external actions. */
  const bannerAction = (action: BannerActionId): void => {
    if (action === 'dismiss' || action === 'set-aside') setDismissed(incident?.seq ?? null);
    if (action === 'new-order') { focusComposer.current?.(); return; }
    if (action === 'fix-key') { openKeyEntry(); onBannerAction?.(action); return; }
    if (action === 'change-provider' || action === 'edit-endpoint') {
      setSetupEntry(action === 'change-provider' ? 'chooser' : 'endpoint');
      setInSetup(true);
    }
    if (action === 'set-aside' && incident) onFileAway?.(incident.seq);
    onBannerAction?.(action);
  };

  const blockedComposer = keyCleared ? COMPOSER_BLOCKED['key-cleared']
    : incident && !standingTrouble ? COMPOSER_BLOCKED[incident.cls]
      : undefined;

  /** Current held jobs must settle before filing; already-settled offers file directly. */
  const setAside = heldOffer === null ? undefined
    : heldOffer.job === view.current
      ? (onSetAside ?? undefined)
      : (onFileAway ? (seq: number) => onFileAway(seq) : undefined);

  /** Renders each ask from its plan, option, quick-answer or tool shape; only view.gate is actionable. */
  const asks = view.current?.asks ?? [];
  const cardFor = (ask: AskRecord): ReactNode => {
    const answerable = view.gate?.gateId === ask.gateId;
    const answer = (a: 'allow' | 'skip') => onGateAnswer(ask.gateId, a);
    const inWords = (words: string) => onGateAnswer(ask.gateId, 'words', words);
    if (ask.options) {
      const pick = optionAskFrom(ask, optionThumb ? (option) => optionThumb(option) : undefined);
      return pick ? (
        <OptionPick
          key={ask.gateId}
          ask={pick}
          answerable={answerable}
          onPick={(index) => { inWords(pick.cards[index]?.cap ?? ''); }}
          onDecline={() => answer('skip')}
        />
      ) : null;
    }
    if (ask.scope === 'plan') {
      return (
        <PlanGate
          key={ask.gateId}
          ask={ask}
          demoted={drafting}
          answerable={answerable}
          onAnswer={answer}
        />
      );
    }
    const thumb = gateThumb?.(ask);
    return (
      <GateBlock
        key={ask.gateId}
        ask={ask}
        {...(thumb !== undefined && thumb !== null ? { thumb } : {})}
        {...(ask.quickAnswers ? { quick: ask.quickAnswers, actions: false, onQuick: inWords } : {})}
        demoted={drafting}
        answerable={answerable}
        onAnswer={answer}
      />
    );
  };
  /** Groups consecutive answered asks in place; the current unanswered ask remains expanded. */
  const askCards = deckRuns(asks).map((run) => {
    if (!run.deck) return cardFor(run.ask);
    const deckId = run.asks[0]!.gateId;
    return (
      <AskDeck
        key={`deck-${deckId}`}
        asks={run.asks}
        open={openDecks.has(deckId)}
        onOpenChange={(next) => setOpenDecks((prev) => {
          const set = new Set(prev);
          if (next) set.add(deckId); else set.delete(deckId);
          return set;
        })}
      >
        {run.asks.map(cardFor)}
      </AskDeck>
    );
  });
  const hasAsk = askCards.some((card) => card !== null);

  /** Moves hold controls below ask cards so the controls follow the card they answer. */
  const holdAfterAsk = ON_HOLD.has(view.phase) && hasAsk && heldOffer === null;

  /** An opened past record replaces the job zone; missing record identities resolve as closed. */
  const opened = openRecord === null || view.current
    ? undefined
    : view.jobs.find((job) => job.orderSeq === openRecord);

  /** The settled record standing as a card, and which card that is. */
  const settled = opened ? null : terminal(view, filed, heldOffer?.job);
  /** History excludes the record currently shown, offered for resumption or locally cleared. */
  const past = view.jobs.filter((job) => (
    job !== settled?.job && job !== heldOffer?.job && !cleared.has(job.orderSeq)
  ));

  /** Prevents a settled record from rewinding another or unidentified map's undo stack. */
  const settledBlocked = settled && (otherMap?.has(settled.job.orderSeq) === true
    ? 'other-map'
    : unknownMap?.has(settled.job.orderSeq) === true ? 'unknown-map' : undefined);

  /** Reports map mismatch across visible records, preferring a known mismatch over unknown identity. */
  const noticed = settled ? [...past, settled.job] : past;
  const noticeCls: BannerClass | null = !formOwnsZone && !managing && !opened
    ? noticed.some((job) => otherMap?.has(job.orderSeq) === true) ? 'other-map'
      : noticed.some((job) => unknownMap?.has(job.orderSeq) === true) ? 'unknown-map'
        : null
    : null;

  /** Lost and pruned notices remain standing until a clean save; discarding corrupt data clears its notice. */
  const storageCls: BannerClass | null = formOwnsZone || managing || opened || storageNotice == null
    ? null
    : storageNotice === 'corrupt' ? 'storage-corrupt'
      : storageNotice === 'lost' ? 'storage-full' : 'storage-pruned';
  const standingStorage = (storageNotice === 'lost' || storageNotice === 'pruned')
    && dismissedStorage === storageNotice;

  /** Idle panels place the sketch card nearest the composer when no record or blocking screen is active. */
  const dressed = sketchbook !== undefined && !formOwnsZone && !managing && !opened
    && !view.current && !settled && !hasAsk && !showTrouble
    // A corrupt-data decision owns the rest state until answered.
    && storageCls !== 'storage-corrupt';

  const rowOnly = !formOwnsZone && !managing && !view.current && !hasAsk && !showTrouble
    && !settled && !opened && noticeCls === null && past.length > 0 && !dressed;

  /** Row-only and marking states omit the record-height floor. */
  const zoneEmpty = rowOnly || marking;

  /** The live scroll fade begins below the sticky order heading and remeasures throughout height changes. */
  const fade = useScrollFade(jobZoneRef, 'y', { offsetAt: stickyBand });

  // The tween key includes every state that can reshape the panel without changing record content.
  const askShape = `${asks.map((ask) => `${ask.gateId}${ask.verdict ?? ''}`).join('|')}~${[...openDecks].sort().join(',')}`;
  const shape = `${maxHeight ?? ''}:${String(showSetup)}:${String(showWelcome)}:${setupFace?.step ?? ''}:${String(managing)}:${showTrouble}:${askShape}:${view.queuedSteers.length}:${String(zoneEmpty)}:${settled?.job.orderSeq ?? ''}:${opened?.orderSeq ?? ''}:${String(marking)}:${String(dressed)}`;
  // Docked height follows the viewport and bypasses content-height animation.
  useHeightTween(rootRef, `${shape}|${String(view.jobs.length)}|${view.phase}`, reduced || pinned, viewport);

  // Only the live panel registers as the character host's moving carriage; help figures stay inert.
  useEffect(() => {
    if (pictured) return undefined;
    setPanelCarriage(plateRef.current);
    return () => setPanelCarriage(null);
  }, [pictured]);

  /** Handles the panel's final Escape layer after menus and composer state consume their own presses. */
  const escapeFolds = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    // Region marking closes before the panel so its active map tool is disarmed.
    if (marking && onMarkRegion) {
      e.stopPropagation();
      onMarkRegion();
      return;
    }
    if (!onCollapse) return;
    e.stopPropagation();
    onCollapse();
  };

  /** The region chip appears only beside an active composer and outside the marking gesture. */
  const regionButton = onMarkRegion
    ? <RegionButton bounds={region} marking={marking} onPress={onMarkRegion} />
    : null;
  const regionChip = region && !notReady && !marking && onMarkRegion && onClearRegion
    ? (
      <RegionChip
        bounds={region}
        {...(regionShot ? { vignette: regionShot(region, CHIP_VIGNETTE.width, CHIP_VIGNETTE.height) } : {})}
        onMark={onMarkRegion}
        onClear={onClearRegion}
      />
    )
    : null;

  const keyField = () => rootRef.current?.querySelector<HTMLElement>('[data-testid="setup-key-input"]');

  /** Defers key-field focus when clearing a credential must mount the field first. */
  const [wantKeyField, setWantKeyField] = useState(false);
  /** The setup step requested by the action that opened or reset the connection screen. */
  const [setupEntry, setSetupEntry] = useState<SetupEntry>('key');
  askedForField.current = wantKeyField;
  useEffect(() => {
    if (!wantKeyField || !showSetup) return;
    keyField()?.focus();
    setWantKeyField(false);
  }, [wantKeyField, showSetup]);

  /** Opens and focuses key setup; returns whether the caller must first clear a stored key. */
  function openKeyEntry(): boolean {
    setSetupEntry('key');
    if (showSetup) { keyField()?.focus(); return false; }
    setWantKeyField(true);
    if (showWelcome || !connected) { setInSetup(true); return false; }
    return true;
  }

  const dockAct = (act: DockActId) => {
    if (act === 'fix-key') {
      if (openKeyEntry()) onDockAct?.(act);
      return;
    }
    if (act === 'edit-endpoint') { setSetupEntry('endpoint'); setInSetup(true); return; }
    if (act === 'edit-model') { onDockAct?.(act); return; }
    if (act !== 'new-order') { onDockAct?.(act); return; }
    rootRef.current
      ?.querySelector<HTMLElement>('[data-testid="composer"] input, [data-testid="composer"] textarea')
      ?.focus();
  };

  /** Free panels carry one corner pin; docked panels place pin and side controls in the desk band. */
  const pinLabel = t(pinBlocked ? 'agent3.pin_no_room' : pinned ? 'agent3.pin_undock' : 'agent3.pin_dock');
  const controls = onTogglePin ? (
    <motion.div
      data-testid="desk-pin"
      style={pinned
        ? {
          position: 'absolute',
          top: PANEL_PAD + (DOCK_HEIGHT - DOCK_CHROME_FILE_H) / 2,
          right: PANEL_PAD,
          display: 'flex', flexDirection: 'column', gap: DOCK_CHROME.stack, zIndex: 1,
        }
        : {
          position: 'absolute', top: PANEL_RADIUS, right: -PIN_KNOB_OUT,
          display: 'flex', zIndex: 1,
          // The external knob follows the plate's clip animation.
          x: knobX, y: knobY, scale: knobScale,
        }}
    >
      {pinned ? (
        <>
          <IconButton
            testId="dock-pin"
            icon={dockSide === 'left' ? 'pw-dock-left' : 'pw-dock-right'}
            label={pinLabel}
            data-act="pin"
            lit
            onClick={onTogglePin}
          />
          {onSwitchSide ? (
            <IconButton
              testId="dock-switch"
              // The glyph indicates the destination side.
              icon={dockSide === 'left' ? 'pw-dock-right' : 'pw-dock-left'}
              label={t(dockSide === 'left' ? 'agent3.dock_switch_right' : 'agent3.dock_switch_left')}
              data-act="dock-side"
              onClick={onSwitchSide}
            />
          ) : null}
        </>
      ) : (
        <PinKnob
          testId="dock-pin"
          icon={dockSide === 'left' ? 'pw-dock-left' : 'pw-dock-right'}
          label={pinLabel}
          data-act="pin"
          disabled={pinBlocked}
          onClick={onTogglePin}
        />
      )}
    </motion.div>
  ) : null;

  return (
    // This unclipped wrapper carries the plate, external knob and hosted character together.
    <motion.div
      ref={plateRef}
      // Inline visibility hides the folded plate in the same paint as its dock-geometry change.
      style={away === 'folded' ? { ...PLATE_HOLDER, visibility: 'hidden' } : PLATE_HOLDER}
      variants={panelVariants}
      // Docked plates are revealed by the surrounding sheet and have no independent entrance.
      initial={reduced || pinned ? false : 'hidden'}
      // Dock changes keep one mounted node and pass through a folded state beneath the covering sheet.
      animate={away ? 'hidden' : pinned ? 'ground' : 'shown'}
      exit="gone"
      transition={pinned || away === 'folded'
        ? REVEALED
        : framerMotion(away === 'leaving' ? 'panel.close' : 'panel.open')}
    >
      <motion.section
        ref={rootRef}
        data-testid="panel-shell"
        {...helpTargetAttr(showSetup || managing ? 'agent-setup' : showWelcome ? 'agent-intro' : marking ? 'agent-region' : opened ? 'agent-trail' : showTrouble ? 'agent-trouble' : 'agent-run')}
        variants={plateVariants}
        // Framer transitions are not inherited, so the plate repeats the holder's timing choice.
        transition={pinned || away === 'folded'
          ? REVEALED
          : framerMotion(away === 'leaving' ? 'panel.close' : 'panel.open')}
        // The plate clip and external knob derive from the same motion value.
        style={{
          ...(pinned ? dockedStyle(maxHeight, dockSide) : panelStyle(maxHeight, notReady)),
          clipPath: wipe,
        }}
        onKeyDown={escapeFolds}
      >
        {/* One hidden sprite supplies every symbol referenced by this panel's glyphs. */}
        <IconSprite />

        {pinned ? controls : null}

        {/* Dock controls reserve space only in the desk band. */}
        <div
          data-testid="desk-band"
          style={{
            flex: '0 0 auto', display: 'flex', flexDirection: 'column',
            paddingRight: pinned ? DOCK_CHROME_W : 0,
          }}
        >
          <DeskHeader
            view={view}
            // Setup owns connection status while its screen is open.
            connected={connected && !showSetup}
            {...(celebrate ? { pose: celebrate } : {})}
            {...(mapName !== undefined ? { mapName } : {})}
            {...(providerName !== undefined ? { providerName } : {})}
            {...(modelName !== undefined ? { modelName } : {})}
            now={clock}
            onPause={onPause}
            onStop={onStop}
            askStop={stopAsks}
            onResume={() => onResume?.()}
            onDockAct={dockAct}
            {...(onRetryNow ? { onRetryNow } : {})}
            {...(onManage ? { onManage } : {})}
            managing={managing}
            {...(connectionMeta !== undefined ? { connectionMeta } : {})}
            {...(opened ? { readingRecord: recordStamp?.(opened) ?? '' } : {})}
            // Helper activity is ephemeral and therefore supplied outside PanelView.
            helper={lane !== undefined && lane.done !== true}
            setupFace={showSetup ? setupFace : null}
            {...(marking ? { marking: region ? 'painted' as const : 'blank' as const } : {})}
            {...(gateCells !== undefined ? { gateCells } : {})}
            recordFiled={settled === null && opened === undefined && view.phase === 'idle'}
            heldOffer={heldOffer !== null && !keyCleared}
            storageSetAside={storageNotice === 'corrupt'}
            unsaved={storageNotice === 'lost'}
            {...(hosted
              // CharacterHost measures this empty seat and positions the single live character over it.
              ? { characterSlot: <div ref={setDeskSeat} style={{ position: 'absolute', inset: 0 }} /> }
              : {})}
          />
        </div>

        <div
          ref={jobZoneRef}
          data-testid="panel-job-zone"
          style={{ ...JOB_ZONE_STYLE, minHeight: jobZoneFloor(maxHeight, zoneEmpty), ...fade }}
        >
          {marking ? null : showSetup ? (
            <SetupScreen
              key={setupEntry}
              entry={setupEntry}
              onDone={() => { setInSetup(false); onSetupDone?.(); }}
              onFace={setSetupFace}
              // Model selection moves to the management card and can return to incomplete setup.
              {...(onManage ? { onManage: () => { setInSetup(false); if (!managing) onManage(); } } : {})}
              onLeave={() => setInSetup(false)}
            />
          ) : showWelcome ? (
            <DreamOffice
              onConnect={() => {
                // Help figures never control the live character.
                if (!pictured) {
                  const hero = getCharacterHandle();
                  hero?.acknowledge();
                  hero?.wake();
                }
                setInSetup(true);
              }}
              pinned={pinned}
            />
          ) : managing ? (
            <ManageScreen
              // Count only records still visible to the local clear action.
              jobCount={jobCount ?? view.jobs.filter((job) => !cleared.has(job.orderSeq)).length}
              stoppable={isRunning || view.phase === 'retrying' || view.phase === 'gated'}
              parkable={view.phase === 'retrying'}
              {...(onManageDone ? { onDone: onManageDone } : {})}
              onNeedKey={() => { setSetupEntry('key'); setInSetup(true); }}
              {...(onClearJobs ? { onClearJobs } : {})}
              onStopJob={onStop}
              onSetAside={onPause}
              {...(liveConnection ? { liveConnection } : {})}
            />
          ) : opened ? (
            /* Opened history replaces the zone and preserves each record's paper or archive form. */
            isAnswerJob(opened) ? (
              <AnswerPaper
                job={opened}
                past
                {...(closeRecord ? { onBack: closeRecord } : {})}
                {...(onClearRecord ? { onClear: onClearRecord } : {})}
              />
            ) : (
              <ArchiveCard
                job={opened}
                rolledBack={rolledBack.has(opened.orderSeq)}
                {...(recordStamp ? { stamp: recordStamp(opened) } : {})}
                {...(closeRecord ? { onBack: closeRecord } : {})}
                {...(onClearRecord ? { onClear: onClearRecord } : {})}
              />
            )
          ) : (
            <>
              {storageCls && (
                /* Discard clears corrupt bytes; export preserves both the bytes and their notice. */
                <Banner
                  cls={storageCls}
                  standing={standingStorage}
                  onAction={(action) => {
                    if (action === 'dismiss') {
                      if (storageCls === 'storage-corrupt') onDismissStorage?.();
                      else if (storageNotice === 'lost' || storageNotice === 'pruned') setDismissedStorage(storageNotice);
                    } else onBannerAction?.(action);
                  }}
                />
              )}
              {noticeCls && (
                <Banner cls={noticeCls} onAction={() => { /* Map-identity notices remain with their records. */ }} />
              )}
              {/* A key-cleared notice precedes the blocked resume card it explains. */}
              {keyCleared && (
                <Banner
                  cls={AT_REST.has(view.phase) ? 'key-cleared' : 'key-clearing'}
                  standing={standingTrouble}
                  onAction={bannerAction}
                />
              )}
              {heldOffer && (
                <ResumeCard
                  order={heldOffer.job.orderText}
                  pausemark={pausedWhere(heldOffer.job, t)}
                  {...(heldOffer.note ? { note: heldOffer.note } : {})}
                  {...(heldOffer.blocked ? { blocked: t('agent3.ticket_key_returns') } : {})}
                  {...(heldOffer.blocked
                    ? { onFixKey: () => bannerAction('fix-key') }
                    : onResume ? { onResume } : {})}
                  {...(setAside ? { onSetAside: () => setAside(heldOffer.job.orderSeq) } : {})}
                />
              )}
              <HistoryStrip
                jobs={past}
                rolledBack={rolledBack}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                {...(otherMap ? { otherMap } : {})}
                {...(unknownMap ? { unknownMap } : {})}
                {...(undoDepth !== undefined ? { undoDepth } : {})}
                busy={isRunning}
                {...(onOpenTicket ? { onOpen: onOpenTicket } : {})}
                {...(onRollBack ? { onRollBack } : {})}
              />
              {/* A resume offer replaces the live ticket for the same job. */}
              {view.current && !heldOffer && (
                <JobTicket
                  job={view.current}
                  live
                  held={HELD.has(view.phase)}
                  streaming={view.current.saysStreaming === true}
                  paused={ON_HOLD.has(view.phase)}
                  {...(lane ? { lane } : {})}
                  {...(view.current.region && regionShot
                    ? { regionVignette: regionShot(view.current.region, TICKET_VIGNETTE.width, TICKET_VIGNETTE.height) }
                    : {})}
                  busy={isRunning}
                  {...(onRewind ? { onRewind } : {})}
                  // Hold actions move below any ask card that produced the hold.
                  {...(onResume && !holdAfterAsk ? { onResume } : {})}
                  {...(holdAfterAsk ? {} : { onStop })}
                  onThoughtsOpenChange={setReadingThoughts}
                />
              )}
              {/* Settled jobs retain their answer, stop, stalled or receipt form. */}
              {settled?.shape === 'paper' && (
                <AnswerPaper
                  key={settled.job.orderSeq}
                  job={settled.job}
                  {...(onFileAway ? { onFileAway } : {})}
                />
              )}
              {settled?.shape === 'stop' && (
                <StopCard
                  /* Record identity resets card-local confirmation state between jobs. */
                  key={settled.job.orderSeq}
                  job={settled.job}
                  rolledBack={rolledBack.has(settled.job.orderSeq)}
                  {...(undoDepth !== undefined ? { undoDepth } : {})}
                  // Unanswered asks remain attached to a job that settles mid-question.
                  unanswered={settled.job.asks.some((ask) => ask.verdict === 'unanswered')}
                  {...(clockOf(view, settled.job) !== null ? { clock: clockOf(view, settled.job)! } : {})}
                  {...(onRewindAll && !settledBlocked ? { onRewindAll: () => onRewindAll(settled.job) } : {})}
                  {...(onFileAway ? { onFileAway } : {})}
                />
              )}
              {/* Stalled jobs leave repair actions to the adjacent incident banner. */}
              {settled?.shape === 'stalled' && (
                <IncidentCard
                  key={settled.job.orderSeq}
                  job={settled.job}
                  stamps={jobStamps(settled.job, t)}
                />
              )}
              {settled?.shape === 'receipt' && (
                <FlipTicket
                  key={settled.job.orderSeq}
                  job={settled.job}
                  compact={settled.job.question === true}
                  rolledBack={rolledBack.has(settled.job.orderSeq)}
                  {...(undoDepth !== undefined ? { undoDepth } : {})}
                  {...(recordShot && settled.job.question !== true ? { postcard: recordShot(settled.job) } : {})}
                  {...(recordStamp ? { archiveStamp: recordStamp(settled.job) } : {})}
                  {...(onRewind && !settledBlocked ? { onRewind } : {})}
                  {...(onRewindAll && !settledBlocked ? { onRewindAll: () => onRewindAll(settled.job) } : {})}
                  {...(onKeepGoing ? { onKeepGoing: () => onKeepGoing(settled.job) } : {})}
                  // Answering or replacing a standing question files its compact receipt.
                  {...(onFileAway && settled.job.question !== true ? { onFileAway } : {})}
                />
              )}
              {askCards}
              {(view.phase === 'gated' || (settled?.job.question === true && onFileAway)) && (
                <div style={HOLD_ACTIONS_STYLE}>
                  <Pill
                    data-testid="question-cancel-task"
                    onClick={() => {
                      if (view.phase === 'gated') setStopAsks((n) => n + 1);
                      else if (settled) onFileAway?.(settled.job.orderSeq);
                    }}
                  >
                    {t('agent3.action_cancel_task')}
                  </Pill>
                </div>
              )}
              {holdAfterAsk && (onResume !== undefined || onStop !== undefined) && (
                <div data-testid="hold-actions" style={HOLD_ACTIONS_STYLE}>
                  {onResume !== undefined && (
                    <button
                      type="button"
                      data-testid="hold-resume"
                      onClick={onResume}
                      style={RESUME_PRIMARY}
                    >
                      {t('agent3.action_resume')}
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="hold-stop"
                    onClick={onStop}
                    style={{ ...windowPill('danger', false, 'plate'), boxShadow: 'none' }}
                  >
                    {t('agent3.action_stop')}
                  </button>
                </div>
              )}
              {showTrouble && !keyCleared && (
                <Banner
                  cls={incident.cls}
                  {...(modelName !== undefined ? { model: modelName } : {})}
                  standing={standingTrouble}
                  onAction={bannerAction}
                />
              )}
              {/* The idle sketch seat remains nearest the composer, including in a tall docked zone. */}
              {dressed && (
                <div
                  data-testid="sketch-seat"
                  style={{
                    flex: '0 0 auto', display: 'flex', flexDirection: 'column',
                    marginTop: pinned ? 'auto' : 0,
                  }}
                >
                  {sketchbook}
                </div>
              )}
            </>
          )}
        </div>

        {/* The stable queue zone prevents notes from resizing the record under the pointer. */}
        <SteerQueue steers={view.queuedSteers} {...(onRecallSteer ? { onRecall: onRecallSteer } : {})} />

        {/* Setup, welcome and management screens provide their own footer actions. */}
        {notReady ? null : (
        <Composer
          route={route}
          running={isRunning}
          marking={marking}
          {...(regionButton ? { regionButton } : {})}
          {...(regionChip ? { regionChip } : {})}
          // A standing question uses the composer as its answer field.
          answering={settled?.job.question === true}
          // A loud unresolved incident can replace the composer with its repair instruction.
          {...(blockedComposer ? { blocked: blockedComposer } : {})}
          suggestion={view.suggestion === droppedGhost ? null : view.suggestion}
          onSend={onSend}
          // Stop opens the shared confirmation in DeskHeader.
          onStop={() => setStopAsks((n) => n + 1)}
          {...(onResume ? { onResume } : {})}
          onDropSuggestion={() => {
            setDroppedGhost(view.suggestion);
            onDropSuggestion?.();
          }}
          onDraftChange={setDrafting}
          {...(fill ? { fill } : {})}
          focusRef={focusComposer}
          {...(view.phase === 'idle' ? { caveat: t('agent3.caveat') } : {})}
        />
        )}
      </motion.section>
      {/* The overlapping free-panel tab paints after the plate so their outlines join cleanly. */}
      {pinned ? null : controls}
    </motion.div>
  );
}
