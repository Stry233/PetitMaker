/*
 * assistant.tsx — the Help Center's figures for the assistant panel: the key field's detection beat,
 * the oversight control, and the REAL `PanelShell` posed at four moments (a plan awaiting approval,
 * a job mid-run with a steer note queued, the composer's region chip, the past-jobs list open). The
 * panel figures mount `PanelShell` itself with fixture projections rather than `PanelColumn`, whose
 * other half reads the stores, the key vault and the network. `SetupScreen` mounts here for real
 * under the ui-preview seam, which stands its network asks down; `ManageScreen` still never mounts
 * (it persists to the key vault), so the oversight figure is the manage card's own
 * `SegmentedControl` row over the same copy table.
 */
import { useEffect, useState } from 'react';
import { PreviewFrame } from './PreviewFrame';
import { PanelShell } from '../../../../../agent/PanelShell';
import { PANEL_WIDTH } from '../../../../../agent/tokens';
import { RegionVignette } from '../../../../../agent/region-chip';
import { Banner } from '../../../../../agent/Banner';
import { useEditorStore } from '../../../../../../state/store';
import { renderThumbnail } from '../../../../../../canvas/thumbnail';
import { rowFace, SetupKeyField, SetupProviderFace } from '../../../../../agent/SetupScreen';
import { NOTE_STYLE, OVERSIGHT_COPY, OVERSIGHTS, readKeyShape } from '../../../../../agent/setup-parts';
import type { AskRecord, JobView, OpRow, PanelView } from '../../../../../../agent/core/project-view';
import type { RegionBounds } from '../../../../../../state/region-bounds';
import { useT } from '../../../../../../i18n/context';
import { SegmentedControl } from '../../../../../primitives/SegmentedControl';
import { PLATE_INK } from '../../../../../design/tokens';
import { roleFont } from '../../../../../design/text-weight';

const noop = () => {};

/** The verbs a pictured panel never answers with anyway (`PreviewFrame` is inert). */
const VERBS = { onSend: noop, onStop: noop, onPause: noop, onGateAnswer: noop };

function makeView(over: Partial<PanelView>): PanelView {
  return {
    phase: 'idle',
    jobs: [],
    queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null,
    lastEventAt: 0,
    ...over,
  };
}

function makeJob(over: Partial<JobView>): JobView {
  return {
    orderSeq: 1, orderText: '', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

/** One clock reading, taken at mount and never ticked: the pictured dock stands still, and the
 *  past-jobs day headers (which read the wall clock) agree with the fixtures' own stamps. */
function useFixedNow(): number {
  return useState(() => Date.now())[0];
}

/* ── setup: the key field, and the same detection the screen reads ──────── */

/** Shaped exactly like an Anthropic key (`sk-ant-…`) so `readKeyShape` and `keyLooksUsable` read it
 *  the same way the live screen would; never a real key. */
const SAMPLE_KEY = 'sk-ant-api03-9f2b7c4d1e6a8f3b0c5d2e7a4b1f8c3d';

/** The whole panel at its connect step: the dock band above, the real `SetupScreen` in the job
 *  zone (its network asks stand down under the ui-preview seam). `ready={false}` is what walks a
 *  connected panel into setup, the same door the live one takes. */
export function AgentSetupPreview() {
  const now = useFixedNow();
  return (
    <PreviewFrame width={PANEL_WIDTH} height={560} fit>
      <PanelShell view={makeView({ lastEventAt: now })} connected ready={false} now={now} maxHeight="560px" {...VERBS} />
    </PreviewFrame>
  );
}

export function AgentSetupDetectPreview() {
  const t = useT();
  const shape = readKeyShape(SAMPLE_KEY);
  // The row at the moment a shaped key has just settled: not pinned, not checking, not refused —
  // the same face `SetupScreen` shows once its idle gate opens on a key a provider claims.
  const row = rowFace({ t, shape, pinned: null, checking: false, refused: false });
  return (
    <PreviewFrame height={140} fit>
      <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SetupKeyField
          value={SAMPLE_KEY}
          masked
          refused={false}
          shakeSeq={0}
          onChange={noop}
          onEnter={noop}
        />
        <SetupProviderFace row={row} mark={null} />
      </div>
    </PreviewFrame>
  );
}

/* ── oversight: the manage card's own control row, posed at the default ──── */

/** The level the picture stands at: the default, whose caption explains the middle ground. */
const OVERSIGHT_SHOWN = 'checkpoint' as const;

export function AgentOversightPreview() {
  const t = useT();
  return (
    <PreviewFrame height={150} fit>
      <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ ...roleFont('label'), color: PLATE_INK, padding: '0 3px' }}>
          {t('agent3.setup_oversight')}
        </div>
        <SegmentedControl
          value={OVERSIGHT_SHOWN}
          options={OVERSIGHTS}
          onChange={noop}
          render={(o) => t(OVERSIGHT_COPY[o].label)}
          idPrefix="help-fig-oversight"
        />
        <p style={{ ...NOTE_STYLE, margin: 0 }}>{t(OVERSIGHT_COPY[OVERSIGHT_SHOWN].caption)}</p>
      </div>
    </PreviewFrame>
  );
}

