/*
 * PanelColumn.tsx — the panel's LIVE half, and the app's one lazy chunk for the assistant.
 *
 * `PanelShell` renders projections and calls verbs (its own header states it reads no store); this
 * file is the other side of that seam: it reads the session log, the settings and the live map, it
 * builds the runner, and it stands the column where the frame says (`ui/shell/panel-frame.ts`).
 * Everything the assistant WEIGHS — the tool layer, the provider adapters and their SDKs — is
 * reached from here and from nowhere the first load can see, which is what the chunk boundary in
 * `Shell.tsx` (`lazy(() => import('../agent/PanelColumn'))`) is for and what
 * `__tests__/ui/eager-bundle.test.ts` holds.
 *
 * ONE RUNNER FOR THE APP'S LIFE, AND ITS CONFIG IS KEPT CURRENT RATHER THAN REBUILT. The runner owns
 * the in-flight job's abort controller and the promise that says a job is running, so a rebuilt
 * runner is a running job nobody can stop or pause and a `send` that would start a second one over
 * the same log. It reads its provider, key and model at JOB START off the config object it was
 * handed, and the oversight tier at every gate decision — so keeping that one object up to date (the
 * effect below) is what lets a settings change reach the next job, and lets an oversight change
 * reach the next tool call of the one running, without ever taking the handle off it. It is also why
 * the column stays MOUNTED once opened (`Shell.tsx` keeps it) rather than being mounted with the
 * panel.
 *
 * WHAT IT HANDS THE RUNNER — the per-job tool dependencies and the config object itself — is
 * `panel-runner.ts`, beside this file and imported by nothing else: both are decisions that fail
 * silently when they are wrong, and both are checkable without mounting a tree.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { answerGate } from '../../agent/core/gates';
import { eventsOf } from '../../agent/core/log';
import type { AskRecord, JobView } from '../../agent/core/project-view';
import { recallSteer } from '../../agent/core/steering';
import type { GateOption } from '../../agent/core/types';
import { createRunner, type RunnerConfig } from '../../agent/exec/runner';
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
import { z } from '../design/styles';
import { ScopeScreen } from '../shell/bars/ScopeScreen';
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

/** The tools that only LOOK at the map, by name — the ops list dims them, since a job's story is
 *  what it changed. Published to the store as this CHUNK LOADS rather than passed per read: it is
 *  the fold's own input, and the character's host folds the same log from outside this chunk, so a
 *  set held here and handed in per call would leave the two reading one log two ways. */
const READ_TOOLS: ReadonlySet<string> = new Set(
  TOOL_SCHEMAS.map((s) => s.name).filter((name) => !WRITE_TOOLS.has(name)),
);
setReadTools(READ_TOOLS);

/**
 * THE LEAST ROOM THE PANEL IS WORTH STANDING IN, in the frame's own px: everything that stands
 * whatever the record does, plus a record worth the name. The frame's two clearances yield to it
 * rather than let the panel empty itself (`shell/panel-frame.ts`'s `panelTop`/`panelMaxHeight`).
 *
 * Derived, and derived HERE, because the two halves are owned by two layers: the panel knows its own
 * skeleton and the frame knows the room. Handing the number down is also what keeps `panel-frame`
 * out of a cycle — the panel's own tokens already read the frame's column width.
 */
const PANEL_LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;


/** The gate card's picture, in px: the artifact's own `.askcard .thumb` box, and the aspect the
 *  capture is framed to. */
const GATE_THUMB_W = 104;
const GATE_THUMB_H = 74;

/** What each day's records are stamped with on the archive card and the dock's reading meta. */
const DAY_STAMP_KEY: Record<Day, string> = {
  today: 'agent3.history_day_today',
  yesterday: 'agent3.history_day_yesterday',
  earlier: 'agent3.history_day_earlier',
};

/**
 * Undoes the editor back to a checkpoint's watermark and reports how many steps that took.
 *
 * A checkpoint records the undo depth BEFORE the work it precedes, so popping down to it takes that
 * work off the map — AND EVERYTHING LAID ON TOP OF IT SINCE, whoever laid it. That is the whole
 * reason `ui/agent/rollback.ts` exists: no press reaches here without a confirm that has named the
 * number, the user's own later steps counted separately.
 *
 * ONE UNDO IS NOT ONE ENTRY. `CommandExecutor.undo` keeps popping until the state passes post-stroke
 * validation, so a single call can carry the stack BELOW `undoIndex`. The condition is re-read every
 * time round, which is the finest clamp the executor offers; the surplus is a repair the map needed
 * either way, and `useUndoDepth` reports where the stack actually landed.
 */
function undoToCheckpoint(undoIndex: number): number {
  const executor = useEditorStore.getState().commandExecutor;
  if (!executor) return 0;
  let steps = 0;
  while (executor.getUndoStackSize() > undoIndex && executor.undo()) steps++;
  return steps;
}

/**
 * The live undo depth, for the rolled-back reading of a settled job.
 *
 * The executor publishes no depth of its own, so this reads it after whatever could have changed it:
 * the two map events, coalesced to one read per frame (a stroke and a generate both burst them), and
 * every session change, since a job settling is the other moment the answer moves.
 */
