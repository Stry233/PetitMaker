import { providerName } from '../../i18n/providers';
/*
 * Live assistant integration and lazy chunk boundary. Reads the session, settings and map; owns one
 * runner whose stable config is refreshed in place; and projects the result into PanelShell.
 * Keeping the column mounted preserves the runner's abort controller and in-flight job.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { answerGate } from '../../agent/core/gates';
import { eventsOf } from '../../agent/core/log';
import type { AskRecord, JobView } from '../../agent/core/project-view';
import { recallSteer } from '../../agent/core/steering';
import type { GateOption } from '../../agent/core/types';
import { createRunner, type RunnerConfig } from '../../agent/exec/runner';
import { modelCapabilities, subscribeCatalog, catalogVersion, ensureModelCatalog } from '../../agent/providers/model-catalog';
import { PROVIDER_META } from '../../agent/providers/defaults';
import { serializeLog } from '../../agent/session/persist';
import { panelView, setReadTools, useAgentSession } from '../../agent/session/store';
import { TOOL_SCHEMAS, WRITE_TOOLS } from '../../agent/tools/tools';
import { resolveCells } from '../../agent/tools/tools-common';
import { clearRegionSelection } from '../../core/runtime/region-brush';
import { showToast } from '../../core/runtime/toast-bus';
import { downloadJSON } from '../../io/image-export';
import { host } from '../../kit/host';
import { localizedName, useT } from '../../i18n/context';
import { regionBounds, type RegionBounds } from '../../state/region-bounds';
import { useEditorStore } from '../../state/store';
import { ensureVisionVerdict, knownVision, visionKey } from './vision-verdict';
import { z } from '../design/styles';
import {
  DOCK_PARALLAX, PANEL_LEFT, PINNED_PANEL, dockEdge, dockTravelSign, panelMaxHeight, panelTop,
} from '../shell/panel-frame';
import { dockAside, useDockStage, usePinRoom } from '../shell/use-dock';
import type { BannerActionId } from './Banner';
import type { Checkpoint } from './FlipTicket';
import { callFootprint, MapShot, MarkedShot, unionBox } from './map-shot';
import { RegionVignette } from './region-chip';
import { Sketchbook } from './sketchbook/Sketchbook';
import { proposeSketches } from './sketchbook/propose';
import { amplitude, cssMotion, seconds } from './motion';
import { OPTION_THUMB } from './OptionPick';
import { makePanelToolDeps, newRunnerConfig, refreshRunnerConfig } from './panel-runner';
import { GATE_BORROW, JOB_ZONE_FLOOR, PanelShell, PINNED_HEIGHT } from './PanelShell';
import { POSTCARD } from './tokens';
import { dayOf, type Day } from './HistoryStrip';
import type { DockActId } from './DeskHeader';
import { prettyModel } from './pretty-model';
import { shortModel } from './pretty-model';
import { OVERSIGHT_COPY } from './setup-parts';
import { connectionReady, isConnected, runnerSettings, setLiveJobStop, useAgentPanelSettings } from './settings';

/** Read-only tool names shared by session projections and the hosted character. */
const READ_TOOLS: ReadonlySet<string> = new Set(
  TOOL_SCHEMAS.map((s) => s.name).filter((name) => !WRITE_TOOLS.has(name)),
);
setReadTools(READ_TOOLS);

/** Minimum usable height: fixed panel chrome plus the minimum job zone. */
const PANEL_LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;


/** Gate-card capture size in CSS pixels. */
const GATE_THUMB_W = 104;
const GATE_THUMB_H = 74;

/** Locale keys shared by archive cards and dock metadata. */
const DAY_STAMP_KEY: Record<Day, string> = {
  today: 'agent3.history_day_today',
  yesterday: 'agent3.history_day_yesterday',
  earlier: 'agent3.history_day_earlier',
};

/**
 * Undoes to a checkpoint watermark, including later manual edits. One executor undo may consume
 * multiple entries while restoring post-stroke validity.
 */