/* ── plan: the panel gated on its plan, three stages, one flagged ────────── */

// Tall enough that the gated ticket shows its ask paper WHOLE: shorter, the panel's own scroll
// puts the paper's opening line under the fold and the figure opens mid-sentence.
const PANEL_FIG_HEIGHT = 600;

export function AgentPlanPreview() {
  const t = useT();
  const now = useFixedNow();
  const ask: AskRecord = {
    gateId: 'help-fig-plan',
    scope: 'plan',
    summary: t('help.fig.plan_job'),
    stages: [
      { label: t('help.fig.plan_s1') },
      { label: t('help.fig.plan_s2'), checkpoint: true },
      { label: t('help.fig.plan_s3') },
    ],
  };
  const job = makeJob({ orderText: t('help.fig.plan_job'), orderAt: now - 50_000, asks: [ask] });
  const view = makeView({
    phase: 'gated',
    gate: { gateId: 'help-fig-plan', scope: 'plan', summary: t('help.fig.plan_job') },
    current: job,
    lastEventAt: now,
  });
  return (
    <PreviewFrame width={PANEL_WIDTH} height={PANEL_FIG_HEIGHT} fit>
      <PanelShell view={view} connected now={now} maxHeight={`${PANEL_FIG_HEIGHT}px`} {...VERBS} />
    </PreviewFrame>
  );
}

/* ── steer: the panel mid-run, one read, one landed write, a note queued ── */

// Enough for the ticket's two op rows, the queued chip and the composer; taller only buys the
// record's empty scroll.
const STEER_FIG_HEIGHT = 520;

export function AgentSteerPreview() {
  const t = useT();
  const now = useFixedNow();
  const job = makeJob({
    orderText: t('help.fig.steer_job'),
    orderAt: now - 40_000,
    ops: [
      fixtureOp({ callId: 'help-fig-steer-read', name: 'view_map', isRead: true }),
      fixtureOp({ callId: 'help-fig-steer-write', name: 'paint_terrain', detail: { cells: 23 } }),
    ],
  });
  const view = makeView({
    phase: 'executing',
    current: job,
    queuedSteers: [{ seq: 2, text: t('help.fig.steer_note') }],
    lastEventAt: now,
  });
  return (
    <PreviewFrame width={PANEL_WIDTH} height={STEER_FIG_HEIGHT} fit>
      <PanelShell view={view} connected now={now} maxHeight={`${STEER_FIG_HEIGHT}px`} {...VERBS} />
    </PreviewFrame>
  );
}

/* ── region: the real composer with its docked chip over the live island ── */

const FIXTURE_BOUNDS: RegionBounds = { x1: 6, y1: 6, x2: 18, y2: 14, count: 117 };
const REGION_FIG_HEIGHT = 340;

export function AgentRegionPreview() {
  const now = useFixedNow();
  return (
    <PreviewFrame width={PANEL_WIDTH} height={REGION_FIG_HEIGHT} fit>
      <PanelShell
        view={makeView({ lastEventAt: now })}
        connected
        now={now}
        maxHeight={`${REGION_FIG_HEIGHT}px`}
        region={FIXTURE_BOUNDS}
        marking={false}
        onMarkRegion={noop}
        onClearRegion={noop}
        regionShot={(bounds, w, h) => <RegionVignette bounds={bounds} width={w} height={h} />}
        {...VERBS}
      />
    </PreviewFrame>
  );
}

/* ── undo: the panel with its past-jobs list open, one job rolled back ───── */

function fixtureOp(over: Partial<OpRow>): OpRow {
  return { callId: 'help-fig-op', name: 'place_object', status: 'ok', summary: '', isRead: false, ...over };
}

/* ── intro: the dream office, the panel's own no-key rest ────────────────── */

/** Tall enough for the dock band, the speech line, the whole three-slip board, the key note and
 *  the Connect foot. */
const DREAM_FIG_HEIGHT = 620;

export function AgentDreamPreview() {
  const now = useFixedNow();
  // The whole disconnected panel, exactly as it first unfolds: the dock band above, the dream
  // office in the job zone (the character's seat stands empty in a figure; the live character is
  // the panel's own singleton and never mounts here).
  return (
    <PreviewFrame width={PANEL_WIDTH} height={DREAM_FIG_HEIGHT} fit>
      <PanelShell view={makeView({ lastEventAt: now })} connected={false} now={now} maxHeight={`${DREAM_FIG_HEIGHT}px`} {...VERBS} />
    </PreviewFrame>
  );
}