function useUndoDepth(epoch: number): number | undefined {
  const executor = useEditorStore((s) => s.commandExecutor);
  const eventBus = useEditorStore((s) => s.eventBus);
  const [depth, setDepth] = useState(() => executor?.getUndoStackSize());

  // A job settling is a moment the depth can have moved with no map event of its own to say so.
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

/** How long the map has to be still before the sketch analysis reads it again. A stroke is a burst
 *  of commands and the panel re-renders through all of it; the reading is only wanted once the hand
 *  has stopped. */
const MAP_QUIET_MS = 400;

export interface PanelColumnProps {
  /** Whether the panel is showing. The column stays mounted either way (see the header). */
  open: boolean;
  /** The one live character stands in her own layer outside this tree, in the seat the frame anchors
   *  this column to (`character/CharacterHost`). The desk reserves her box rather than drawing her. */
  hosted?: boolean;
  /** The interface has been put away. This column stands outside the frame's plane, so the frame's
   *  veil cannot reach it and it wears the same two declared motions itself. */
  veiled?: boolean;
}

export default function PanelColumn({ open, hosted = false, veiled = false }: PanelColumnProps) {
  const t = useT();
  const view = useAgentSession(panelView);
  const epoch = useAgentSession((s) => s.epoch);
  // THE HELPER LANE'S LIVE HALF, and the one panel fact that is NOT a projection of the log: a
  // delegate's child keeps its own log, which dies with the call, so its progress is published on
  // the store instead (`setChildLive`, from the executor's `onChildProgress`). Subscribed directly
  // rather than folded into `panelView` — it bumps no epoch, and a reload has no live child to show.
  const childLive = useAgentSession((s) => s.childLive);
  // WHICH SETTLED RECORDS HAVE BEEN PUT AWAY. Not a fold of the log (whether a card has been
  // dismissed is not something the model or the record is derived from), so it is persisted beside
  // it and subscribed here, where the panel's other store facts come from.
  const filed = useAgentSession((s) => s.filed);
  // THE SESSION'S STORAGE HEALTH, which the panel banners. It is not a fold of the log — a save that
  // failed is a fact about the browser, not about the job — so it is subscribed here beside the
  // other store facts, and put down through the store's own verb.
  const storageNotice = useAgentSession((s) => s.storageNotice);
  // WHETHER THIS SESSION CAME BACK FROM STORAGE, which is what tells the panel a held job is an
  // OFFER rather than a hold the user is standing in. Falls the moment anything is appended.
  const restored = useAgentSession((s) => s.restored);
  const dismissStorageNotice = useAgentSession((s) => s.dismissStorageNotice);
  const cleared = useAgentSession((s) => s.cleared);
  const fileAway = useAgentSession((s) => s.fileAway);
  const clearRecord = useAgentSession((s) => s.clearRecord);
  const settings = useAgentPanelSettings();
  const connected = isConnected(settings);
  // A KEY IS NOT A CONNECTION THAT CAN CARRY AN ORDER. The second question — an address where the
  // provider is the user's own server, a model id to name in the request — is what decides whether
  // the panel may stand at idle, and the panel gets both answers rather than deriving one.
  const ready = connectionReady(settings);
  const model = settings.model[settings.provider] ?? '';
  const mode = useEditorStore((s) => s.editMode.mode);
  // THE PAINTED REGION, LIVE. The chip is a VIEW of this one list and never a copy: the agent's
  // write tools are bound to exactly it, so a panel that kept its own idea of the scope could claim
  // a boundary the tools do not hold. A region painted with the map's own scope tools before the
  // panel ever opened therefore shows a docked chip with no event of any kind — this subscription
  // is the whole mechanism.
  const region = useEditorStore((s) => s.region);
  // Whether the map is holding the pencil. It is the STORE's flag rather than a panel-local one for
  // the same reason: the scope screen arms the very same brush, and two flags would let the panel
  // wear the marking state over a brush nobody armed (or, worse, miss the one that is live).
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  // Which map the session is standing on, for the dock meta's fallback: the panel says nothing about
  // the map itself, so the NAME is all it needs and the store is where that name lives.
  const template = useEditorStore((s) => s.gridState?.template.name);
  // The identity behind the name, and the whole of the rollback guard's live side.
  const liveMapId = useEditorStore((s) => s.gridState?.template.id);
  // The editor's display language rides along as the system prompt's `{uiLanguage}` fallback: which
  // language the assistant opens in before the user has typed anything readable. Subscribed rather
  // than read at job start, which is the same answer — a locale change commits a render long before
  // a press can start a job — without the runner reaching into the editor's store itself.
  const uiLocale = useEditorStore((s) => s.locale);
  const mapName = template ? localizedName(template, uiLocale) : '';
  const registry = useEditorStore((s) => s.commandExecutor)?.getRegistry();
  const undoDepth = useUndoDepth(epoch);

  const armed = runnerSettings(settings);
  const forgetKey = settings.forgetKey;
  const vision = PROVIDER_META[armed.providerId].vision(model);
  const deps = useCallback(() => makePanelToolDeps({ vision }), [vision]);

  // The one config object the runner reads at every job start, kept current rather than replaced —
  // see the header. No dependency list: the settings it carries are plain values on a store this
  // component already re-renders with, and the cheapest correct answer is to refresh them after
  // every one of those renders.
  const cfg = useRef<RunnerConfig | null>(null);
  if (cfg.current === null && registry) cfg.current = newRunnerConfig(armed, { registry, makeToolDeps: deps, uiLocale });
  useEffect(() => {
    if (!cfg.current || !registry) return;
    refreshRunnerConfig(cfg.current, armed, { registry, makeToolDeps: deps, uiLocale });
  });

  // The runner is built once, on the first render that has a registry to give it, and lives as long
  // as this component does.
  const runnerRef = useRef<ReturnType<typeof createRunner> | null>(null);
  if (!runnerRef.current && cfg.current) runnerRef.current = createRunner(cfg.current);
  const runner = runnerRef.current;

  const send = useCallback((text: string) => { runner?.send(text); }, [runner]);
  const stop = useCallback(() => { runner?.stop(); }, [runner]);
  // The key vault's own way to end a job it is about to remove the key for: a revocation mid-run
  // would otherwise leave the loop editing the map behind a setup form (`settings.ts`'s own note).
  useEffect(() => {
    setLiveJobStop(() => runner?.stop());
    return () => setLiveJobStop(undefined);
  }, [runner]);
  const pause = useCallback(() => { runner?.pause(); }, [runner]);
  const resume = useCallback(() => { runner?.resume(); }, [runner]);
  // The dock's countdown presses this: it ends the ladder's own backoff early rather than starting a
  // second attempt beside the one the runner is already holding.
  const retryNow = useCallback(() => { runner?.retryNow(); }, [runner]);

  /**
   * THE GEAR'S ONE DOOR, and its open state is held here rather than in the panel because the panel
   * renders projections: which surface the job zone is showing is a decision, not a fold of the log.
   * The gear TOGGLES — on the manage face itself it stands lit and pressing it walks back out — and
   * Done closes it. Nothing else is touched, so the session the gear was pressed from is the session
   * that comes back (escape invariant 4).
   *
   * It stands above the act handlers because the unserved-model repair opens this card.
   */
  const [managing, setManaging] = useState(false);

  /**
   * A terminal face's worded act, with the verb this column actually has for it.
   *
   * `try-again` files the same order again, which is what "another attempt" means once the job has
   * settled. `fix-key` drops the refused key, which is the one thing standing between the panel and
   * its own key-entry screen: a key the provider refuses is not a key worth keeping, and the setup
   * surface takes over the job zone the moment none is held. `edit-model` opens THIS component's own
   * settings card, since the model row lives behind the gear and nowhere else. `new-order` and
   * `edit-endpoint` never arrive here: the composer one points at and the connection screen the other
   * opens are both `PanelShell`'s own children, and it answers those two itself.
   */
  const dockAct = useCallback((act: DockActId) => {
    if (act === 'try-again') {
      const last = panelView(useAgentSession.getState()).jobs.slice(-1)[0];
      if (last) runner?.send(last.orderText);
      return;
    }
    if (act === 'edit-model') { setManaging(true); return; }
    if (act === 'fix-key') forgetKey(armed.providerId);
  }, [runner, forgetKey, armed.providerId]);

  /**
   * WRITE THE RAW LOG OUT, for a bug report.
   *
   * TWO SOURCES AND ONE VERB, chosen by which trouble asked. A corrupt notice is ABOUT bytes that
   * did not parse, and those are the evidence — the store holds them precisely because the fresh log
   * saves over them within the second (`store.ts:corruptRaw`). Every other fault is about a session
   * that IS readable, so the current log serialized is what a reader would need.
   *
   * The download itself is `io/image-export.ts:downloadJSON`, the app's one writer: the agent's own
   * tool sandbox forbids storage and the DOM, but that binds the TOOLS rather than this seam, and a
   * file the user asked for is written the way every other file the user asks for is.
   */
  const exportSessionLog = useCallback(() => {
    const state = useAgentSession.getState();
    downloadJSON(state.corruptRaw ?? serializeLog(state.log), `petit-agent-log-${Date.now()}.json`);
  }, []);

  /**
   * A BANNER'S REPAIR PILL, with the half this side of the seam owns.
   *
   * THE PANEL ANSWERS THE OTHER HALF ITSELF, and the split is by what a verb TOUCHES: opening the
   * connection screen at a step, focusing the composer and demoting the notice are all things inside
   * `PanelShell`'s own tree, so it does those and reports the press here. What is left is the store
   * side — dropping a key the provider refused, filing the same order again, writing the log out.
   * `set-aside` reaches `fileAway` through the panel's own `onFileAway`, so it is not repeated here.
   */
  const bannerAction = useCallback((action: BannerActionId) => {
    if (action === 'fix-key') { forgetKey(armed.providerId); return; }
    if (action === 'try-again') { dockAct('try-again'); return; }
    if (action === 'edit-model') { dockAct('edit-model'); return; }
    if (action === 'export-log') exportSessionLog();
  }, [dockAct, forgetKey, armed.providerId]);

  /**
   * PUT A HELD JOB AWAY: settle it, then file the record it leaves.
   *
   * BOTH HALVES, AND IN THAT ORDER (escape invariant 2). A paused job owns the composer's resume
   * route and the session's current seat, so hiding its card alone would leave a panel with no way
   * to a fresh order; and settling it alone would put a stop card up over a job the user has just
   * said they are done reading. The record survives as a past-jobs row, which is what makes "set
   * aside" a place the job now lives rather than a disappearance.
   */
  const setAside = useCallback((orderSeq: number) => {
    runner?.setAside();
    fileAway(orderSeq);
  }, [runner, fileAway]);

  /**
   * The gate's answers, all three routes.
   *
   * A QUICK PILL AND A CHOSEN OPTION ARE ANSWERS IN WORDS, sent for the user rather than typed by
   * them: the log holds the sentence, and the offer standing beside it on the ask is what lets the
   * card read it back as the pill or the card it was.
   *
   * `answerGate` THROWS on a gateId that is unknown or already answered, deliberately — a double
   * answer would corrupt the one-ask-one-answer invariant. Called bare inside a click handler that
   * is an uncaught error in the render tree rather than a refusal, so the refusal is caught and
   * SAID: every other verb on this seam degrades quietly, and this is the one that cannot.
   */
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

  /**
   * Whether a job is really running, which only the runner knows.
   *
   * READ AT RENDER, not held: `active()` reads the in-flight PROMISE rather than a boolean, so it
   * cannot desync, and this component re-renders on every log append (the `epoch` subscription
   * above) — which is every moment the answer can move. The phase reading `PanelShell` falls back
   * to agrees in the ordinary case and not in the one that matters: a log whose tail reads active
   * with no runner behind it (an `order` orphaned by a reload, a session adopted from storage)
   * showed a live composer Stop calling into an abort controller that does not exist.
   */
  const running = runner?.active() ?? false;

  /**
   * The connection the job in flight LAUNCHED with, read at render like `running` and for the same
   * reason: it is the runner's own answer and it moves exactly when the answer does. Undefined where
   * nothing is running, which is what makes it the settings card's test for "is a job live".
   */
  const liveConnection = runner?.connection();

  /**
   * PUT THE PANEL AWAY, and never anything more than that.
   *
   * UNCONDITIONAL: no session state is read here or in `PanelShell`, which is the whole invariant —
   * setup, an open gate and a refused key all fold, and the parked character is the way back in. It
   * is NOT a pause and it does not touch the runner: a job keeps running with the panel shut, and
   * the chip at the character's shoulder says so.
   */
  const collapse = useCallback(() => { useEditorStore.getState().setAssistantOpen(false); }, []);

  /**
   * DOCK THE PANEL, OR SET IT FREE — the one thing about the panel that is remembered between
   * sessions, so it is a preference write rather than panel state (`state/slices/shell.ts`).
   *
   * IT IS AN INTENT AND THE LAYOUT IS DERIVED FROM IT. Docking stands the whole interface in what is
   * left of the window, so it needs a window wide enough for that; a window that narrows past the
   * bound sets the panel free WITHOUT forgetting what was asked for, and says so once. The control
   * then stands and refuses rather than disappearing, and the dock returns with the room.
   */
  const pinRoom = usePinRoom();
  const pinned = useEditorStore((s) => s.assistantPinned);
  const setPinned = useEditorStore((s) => s.setAssistantPinned);
  const setDockSide = useEditorStore((s) => s.setAssistantDockSide);
  const togglePin = useCallback(() => { setPinned(!useEditorStore.getState().assistantPinned); }, [setPinned]);
  /** MOVE THE DOCK TO THE OTHER END OF THE WINDOW. A preference write like the dock itself, and the
   *  sequence reads it: the sheet comes back over the ground, the ground crosses under it, and the
   *  sheet slides off the other way (`shell/use-dock.ts`). */
  const switchSide = useCallback(() => {
    setDockSide(useEditorStore.getState().assistantDockSide === 'left' ? 'right' : 'left');
  }, [setDockSide]);
  // Said once per LOSS of room, not per resize event and not at boot: a window that opens too narrow
  // has the refusing control to explain itself, and a toast on arrival would be a notice about
  // something the visitor has not done yet.
  const hadRoom = useRef(pinRoom);
  useEffect(() => {
    const lost = hadRoom.current && !pinRoom;
    hadRoom.current = pinRoom;
    if (lost && pinned) showToast(t('agent3.pin_no_room'), 'info');
  }, [pinRoom, pinned, t]);

  const openManage = useCallback(() => { setManaging((on) => !on); }, []);
  const closeManage = useCallback(() => { setManaging(false); }, []);
  // A key that goes away takes the manage card with it: the setup screen owns the job zone from that
  // moment, and a card left "open" behind it would come back on the next connection.
  useEffect(() => { if (!connected) setManaging(false); }, [connected]);
  // AND SO DOES A FOLD. The card is chrome this component opened over the session, not a state of
  // it, so putting the panel away puts the card away: otherwise the next press on the character
  // opened the panel onto a settings surface the user had already left. Keyed on the panel being
  // shut rather than on the collapse verb, because the shell's own block writes the flag directly
  // and never calls it.
  useEffect(() => { if (!open) setManaging(false); }, [open]);

  /** Removes every settled record. The map keeps what was built — nothing here touches the editor. */
  const clearJobs = useCallback(() => {
    const store = useAgentSession.getState();
    for (const job of panelView(store).jobs) store.clearRecord(job.orderSeq);
  }, []);

  const rewind = useCallback((checkpoint: Checkpoint) => { undoToCheckpoint(checkpoint.undoIndex); }, []);
  const rollBack = useCallback((job: JobView) => {
    const first = job.checkpoints[0];
    if (first) undoToCheckpoint(first.undoIndex);
  }, []);

  /**
   * WHICH PAST RECORD IS OPEN, by order seq.
   *
   * Held here rather than in the panel for the same reason the manage card's flag is: which surface
   * the job zone is showing is a DECISION, not a fold of the log. Back closes it, and so does a fold
   * — a record left open behind a collapsed panel is a surface the user has already left standing
   * over the session they come back for.
   */
  const [openRecord, setOpenRecord] = useState<number | null>(null);
  const openTicket = useCallback((job: JobView) => { setOpenRecord(job.orderSeq); }, []);
  const closeRecord = useCallback(() => { setOpenRecord(null); }, []);
  useEffect(() => { if (!open) setOpenRecord(null); }, [open]);
  // AND SO DOES A JOB STARTING. An opened record COVERS the job zone, so the panel withholds it
  // while a job is in flight — and a flag that survived the withholding would spring the record
  // open by itself at the settle, over the receipt of the job the user was waiting for. Cleared at
  // the start, so the state the panel is not showing is a state it is not holding either.
  const jobInFlight = view.current !== undefined;
  useEffect(() => { if (jobInFlight) setOpenRecord(null); }, [jobInFlight]);
  // Clearing the record that is open takes its own surface with it: there is nothing left to read.
  const clearOne = useCallback((orderSeq: number) => {
    clearRecord(orderSeq);
    setOpenRecord((seq) => (seq === orderSeq ? null : seq));
  }, [clearRecord]);

  /**
   * Send the same order again, which is what "keep going" means once a run has hit the turn cap:
   * the model reads the record it just wrote and continues from where the budget stopped it.
   *
   * ONCE. `runner.send` routes by what the session is DOING, so a second call with the job already
   * in flight is not a second order at all — it falls through to the steer route and queues the
   * user's own order text as a note to the model, tagged "at next step". The card stands its own
   * button down as well; this is the half that holds whatever the card does.
   */
  const keepGoing = useCallback((job: JobView) => {
    if (runner?.active() === true) return;
    runner?.send(job.orderText);
  }, [runner]);

  /**
   * When a record was made, for the archive card's stamp and the dock's meta while it stands open.
   *
   * THE RECORD'S OWN DAY, not an elapsed reading: a job from yesterday is not "23 hours ago" to
   * anyone reading it, and it is the same word the list groups that job under, so the card the user
   * pressed says where they pressed it. `dayOf` is the strip's, for exactly that reason.
   */
  const recordStamp = useCallback((job: JobView) => t(DAY_STAMP_KEY[dayOf(job.orderAt, Date.now())]), [t]);

  // The cap goes to the PANEL, not to this wrapper: a wrapper that were tall enough to reserve the
  // column would take pointer events over the map beside a short panel, and one merely capped would
  // be overflowed by the panel's own wanted height (see `PanelShell`'s `panelStyle`).
  // The child reports its task, its step count, the tool it is on and (optionally) the model's own
  // short display name for it; a `LaneView` is that plus the trouble faces the lane can draw, which
  // no carrier fills yet.
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

  /**
   * A GATE'S THUMBNAIL IS A REAL PHOTOGRAPH OF THE MAP, framed on the cells the gated call is about.
   *
   * The panel renders projections and owns no renderer, so the node is built HERE: this column
   * already stands beside the editor's store, and `canvas/thumbnail.ts` draws with the live 2D
   * renderer. What the shot is OF comes off the call's own arguments (`map-shot.ts:callFootprint`) —
   * the log carries no footprint of its own, and the arguments are what the call will actually do.
   *
   * The arguments are read from the whole log rather than from `live` alone: an ANSWERED card goes on
   * standing in the record, and its call was committed turns ago. Memoized on the epoch, which is
   * every append.
   */
  const callInputs = useMemo(() => {
    const inputs = new Map<string, Record<string, unknown>>();
    const state = useAgentSession.getState();
    for (const e of eventsOf(state.log)) {
      if (e.kind !== 'assistant') continue;
      for (const p of e.parts) if (p.kind === 'tool') inputs.set(p.callId, p.input);
    }
    for (const p of state.live ?? []) if (p.kind === 'tool') inputs.set(p.callId, p.input);
    return inputs;
    // The epoch bumps on every append and every live update, which is every moment this can change.
  }, [epoch]);

  /**
   * A GATE'S PICTURE MARKS ITS PLACE ON THE ISLAND, it does not crop to it.
   *
   * Framed ON the rect, the thumb filled edge to edge with whatever ground happened to be there and
   * said nothing at all about WHERE — the artifact's own gate thumb is a drawn island with the work
   * marked on it, and its three option cards are three visibly different sketches. The shipped three
   * were three near-identical crops of the same green field, so the picture that exists to
   * distinguish the choices distinguished none of them. `MarkedShot` is the region vignette's own
   * reading (whole island, rect drawn over it), which is why it now lives beside the photograph.
   */
  const gateThumb = useCallback((ask: AskRecord) => {
    const box = ask.callId === undefined ? undefined : callFootprint(callInputs.get(ask.callId));
    return box
      ? <MarkedShot box={box} width={GATE_THUMB_W} height={GATE_THUMB_H} testId="gate-shot" />
      : null;
  }, [callInputs]);

  /** The same photograph one rung down: a pick's option names its OWN rect, so the mark comes off
   *  the option rather than off any call. An option naming no place carries no picture. */
  const optionThumb = useCallback((option: GateOption) => {
    const box = callFootprint(option.rect);
    return box
      ? <MarkedShot box={box} width={OPTION_THUMB.width} height={OPTION_THUMB.height} testId="option-shot" />
      : null;
  }, []);

  /**
   * A FINISHED BUILD'S POSTCARD: the same real capture the gate cards take, framed on WHAT THIS JOB
   * BUILT rather than on one call.
   *
   * The frame is the region the order was filed under where it had one — that is the boundary the
   * whole run was held inside — and otherwise the union of the job's own WRITE footprints, read off
   * the calls' arguments exactly as a gate's is. Neither is available for every job (a rotate by id,
   * a generator recipe, a scatter of placements name no rectangle), and there the whole island is
   * the honest frame: the job built something, and the postcard says where.
   */
  const recordShot = useCallback((job: JobView) => {
    const box = job.region
      ? { origin: { x: Math.min(job.region.x1, job.region.x2), y: Math.min(job.region.y1, job.region.y2) },
        width: Math.abs(job.region.x2 - job.region.x1) + 1,
        height: Math.abs(job.region.y2 - job.region.y1) + 1 }
      : unionBox(job.ops.filter((op) => !op.isRead).map((op) => callFootprint(callInputs.get(op.callId))));
    return <MapShot box={box} width={POSTCARD.width} height={POSTCARD.height} whole />;
  }, [callInputs]);

  /**
   * THE ROLLBACK GUARD, and its two refusals.
   *
   * AN UNDO POPS THE OPEN MAP'S STACK, whatever record asked for it, so a take-back aimed at a job
   * built somewhere else would take back edits nobody was looking at. Two records may not be rolled
   * back here, and they are refused for DIFFERENT reasons that must not be said as one:
   *
   *   `otherMap`   — the record names a template and it is not the one standing. Proven elsewhere.
   *   `unknownMap` — the record names none at all (a log written before the order carried a map id).
   *                  UNVERIFIABLE, not elsewhere: it may well be this map's, and claiming otherwise
   *                  would be a fact the panel does not have.
   *
   * With no map open there is nothing to compare against and nothing to roll back onto, so the guard
   * publishes no set at all rather than condemning every record on a technicality.
   */
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

  /** What the manage face says on its meta deck: the live connection, not a table of contents. The
   *  model's version is dropped (`shortModel`) because the two facts share ONE line that may not
   *  wrap, and the card underneath names the model in full. */
  const connectionMeta = [model === '' ? '' : shortModel(model), t(OVERSIGHT_COPY[settings.oversight].label)]
    .filter((part) => part !== '')
    .join(', ');

  /** The live region's count and bounds, off the ONE derivation the agent's refusal quotes back. */
  const liveRegion = useMemo(() => regionBounds(region), [region]);

  /**
   * WHAT THE OPEN MAP OFFERS TO SKETCH, and when it is read.
   *
   * `proposeSketches` reads the WHOLE grid (the evaluator's masks, its regions, its water bodies).
   * This component re-renders once a frame while a stroke or a generate is landing (the undo depth's
   * own coalesced read), so analysing the island on every one of those would spend the frame budget
   * on a card that is not even moving. Two gates instead: the analysis runs only while the panel is
   * open with no job in flight (the only state the card can stand in), and only once the map has
   * been QUIET for a moment.
   */
  const grid = useEditorStore((s) => s.gridState);

  /**
   * HOW BIG THE CALL AT THE OPEN GATE IS, in cells, for the dock's own second line.
   *
   * Measured with the write tools' OWN resolver (`resolveCells`), so the figure is the cells the
   * approval would actually touch rather than a box drawn round them — a road is its path, a circle
   * its disc, an outline its border. A count of ONE is withheld: "1 cell" beside a placement whose
   * card already names the spot is noise on the one line the card has.
   *
   * It reads the SUBSCRIBED grid rather than a `getState()` snapshot: a gate can be standing before
   * the map has finished opening, and a count taken from a null grid then would never be retaken.
   */
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
    // `settledEpoch` is the map's own identity as this reading sees it; `grid` covers a map being
    // replaced outright (a load, a new project), which carries no version bump of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wantSketches, grid, settledEpoch],
  );

  /**
   * THE SKETCH'S PRESS FILLS THE COMPOSER, and that is the whole of it: the field takes the words
   * and waits. Held here because the composer's own value is inside `PanelShell`, and every other
   * verb the panel calls comes from this side of the seam.
   */
  const [fill, setFill] = useState<{ text: string; seq: number } | undefined>(undefined);
  const handOrder = useCallback((text: string) => {
    setFill((last) => ({ text, seq: (last?.seq ?? 0) + 1 }));
  }, []);
  const sketchbook = sketches.length > 0
    ? <Sketchbook ideas={sketches} onOrder={handOrder} mapVersion={settledEpoch} />
    : undefined;

  /**
   * OPEN THE MAP'S OWN REGION-SELECT SCREEN, or close one this panel opened.
   *
   * THERE IS ONE REGION-SELECTION UI IN THE APP and it is the generate shelf's (`ScopeScreen`): the
   * figure cells with their shortcut keys, the brush slider, Clear and Done. The panel's frame button
   * is a second CALLER of that screen, never a second copy of it — arming the brush alone gave the
   * user a live pencil with no figure to choose, no size, and no verb to finish with.
   *
   * IT ARMS IN PLACE, under whatever build mode is standing, and that is a decision rather than an
   * omission. `selectingRegion` outranks every tool in `resolvePress`, so the map answers the region
   * brush and nothing else whichever mode is on — and switching the mode FOR the user would swap the
   * bottom bar under them and move the room the panel has.
   *
   * AND IT SURVIVES A MODE SWITCH BY NOT OWNING THE FLAG. `setEditMode` deliberately puts the region
   * brush away on a change of mode ("choosing what to build puts the region brush away"), so a panel
   * holding its own `marking` boolean would stand in the marking state over a brush that had already
   * gone — the composer disabled, the record folded, and nothing on the map listening. Reading the
   * store means the fold-back is the same subscription that opened it.
   */
  const markRegion = useCallback(() => {
    const on = !useEditorStore.getState().selectingRegion;
    setArmedHere(on);
    setSelectingRegion(on);
  }, [setSelectingRegion]);

  /**
   * WHETHER THIS PANEL IS THE ONE HOLDING THE PENCIL, which the store's flag cannot say.
   *
   * `selectingRegion` is one boolean shared with the generate shelf, so both the fold below and the
   * screen this file MOUNTS have to know who armed it: peeling the flag unconditionally would put away
   * a brush the shelf picked up, and standing a scope screen over a marking the shelf armed would put
   * two of them on the same bottom bar. Cleared whenever the flag goes down by any route (a second
   * press, Done, a mode switch, Escape), so the memory can never outlive the marking it is about.
   *
   * STATE RATHER THAN A REF, because the screen is RENDERED from it.
   */
  const [armedHere, setArmedHere] = useState(false);
  useEffect(() => { if (!selectingRegion) setArmedHere(false); }, [selectingRegion]);

  /**
   * A FOLD ENDS THE MARKING THIS PANEL ARMED, and takes the outline with it.
   *
   * `selectingRegion` outranks every tool in `resolvePress`, so a marking left standing behind a
   * closed panel gives the region brush every press on the map under whatever mode is showing, with
   * the outline up and nothing on screen to say why. The outline is cleared here rather than left to
   * the effect below: that one's cleanup has already run by the time this lowers the flag, and with
   * the panel shut it will not run again.
   */
  useEffect(() => {
    if (open || !armedHere) return;
    setArmedHere(false);
    setSelectingRegion(false);
    host.buildableRegion.clear();
  }, [open, armedHere, setSelectingRegion]);

  /** DETACH CLEARS THE PAINT ITSELF. `clearRegionSelection` goes through the brush's own handler, so
   *  the region's undo stack keeps the stroke it just took back; with no handler mounted (the panel
   *  standing over a shell that never armed one) the store write is the honest fallback. */
  const clearRegion = useCallback(() => {
    clearRegionSelection();
    if (useEditorStore.getState().region.length > 0) useEditorStore.getState().setRegion([]);
  }, []);

  /** The region's own photograph, at whichever size the panel asks for. Built here for the reason
   *  every picture on this seam is: the panel renders projections and owns no renderer. */
  const regionShot = useCallback(
    (bounds: RegionBounds, width: number, height: number) => (
      <RegionVignette bounds={bounds} width={width} height={height} />
    ),
    [],
  );

  /**
   * THE MARKED REGION STANDS ON THE MAP while the panel is open.
   *
   * The scope screen shows it while IT is up and drops it when it closes, which was the whole of the
   * outline's life before now — so a region attached to the composer had a chip saying "1,128 cells"
   * and nothing on the map saying which. It is also what the rollback pulse pulses: a beat over an
   * outline nobody is drawing says nothing at all.
   *
   * The brush repaints the same overlay mid-stroke; this only re-runs when the region COMMITS, so
   * the two never fight. On close the outline goes with the panel, unless the map's own scope tools
   * are the ones holding it.
   */
  useEffect(() => {
    if (!open) return undefined;
    if (region.length > 0) host.buildableRegion.show(region);
    else host.buildableRegion.clear();
    return () => { if (!useEditorStore.getState().selectingRegion) host.buildableRegion.clear(); };
  }, [open, region]);

  /**
   * THE REGION HELD, SAID ON THE MAP: a write that reached outside the boundary rolls the whole call
   * back, and the outline beats once to name the edge the refusal is about.
   *
   * Keyed on the op's own callId rather than on a count, so it fires once per refusal and never
   * again on a re-render; the ops list carries every blocked call the job has had, and the newest is
   * the one that just happened.
   */
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

  /** A PLAN is being asked about and can still be answered — the one state the panel borrows for. A
   *  tool gate is a summary and a pair of verbs and has always fitted; a HELD plan (no `view.gate`)
   *  is a card nobody can answer, so it waits its turn like any other record. */
  const planGateStanding = view.gate?.scope === 'plan';
  /*
   * WHERE THE COLUMN STANDS, and there are two answers because it is two different things.
   *
   * FREE, it is standing chrome: it stands over the map on the frame's grid, with the room the two
   * clearances leave it (`panelTop` / `panelMaxHeight`) and the bar's own rung — only a borrowing
   * panel climbs over the shelf, and only for as long as the question it borrowed for is standing.
   *
   * DOCKED (`place === 'ground'`), it is the GROUND: the window's own top and bottom edges plus the
   * side edge the dock stands at, at the bottom of the z ladder, with the whole interface a sheet of
   * paper lying on top of it. The cap arithmetic has nothing left to ration, since the height is the
   * window and the job zone takes every px the desk and the composer do not.
   *
   * AND THE GROUND DRIFTS UNDER THE SHEET rather than lying still while the sheet slides over it: the
   * two planes PART, so the lower one travels a small share of the upper one's distance in the same
   * direction and the two settle together (`shell/panel-frame.ts:DOCK_PARALLAX`, the splash hand-off's
   * own relationship). It is a transform on this wrapper rather than on the plate: the plate's own
   * transform track carries the open gesture's travel, and the character rides this one for free — her
   * seat is measured out of the desk inside it (`character/seat.ts`).
   */
  const { place, side, aside } = useDockStage();
  const docked = place === 'ground';
  const cap = docked
    ? PINNED_PANEL.height
    : panelMaxHeight(mode, PANEL_LEAST, planGateStanding ? GATE_BORROW : 0);
  const drift = (1 - aside) * DOCK_PARALLAX * dockTravelSign(side) * -1;
  // THE DRIFT RIDES THE SLIDE'S OWN FRAMES, written on the fraction's change rather than through a
  // render (`shell/use-dock.ts:dockAside` carries why). The render above still writes the same
  // arithmetic at whatever the live fraction is, so the two never disagree; the cleanup clears the
  // track because the last frame of an undock leaves the full drift on an element the next render
  // no longer knows carries a transform.
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
    // FOLDED AWAY IT HEARS NOTHING. An opacity of zero still hit-tests, and the beat in the middle of a
    // dock change stands the invisible panel over a sheet the pointer is meant to reach.
    pointerEvents: place === 'leaving' || place === 'folded' ? 'none' : 'auto',
    zIndex: docked ? z.ground : planGateStanding ? z.column : z.panel,
    // THE FRAME'S OWN VEIL, worn here rather than inherited: this column stands outside the frame's
    // plane (`shell/Shell.tsx:Assistant`), and putting the interface away has to take it too.
    // `visibility` is DISCRETE and interpolates as visible to the end, which is what takes the panel
    // out of hit-testing and out of the accessibility tree only once it has finished leaving.
    opacity: veiled ? 0 : 1,
    visibility: veiled ? 'hidden' : 'visible',
    transition: cssMotion(veiled ? 'frame.veil' : 'frame.unveil', ['opacity', 'visibility']),
    // NO CLOCK OF ITS OWN: the drift is a multiple of the one animated fraction, like every other
    // distance in the move. A free panel takes none of it — it is not the ground.
    ...(docked && drift !== 0 ? { transform: `translateX(${drift}px)` } : null),
  } as CSSProperties), [docked, side, drift, planGateStanding, veiled, place]);

  return (
    <AnimatePresence>
      {/* THE MAP'S OWN REGION-SELECT SCREEN, standing for the panel that asked for it.
          It is the generate shelf's screen (its figures, its brush slider, its Clear and Done) and it
          is mounted here only for a marking THIS panel armed: the shelf mounts its own for the ones it
          arms, and two on the one bottom bar would be two sets of the same controls. Done lowers the
          flag, which is what folds this away and brings the chip back with whatever was painted. */}
      {open && armedHere && selectingRegion && (
        <ScopeScreen key="assistant-scope" onDone={() => setSelectingRegion(false)} />
      )}
      {/* THE PANEL STANDS FOR EVERY STAGE THE SEQUENCE HAS, `away` INCLUDED, and that is what makes a
          dock change have two honest ends. It is ONE element in both forms — React reuses the node — so
          unmounting it for the beat in the middle would leave the returning form CANCELLING an exit
          rather than playing an entrance, which is a panel standing there whole and then wiping. Folded
          and invisible is a state (`PanelShell`'s `away`), and it is the state the ordinary entrance
          arrives out of.
          A COLLAPSE OVER A DOCK IS COVERED, NOT PLAYED, which is why the stage outranks `open` here:
          closing a docked panel starts the same two-beat leave a dock change has, and unmounting on
          the press made the window-tall ground play the FLOATING exit in plain view — folding to its
          own corner while the returning sheet was still half way across the strip it left empty. The
          ground stands until the sheet has covered it, and goes under the cover. */}
      {(open || docked || place === 'folded') && (
        <div key="assistant-panel" ref={wrapRef} data-testid="shell-assistant-panel" style={wrapper}>
          <PanelShell
            view={view}
            connected={connected}
            ready={ready}
            running={running}
            {...(mapName ? { mapName } : {})}
            providerName={PROVIDER_META[armed.providerId].name}
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