function undoToCheckpoint(undoIndex: number): number {
  const executor = useEditorStore.getState().commandExecutor;
  if (!executor) return 0;
  let steps = 0;
  while (executor.getUndoStackSize() > undoIndex && executor.undo()) steps++;
  return steps;
}

/** Tracks executor undo depth, coalescing map event bursts to one read per frame. */
function useUndoDepth(epoch: number): number | undefined {
  const executor = useEditorStore((s) => s.commandExecutor);
  const eventBus = useEditorStore((s) => s.eventBus);
  const [depth, setDepth] = useState(() => executor?.getUndoStackSize());

  // Session changes capture job settlements that can change depth without a map event.
  useEffect(() => { setDepth(executor?.getUndoStackSize()); }, [executor, epoch]);

  useEffect(() => {
    if (!executor || !eventBus) return undefined;
    let frame = 0;
    const read = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setDepth(executor.getUndoStackSize());
      });
    };
    eventBus.on('cells-changed', read);
    eventBus.on('objects-changed', read);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      eventBus.off('cells-changed', read);
      eventBus.off('objects-changed', read);
    };
  }, [executor, eventBus]);

  return depth;
}

/** Debounce before recomputing map sketch suggestions, in ms. */
const MAP_QUIET_MS = 400;

export interface PanelColumnProps {
  /** Whether the mounted panel is visible. */
  open: boolean;
  /** Whether CharacterHost renders the live character outside this tree. */
  hosted?: boolean;
  /** Whether the panel should follow the frame's veil transition. */
  veiled?: boolean;
}