/* ── trail: the ticket mid-run, every kind of op row at once ─────────────── */

export function AgentTrailPreview() {
  const t = useT();
  const now = useFixedNow();
  const state = useEditorStore((s) => s.gridState);
  // The view_map row carries the very picture a live call would send: the open map, captured by
  // its own renderer. With no renderer yet the row stands on its chip alone, like a reloaded one.
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => {
    if (!state) return undefined;
    let live = true;
    void renderThumbnail(state, 640).then((url) => { if (live) setShot(url); });
    return () => { live = false; };
  }, [state]);
  const job = makeJob({
    orderText: t('help.fig.trail_job'),
    orderAt: now - 90_000,
    ops: [
      fixtureOp({ callId: 'help-fig-trail-read', name: 'inspect_region', isRead: true }),
      fixtureOp({ callId: 'help-fig-trail-saw', name: 'view_map', isRead: true, ...(shot ? { image: shot } : {}) }),
      fixtureOp({ callId: 'help-fig-trail-write', name: 'paint_terrain', detail: { cells: 26 } }),
      fixtureOp({
        callId: 'help-fig-trail-revert', name: 'place_object', status: 'revert',
        summary: t('error.placement_not_flat'), detail: { reverted: true },
      }),
    ],
  });
  return (
    <PreviewFrame width={PANEL_WIDTH} height={PANEL_FIG_HEIGHT} fit>
      <PanelShell
        view={makeView({ phase: 'executing', current: job, lastEventAt: now })}
        connected
        now={now}
        maxHeight={`${PANEL_FIG_HEIGHT}px`}
        {...VERBS}
      />
    </PreviewFrame>
  );
}

/* ── trouble: one banner, the repair named on it ─────────────────────────── */

/** One fault card alone, close enough to read: the section figure under the trouble page's lead. */
export function AgentBannerPreview() {
  return (
    <PreviewFrame height={190} fit>
      <div style={{ width: 340 }}>
        <Banner cls="auth" onAction={noop} />
      </div>
    </PreviewFrame>
  );
}

const TROUBLE_FIG_HEIGHT = 520;

export function AgentTroublePreview() {
  const t = useT();
  const now = useFixedNow();
  // The panel where trouble actually stands: a job ended by a refused key, its banner over the
  // record, the composer below saying what to fix first.
  const job = makeJob({
    orderText: t('help.fig.trail_job'),
    orderAt: now - 120_000,
    ops: [fixtureOp({ callId: 'help-fig-trouble-read', name: 'view_map', isRead: true })],
    outcome: 'incident',
    errorCls: 'auth',
  });
  return (
    <PreviewFrame width={PANEL_WIDTH} height={TROUBLE_FIG_HEIGHT} fit>
      <PanelShell
        view={makeView({ phase: 'incident', jobs: [job], current: job, lastEventAt: now })}
        connected
        now={now}
        maxHeight={`${TROUBLE_FIG_HEIGHT}px`}
        {...VERBS}
      />
    </PreviewFrame>
  );
}

export function AgentUndoPreview() {
  const t = useT();
  const now = useFixedNow();
  const standing: JobView = makeJob({
    orderSeq: 1,
    orderText: t('help.fig.undo_job'),
    orderAt: now - 2 * 3_600_000,
    ops: [fixtureOp({ name: 'paint_terrain', detail: { cells: 14 } })],
    checkpoints: [{ undoIndex: 0, label: 'job' }],
    outcome: 'done',
    endUndoIndex: 12,
  });
  const rolled: JobView = makeJob({
    orderSeq: 2,
    orderText: t('help.fig.undo_job2'),
    orderAt: now - 30 * 60_000,
    ops: [fixtureOp({ detail: { objects: 8 } })],
    checkpoints: [{ undoIndex: 12, label: 'job' }],
    outcome: 'done',
    endUndoIndex: 34,
  });
  // Both records FILED, so each stands as a row of the list rather than the newest one as the
  // settled receipt; the live depth back at the rolled job's first checkpoint is what reads it as
  // taken back (`rolledBackSeqs`).
  return (
    <PreviewFrame width={PANEL_WIDTH} height={PANEL_FIG_HEIGHT} fit pose={{ historyOpen: true }}>
      <PanelShell
        view={makeView({ jobs: [standing, rolled], lastEventAt: now })}
        connected
        now={now}
        maxHeight={`${PANEL_FIG_HEIGHT}px`}
        undoDepth={12}
        filed={new Set([1, 2])}
        {...VERBS}
      />
    </PreviewFrame>
  );
}