export default function PanelColumn({ open, hosted = false, veiled = false }: PanelColumnProps) {
  const t = useT();
  const view = useAgentSession(panelView);
  const epoch = useAgentSession((s) => s.epoch);
  // Child progress is transient session state, not part of the persisted parent log.
  const childLive = useAgentSession((s) => s.childLive);
  // Filed state is persisted beside the event-derived panel view.
  const filed = useAgentSession((s) => s.filed);
  // Storage health describes browser persistence rather than a log event.
  const storageNotice = useAgentSession((s) => s.storageNotice);
  // Restored sessions present pending work as a resumption offer.
  const restored = useAgentSession((s) => s.restored);
  const dismissStorageNotice = useAgentSession((s) => s.dismissStorageNotice);
  const cleared = useAgentSession((s) => s.cleared);
  const fileAway = useAgentSession((s) => s.fileAway);
  const clearRecord = useAgentSession((s) => s.clearRecord);
  const settings = useAgentPanelSettings();
  const connected = isConnected(settings);
  // Readiness includes required endpoint and model fields, not only a stored key.
  const ready = connectionReady(settings);
  const model = settings.model[settings.provider] ?? '';
  const mode = useEditorStore((s) => s.editMode.mode);
  // This shared region is both the visible selection and the agent write boundary.
  const region = useEditorStore((s) => s.region);
  // The panel and map scope controls share one region-brush activation flag.
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  const template = useEditorStore((s) => s.gridState?.template.name);
  const liveMapId = useEditorStore((s) => s.gridState?.template.id);
  // The editor locale seeds assistant language when the order has no clear language.
  const uiLocale = useEditorStore((s) => s.locale);
  const mapName = template ? localizedName(template, uiLocale) : '';
  const registry = useEditorStore((s) => s.commandExecutor)?.getRegistry();
  const undoDepth = useUndoDepth(epoch);

  const armed = runnerSettings(settings);
  const forgetKey = settings.forgetKey;
  // A provider probe may revoke optimistic vision support inferred from the model id.
  const probeKey = visionKey(armed.providerId, armed.customBaseUrl, model);
  const [, setVerdictEpoch] = useState(0);
  const keyed = armed.apiKey !== '';
  useEffect(() => {
    if (!keyed) return;
    void ensureModelCatalog();
    const timer = setInterval(() => { void ensureModelCatalog(); }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [keyed, armed.providerId, model]);
  useEffect(() => {
    ensureVisionVerdict({ ...armed, model }, () => setVerdictEpoch((n) => n + 1));
    // Key presence retriggers a skipped probe; the secret itself is not a dependency.
  }, [probeKey, keyed]); // eslint-disable-line react-hooks/exhaustive-deps
  useSyncExternalStore(subscribeCatalog, catalogVersion);
  const capability = modelCapabilities(armed.providerId, model, armed.customBaseUrl);
  const vision = knownVision(probeKey) ?? (capability?.input ? capability.input.includes('image') : PROVIDER_META[armed.providerId].vision(model));
  const deps = useCallback(() => makePanelToolDeps({ vision }), [vision]);

  // The runner reads this stable object; every render refreshes values for the next job or gate.
  const cfg = useRef<RunnerConfig | null>(null);
  if (cfg.current === null && registry) cfg.current = newRunnerConfig(armed, { registry, makeToolDeps: deps, uiLocale });
  useEffect(() => {
    if (!cfg.current || !registry) return;
    refreshRunnerConfig(cfg.current, armed, { registry, makeToolDeps: deps, uiLocale });
  });

  // A single runner preserves the current abort controller and in-flight promise.
  const runnerRef = useRef<ReturnType<typeof createRunner> | null>(null);
  if (!runnerRef.current && cfg.current) runnerRef.current = createRunner(cfg.current);
  const runner = runnerRef.current;

  const send = useCallback((text: string) => { runner?.send(text); }, [runner]);
  const stop = useCallback(() => { runner?.stop(); }, [runner]);
  // Key revocation stops live work before clearing the credential.
  useEffect(() => {
    setLiveJobStop(() => runner?.stop());
    return () => setLiveJobStop(undefined);
  }, [runner]);
  const pause = useCallback(() => { runner?.pause(); }, [runner]);
  const resume = useCallback(() => { runner?.resume(); }, [runner]);
  // Ends the runner's current backoff without starting a parallel attempt.
  const retryNow = useCallback(() => { runner?.retryNow(); }, [runner]);

  /** Management is view state, so opening and closing it leaves the session projection untouched. */
  const [managing, setManaging] = useState(false);

  /** Handles dock actions whose effects live outside PanelShell. */
  const dockAct = useCallback((act: DockActId) => {
    if (act === 'try-again') {
      const last = panelView(useAgentSession.getState()).jobs.slice(-1)[0];
      if (last) runner?.send(last.orderText);
      return;
    }
    if (act === 'edit-model') { setManaging(true); return; }
    if (act === 'fix-key') forgetKey(armed.providerId);
  }, [runner, forgetKey, armed.providerId]);

  /** Exports corrupt stored bytes when available, otherwise the serialized live session log. */
  const exportSessionLog = useCallback(() => {
    const state = useAgentSession.getState();
    downloadJSON(state.corruptRaw ?? serializeLog(state.log), `petit-agent-log-${Date.now()}.json`);
  }, []);

  /** Handles banner actions whose effects live outside PanelShell. */
  const bannerAction = useCallback((action: BannerActionId) => {
    if (action === 'fix-key') { forgetKey(armed.providerId); return; }
    if (action === 'try-again') { dockAct('try-again'); return; }
    if (action === 'edit-model') { dockAct('edit-model'); return; }
    if (action === 'export-log') exportSessionLog();
  }, [dockAct, forgetKey, armed.providerId]);

  /** Settles a held job before filing the resulting record in past jobs. */
  const setAside = useCallback((orderSeq: number) => {
    runner?.setAside();
    fileAway(orderSeq);
  }, [runner, fileAway]);

  /** Answers the current gate; stale or duplicate answers become a localized warning. */
  const gateAnswer = useCallback((gateId: string, answer: 'allow' | 'skip' | 'words', words?: string) => {
    if (gateId === '') return;
    try {
      answerGate(useAgentSession.getState().log, gateId, answer, words);
    } catch {
      showToast(t('agent3.gate_stale'), 'warning');
    }
  }, [t]);

  const recall = useCallback((steerSeq: number) => {
    recallSteer(useAgentSession.getState().log, steerSeq);
  }, []);

  /** Runner activity is authoritative because restored logs have no live controller. */
  const running = runner?.active() ?? false;

  /** Connection snapshot used by the in-flight job, or undefined while idle. */
  const liveConnection = runner?.connection();

  /** Hides the panel without pausing or stopping the runner. */
  const collapse = useCallback(() => { useEditorStore.getState().setAssistantOpen(false); }, []);

  /** Persists docking intent; narrow layouts temporarily release the panel without clearing it. */
  const pinRoom = usePinRoom();
  const pinned = useEditorStore((s) => s.assistantPinned);
  const setPinned = useEditorStore((s) => s.setAssistantPinned);
  const setDockSide = useEditorStore((s) => s.setAssistantDockSide);
  const togglePin = useCallback(() => { setPinned(!useEditorStore.getState().assistantPinned); }, [setPinned]);
  /** Persists the opposite dock side. */
  const switchSide = useCallback(() => {
    setDockSide(useEditorStore.getState().assistantDockSide === 'left' ? 'right' : 'left');
  }, [setDockSide]);
  // Notify only when an already-usable dock loses room.
  const hadRoom = useRef(pinRoom);
  useEffect(() => {
    const lost = hadRoom.current && !pinRoom;
    hadRoom.current = pinRoom;
    if (lost && pinned) showToast(t('agent3.pin_no_room'), 'info');
  }, [pinRoom, pinned, t]);

  const openManage = useCallback(() => { setManaging((on) => !on); }, []);
  const closeManage = useCallback(() => { setManaging(false); }, []);
  // Losing the connection returns the job zone to setup.
  useEffect(() => { if (!connected) setManaging(false); }, [connected]);
  // Management is transient panel state and closes with the panel.
  useEffect(() => { if (!open) setManaging(false); }, [open]);

  /** Removes settled records without changing the map. */
  const clearJobs = useCallback(() => {
    const store = useAgentSession.getState();
    store.clearRecords(panelView(store).jobs.map((job) => job.orderSeq));
  }, []);

  const rewind = useCallback((checkpoint: Checkpoint) => { undoToCheckpoint(checkpoint.undoIndex); }, []);
  const rollBack = useCallback((job: JobView) => {
    const first = job.checkpoints[0];
    if (first) undoToCheckpoint(first.undoIndex);
  }, []);

  /** Order sequence of the archive record occupying the job zone. */
  const [openRecord, setOpenRecord] = useState<number | null>(null);
  const openTicket = useCallback((job: JobView) => { setOpenRecord(job.orderSeq); }, []);
  const closeRecord = useCallback(() => { setOpenRecord(null); }, []);
  useEffect(() => { if (!open) setOpenRecord(null); }, [open]);
  // Active work closes the archive surface occupying the job zone.
  const jobInFlight = view.current !== undefined;
  useEffect(() => { if (jobInFlight) setOpenRecord(null); }, [jobInFlight]);
  const clearOne = useCallback((orderSeq: number) => {
    clearRecord(orderSeq);
    setOpenRecord((seq) => (seq === orderSeq ? null : seq));
  }, [clearRecord]);

  /** Resubmits a capped job only while idle; active sends are interpreted as steering. */
  const keepGoing = useCallback((job: JobView) => {
    if (runner?.active() === true) return;
    runner?.send(job.orderText);
  }, [runner]);

  /** Returns the same calendar-day label used to group the archive record. */
  const recordStamp = useCallback((job: JobView) => t(DAY_STAMP_KEY[dayOf(job.orderAt, Date.now())]), [t]);

  /** Projects transient child progress into the helper lane. */
  const lane = useMemo(
    () => (childLive
      ? {
        task: childLive.task, ops: childLive.ops,
        ...(childLive.opName ? { opName: childLive.opName } : {}),
        ...(childLive.label ? { label: childLive.label } : {}),
      }
      : undefined),
    [childLive],
  );

  /** Indexes persisted and streaming tool inputs for gate and record thumbnails. */
  const callInputs = useMemo(() => {
    const inputs = new Map<string, Record<string, unknown>>();
    const state = useAgentSession.getState();
    for (const e of eventsOf(state.log)) {
      if (e.kind !== 'assistant') continue;
      for (const p of e.parts) if (p.kind === 'tool') inputs.set(p.callId, p.input);
    }
    for (const p of state.live ?? []) if (p.kind === 'tool') inputs.set(p.callId, p.input);
    return inputs;
  }, [epoch]);

  /** Gate thumbnails show the whole island with the affected footprint marked in place. */
  const gateThumb = useCallback((ask: AskRecord) => {
    const box = ask.callId === undefined ? undefined : callFootprint(callInputs.get(ask.callId));
    return box
      ? <MarkedShot box={box} width={GATE_THUMB_W} height={GATE_THUMB_H} testId="gate-shot" />
      : null;
  }, [callInputs]);

  /** Renders an option's own footprint when it names a location. */
  const optionThumb = useCallback((option: GateOption) => {
    const box = callFootprint(option.rect);
    return box
      ? <MarkedShot box={box} width={OPTION_THUMB.width} height={OPTION_THUMB.height} testId="option-shot" />
      : null;
  }, []);

  /** Captures the job region, its write-footprint union, or the whole map when bounds are unavailable. */
  const recordShot = useCallback((job: JobView) => {
    const box = job.region
      ? { origin: { x: Math.min(job.region.x1, job.region.x2), y: Math.min(job.region.y1, job.region.y2) },
        width: Math.abs(job.region.x2 - job.region.x1) + 1,
        height: Math.abs(job.region.y2 - job.region.y1) + 1 }
      : unionBox(job.ops.filter((op) => !op.isRead).map((op) => callFootprint(callInputs.get(op.callId))));
    return <MapShot box={box} width={POSTCARD.width} height={POSTCARD.height} whole />;
  }, [callInputs]);

  /** Separates records from another map from records whose map identity cannot be verified. */
  const { otherMap, unknownMap } = useMemo(() => {
    const other = new Set<number>();
    const unknown = new Set<number>();
    if (liveMapId !== undefined) {
      for (const job of view.jobs) {
        if (job.mapId === undefined) unknown.add(job.orderSeq);
        else if (job.mapId !== liveMapId) other.add(job.orderSeq);
      }
    }
    return { otherMap: other, unknownMap: unknown };
  }, [view.jobs, liveMapId]);

  /** Compact model and oversight label for the management header. */
  const connectionMeta = [model === '' ? '' : shortModel(model), t(OVERSIGHT_COPY[settings.oversight].label)]
    .filter((part) => part !== '')
    .join(', ');

  /** Shared region summary used by the panel and agent boundary checks. */
  const liveRegion = useMemo(() => regionBounds(region), [region]);

  /** Sketch analysis runs only while idle and after map changes settle. */
  const grid = useEditorStore((s) => s.gridState);

  /** Counts resolved cells for a gated write; single-cell calls omit the redundant count. */
  const gateScope = view.gate?.scope;
  const gateCallId = view.gate?.callId;
  const gateCells = useMemo(() => {
    if (gateScope !== 'tool' || gateCallId === undefined || !grid) return undefined;
    const input = callInputs.get(gateCallId);
    if (!input) return undefined;
    const n = resolveCells(input, grid).length;
    return n > 1 ? n : undefined;
  }, [gateScope, gateCallId, callInputs, grid]);
  const mapEpoch = `${grid?.cellsVersion ?? 0}:${grid?.objectsVersion ?? 0}`;
  const [settledEpoch, setSettledEpoch] = useState(mapEpoch);
  useEffect(() => {
    if (mapEpoch === settledEpoch) return undefined;
    const id = setTimeout(() => setSettledEpoch(mapEpoch), MAP_QUIET_MS);
    return () => clearTimeout(id);
  }, [mapEpoch, settledEpoch]);
  const wantSketches = open && connected && view.current === undefined;
  const sketches = useMemo(
    () => (wantSketches && grid ? proposeSketches(grid) : []),
    // A replacement grid must recompute even when its version counters match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wantSketches, grid, settledEpoch],
  );

  /** Hands a sketch suggestion to PanelShell's composer without sending it. */
  const [fill, setFill] = useState<{ text: string; seq: number } | undefined>(undefined);
  const handOrder = useCallback((text: string) => {
    setFill((last) => ({ text, seq: (last?.seq ?? 0) + 1 }));
  }, []);
  const sketchbook = sketches.length > 0
    ? <Sketchbook ideas={sketches} onOrder={handOrder} mapVersion={settledEpoch} />
    : undefined;

  /** Toggles the shared scope screen and region brush for this panel. */
  const markRegion = useCallback(() => {
    const on = !useEditorStore.getState().selectingRegion;
    setSelectingRegion(on, 'agent');
  }, [setSelectingRegion]);

  /** Tracks whether this panel, rather than the generate shelf, armed the shared region brush. */
  const armedHere = useEditorStore((s) => s.selectingRegion && s.regionSelectionOwner === 'agent');

  // Closing the panel disarms a brush it owns and removes the overlay.
  useEffect(() => {
    if (open || !armedHere) return;
    setSelectingRegion(false);
    host.buildableRegion.clear();
  }, [open, armedHere, setSelectingRegion]);

  /** Clears through the brush handler when mounted, with a direct store fallback. */
  const clearRegion = useCallback(() => {
    clearRegionSelection();
    if (useEditorStore.getState().region.length > 0) useEditorStore.getState().setRegion([]);
  }, []);

  /** Renders the live region at the requested thumbnail size. */
  const regionShot = useCallback(
    (bounds: RegionBounds, width: number, height: number) => (
      <RegionVignette bounds={bounds} width={width} height={height} />
    ),
    [],
  );

  // Keep the region outlined while open; preserve an overlay owned by active map scope controls.
  useEffect(() => {
    if (!open) return undefined;
    if (region.length > 0) host.buildableRegion.show(region);
    else host.buildableRegion.clear();
    return () => { if (!useEditorStore.getState().selectingRegion) host.buildableRegion.clear(); };
  }, [open, region]);

  // Pulse once per blocked write call to identify the active region boundary.
  const blockedCallId = view.current?.ops.filter((op) => op.status === 'blocked').slice(-1)[0]?.callId;
  const pulsed = useRef<string | null>(null);
  useEffect(() => {
    if (blockedCallId === undefined || pulsed.current === blockedCallId) return;
    pulsed.current = blockedCallId;
    host.buildableRegion.pulse(
      seconds('panel.region.pulse') * 1000,
      amplitude('panel.region.pulse') ?? 0,
    );
  }, [blockedCallId]);

  /** Only an actionable plan gate borrows extra vertical space. */
  const planGateStanding = view.gate?.scope === 'plan';
  /** Free panels use frame bounds; docked panels fill the window edge and follow sheet parallax. */
  const { place, side, aside } = useDockStage();
  const docked = place === 'ground';
  const cap = docked
    ? PINNED_PANEL.height
    : panelMaxHeight(mode, PANEL_LEAST, planGateStanding ? GATE_BORROW : 0);
  const drift = (1 - aside) * DOCK_PARALLAX * dockTravelSign(side) * -1;
  // MotionValue updates transform between React renders; cleanup removes the dock transform.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!docked) return undefined;
    const off = dockAside.on('change', (v) => {
      const el = wrapRef.current;
      if (!el) return;
      const d = (1 - v) * DOCK_PARALLAX * dockTravelSign(side) * -1;
      el.style.transform = d !== 0 ? `translateX(${d}px)` : '';
    });
    return () => {
      off();
      if (wrapRef.current) wrapRef.current.style.transform = '';
    };
  }, [docked, side]);
  const wrapper: CSSProperties = useMemo(() => ({
    position: 'fixed',
    ...(docked
      ? { [dockEdge(side)]: PINNED_PANEL.edge, top: PINNED_PANEL.top, bottom: 0 }
      : { left: PANEL_LEFT, top: panelTop(PANEL_LEAST) }),
    display: 'flex',
    // Invisible dock phases must not intercept map input.
    pointerEvents: place === 'leaving' || place === 'folded' ? 'none' : 'auto',
    zIndex: docked ? z.ground : planGateStanding ? z.column : z.panel,
    // Discrete visibility removes the veiled panel from hit testing and the accessibility tree.
    opacity: veiled ? 0 : 1,
    visibility: veiled ? 'hidden' : 'visible',
    transition: cssMotion(veiled ? 'frame.veil' : 'frame.unveil', ['opacity', 'visibility']),
    ...(docked && drift !== 0 ? { transform: `translateX(${drift}px)` } : null),
  } as CSSProperties), [docked, side, drift, planGateStanding, veiled, place]);

  return (
    <AnimatePresence>
      {/* Keep one panel node through dock and fold stages; docked collapse stays until the sheet covers it. */}
      {(open || docked || place === 'folded') && (
        <div key="assistant-panel" ref={wrapRef} data-testid="shell-assistant-panel" style={wrapper}>
          <PanelShell
            view={view}
            connected={connected}
            ready={ready}
            running={running}
            {...(mapName ? { mapName } : {})}
            providerName={providerName(armed.providerId, t)}
            {...(model ? { modelName: prettyModel(model) } : {})}
            {...(liveConnection ? { liveConnection } : {})}
            maxHeight={cap}
            {...(lane ? { lane } : {})}
            {...(undoDepth !== undefined ? { undoDepth } : {})}
            filed={filed}
            cleared={cleared}
            storageNotice={storageNotice}
            onDismissStorage={dismissStorageNotice}
            restored={restored}
            onSetAside={setAside}
            onBannerAction={bannerAction}
            openRecord={openRecord}
            onFileAway={fileAway}
            onOpenTicket={openTicket}
            onCloseRecord={closeRecord}
            onClearRecord={clearOne}
            onRewindAll={rollBack}
            onKeepGoing={keepGoing}
            recordShot={recordShot}
            recordStamp={recordStamp}
            region={liveRegion}
            marking={selectingRegion}
            {...(gateCells !== undefined ? { gateCells } : {})}
            onMarkRegion={markRegion}
            onClearRegion={clearRegion}
            regionShot={regionShot}
            {...(sketchbook ? { sketchbook } : {})}
            {...(fill ? { fill } : {})}
            onSend={send}
            onStop={stop}
            onPause={pause}
            onResume={resume}
            onRetryNow={retryNow}
            onDockAct={dockAct}
            onGateAnswer={gateAnswer}
            gateThumb={gateThumb}
            optionThumb={optionThumb}
            {...(otherMap.size > 0 ? { otherMap } : {})}
            {...(unknownMap.size > 0 ? { unknownMap } : {})}
            onRecallSteer={recall}
            onRewind={rewind}
            onRollBack={rollBack}
            onCollapse={collapse}
            onManage={openManage}
            managing={managing}
            onManageDone={closeManage}
            onClearJobs={clearJobs}
            connectionMeta={connectionMeta}
            hosted={hosted}
            pinned={docked}
            dockSide={side}
            {...(place === 'leaving' || place === 'folded' ? { away: place } : {})}
            pinBlocked={!pinRoom}
            onTogglePin={togglePin}
            onSwitchSide={switchSide}
          />
        </div>
      )}
    </AnimatePresence>
  );
}
