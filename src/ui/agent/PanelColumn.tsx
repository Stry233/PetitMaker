/*
 * Live assistant integration and lazy chunk boundary. Reads the session, settings and map; owns one
 * runner; and projects the result into PanelShell. Keeping the column mounted preserves the
 * runner's abort controller and in-flight job.
 */
import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { callFootprint, jobFootprint, type AskRecord, type GateOption, type JobView } from '../../agent/panel';
import {
  answerStandingGate, clearJobs, exportSessionLog, gateCellCount, jobsByMap, lastOrderText, recallNote,
} from '../../agent/panel-runtime';
import {
  connectionReady, isConnected, panelView, runnerSettings, useAgentConnection, useAgentSession,
} from '../../agent/boot';
import { showToast } from '../../platform/channels/toast-bus';
import { useLocale, useT } from '../../i18n/context';
import { joinList } from '../../i18n/locale-info';
import { providerName } from '../../i18n/terms/providers';
import { useEditorStore } from '../../state/store';
import { usePlanetName } from '../chrome/modals/planet/use-planet-library';
import { GATE_THUMB } from './record/GateBlock';
import { useMapSketches } from './hooks/use-map-sketches';
import { usePanelPlacement } from './hooks/use-panel-placement';
import { usePanelRegion } from './hooks/use-panel-region';
import { usePanelRunner } from './hooks/use-panel-runner';
import { useUndoDepth } from '../session/use-undo-depth';
import { rewindLiveMap } from '../../editor/editing/rewind';
import { MapShot, MarkedShot } from './parts/map-shot';
import { DAY_KEY, dayOf } from './derive/days';
import type { RepairAct } from './derive/repair';
import { OPTION_THUMB } from './record/OptionPick';
import { PanelShell } from './PanelShell';
import { prettyModel, shortModel } from './connection/pretty-model';
import type { Checkpoint } from './record/ticket-parts';
import { OVERSIGHT_COPY } from './connection/setup-parts';
import { POSTCARD } from './panel-skin';

interface PanelColumnProps {
  /** Whether the mounted panel is visible. */
  open: boolean;
  /** Whether CharacterHost renders the live character outside this tree. */
  hosted?: boolean;
  /** Whether the panel should follow the frame's veil transition. */
  veiled?: boolean;
}

/** Hides the panel without pausing or stopping the runner. */
function collapse(): void { useEditorStore.getState().setAssistantOpen(false); }

function rewind(checkpoint: Checkpoint): void { rewindLiveMap(checkpoint.undoIndex); }

function rollBack(job: JobView): void {
  const first = job.checkpoints[0];
  if (first) rewindLiveMap(first.undoIndex);
}


/** Renders an option's own footprint when it names a location. */
function optionThumb(option: GateOption) {
  const box = callFootprint(option.rect);
  return box ? <MarkedShot box={box} width={OPTION_THUMB.width} height={OPTION_THUMB.height} testId="option-shot" /> : null;
}

/** Captures the job region, its write-footprint union, or the whole map when bounds are unavailable. */
function recordShot(job: JobView) {
  return <MapShot box={jobFootprint(job)} width={POSTCARD.width} height={POSTCARD.height} whole />;
}

export default function PanelColumn({ open, hosted = false, veiled = false }: PanelColumnProps) {
  const t = useT();
  const locale = useLocale();
  const view = useAgentSession(panelView);
  const epoch = useAgentSession((s) => s.epoch);
  // Child progress is transient session state, not part of the persisted parent log.
  const childLive = useAgentSession((s) => s.childLive);
  const filed = useAgentSession((s) => s.filed);
  // Storage health describes browser persistence rather than a log event.
  const storageNotice = useAgentSession((s) => s.storageNotice);
  // Restored sessions present pending work as a resumption offer.
  const restored = useAgentSession((s) => s.restored);
  const dismissStorageNotice = useAgentSession((s) => s.dismissStorageNotice);
  const cleared = useAgentSession((s) => s.cleared);
  const fileAway = useAgentSession((s) => s.fileAway);
  const clearRecord = useAgentSession((s) => s.clearRecord);
  const settings = useAgentConnection();
  const connected = isConnected(settings);
  // Readiness includes required endpoint and model fields, not only a stored key.
  const ready = connectionReady(settings);
  const model = settings.model[settings.provider] ?? '';
  const template = useEditorStore((s) => s.gridState?.template);
  const liveMapId = template?.id;
  const grid = useEditorStore((s) => s.gridState);
  const mapName = usePlanetName(template);
  const undoDepth = useUndoDepth(epoch);

  const armed = runnerSettings(settings);
  const forgetKey = settings.forgetKey;
  const runner = usePanelRunner(armed, model, connected);
  const send = useCallback((text: string) => { runner?.send(text); }, [runner]);
  const stop = useCallback(() => { runner?.stop(); }, [runner]);
  const pause = useCallback(() => { runner?.pause(); }, [runner]);
  const resume = useCallback(() => { runner?.resume(); }, [runner]);
  // Ends the runner's current backoff without starting a parallel attempt.
  const retryNow = useCallback(() => { runner?.retryNow(); }, [runner]);

  /** The repairs that reach past the panel: a retry, a dropped key and the exported log. */
  const repair = useCallback((act: RepairAct) => {
    if (act === 'try-again') {
      // An active send would become steering, so a retry files only while idle, as Keep going does.
      if (runner?.active() === true) return;
      const last = lastOrderText();
      if (last !== undefined) runner?.send(last);
      return;
    }
    if (act === 'fix-key') { forgetKey(armed.providerId); return; }
    if (act === 'export-log') exportSessionLog();
  }, [runner, forgetKey, armed.providerId]);

  /** Settles a held job before filing the resulting record in past jobs. */
  const setAside = useCallback((orderSeq: number) => {
    runner?.setAside();
    fileAway(orderSeq);
  }, [runner, fileAway]);

  /** Answers the current gate; stale or duplicate answers become a localized warning. */
  const gateAnswer = useCallback((gateId: string, answer: 'allow' | 'skip' | 'words', words?: string) => {
    if (gateId === '') return;
    if (!answerStandingGate(gateId, answer, words)) showToast(t('agent.gate_stale'), 'warning');
  }, [t]);

  /** Resubmits a capped job only while idle; active sends are interpreted as steering. */
  const keepGoing = useCallback((job: JobView) => {
    if (runner?.active() === true) return;
    runner?.send(job.orderText);
  }, [runner]);

  /** Runner activity is authoritative because restored logs have no live controller. */
  const running = runner?.active() ?? false;
  /** Connection snapshot used by the in-flight job, or undefined while idle. */
  const liveConnection = runner?.connection();

  /** Counts openings, applied as the panel renders, so its transient surfaces close with each fold. */
  const [visit, setVisit] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) { setWasOpen(open); if (open) setVisit((n) => n + 1); }

  /** Returns the same calendar-day label used to group the archive record. */
  const recordStamp = useCallback((job: JobView) => t(DAY_KEY[dayOf(job.orderAt, Date.now())]), [t]);

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

  /** Gate thumbnails show the whole map with the affected footprint marked in place. */
  const currentOps = view.current?.ops;
  const gateThumb = useCallback((ask: AskRecord) => {
    const box = ask.callId === undefined ? undefined : currentOps?.find((op) => op.callId === ask.callId)?.footprint;
    return box ? <MarkedShot box={box} width={GATE_THUMB.width} height={GATE_THUMB.height} testId="gate-shot" /> : null;
  }, [currentOps]);

  /** Separates records from another map from records whose map identity cannot be verified. */
  const { otherMap, unknownMap } = useMemo(() => jobsByMap(view.jobs, liveMapId), [view.jobs, liveMapId]);

  /** Compact model and oversight label for the management header. */
  const connectionMeta = joinList(locale, [model === '' ? '' : shortModel(model), t(OVERSIGHT_COPY[settings.oversight].label)]
    .filter((part) => part !== ''), { conjunction: false });

  /** Counts resolved cells for a gated write; single-cell calls omit the redundant count. */
  const gate = view.gate;
  const gateCells = useMemo(() => gateCellCount(gate, currentOps, grid), [gate, currentOps, grid]);

  const sketches = useMapSketches(grid, open && connected && view.current === undefined);
  const panelRegion = usePanelRegion(open, view);
  const placement = usePanelPlacement({ t, veiled, planGateStanding: view.gate?.scope === 'plan' });
  const { place } = placement;

  return (
    <AnimatePresence>
      {/* Keep one panel node through pin and fold stages; a pinned collapse stays until the sheet covers it. */}
      {(open || placement.pinned || place === 'folded') && (
        <div key="assistant-panel" ref={placement.wrapRef} data-testid="shell-assistant-panel" style={placement.wrapper}>
          <PanelShell
            panel={{
              view, running, open, visit, hosted,
              ...(mapName ? { mapName } : {}),
              maxHeight: placement.maxHeight,
              ...(lane ? { lane } : {}),
              ...sketches,
            }}
            connection={{
              connected, ready, connectionMeta,
              providerName: providerName(armed.providerId, t),
              ...(model ? { modelName: prettyModel(model) } : {}),
              ...(liveConnection ? { liveConnection } : {}),
            }}
            records={{
              filed, cleared, storageNotice, restored,
              ...(undoDepth !== undefined ? { undoDepth } : {}),
              ...(otherMap.size > 0 ? { otherMap } : {}),
              ...(unknownMap.size > 0 ? { unknownMap } : {}),
            }}
            region={{ ...panelRegion.region, ...(gateCells !== undefined ? { gateCells } : {}) }}
            dock={{
              pinned: placement.pinned,
              dockSide: placement.side,
              ...(place === 'leaving' || place === 'folded' ? { away: place } : {}),
              pinBlocked: placement.pinBlocked,
              onTogglePin: placement.togglePin,
              onSwitchSide: placement.switchSide,
              onCollapse: collapse,
            }}
            verbs={{
              onSend: send, onStop: stop, onPause: pause, onResume: resume, onRetryNow: retryNow, onGateAnswer: gateAnswer,
              onRepair: repair, onSetAside: setAside, onFileAway: fileAway, onClearRecord: clearRecord,
              onRewindAll: rollBack, onKeepGoing: keepGoing, onRecallSteer: recallNote, onRewind: rewind, onRollBack: rollBack,
              onClearJobs: clearJobs, onDismissStorage: dismissStorageNotice,
            }}
            pictures={{ gateThumb, optionThumb, recordShot, recordStamp, regionShot: panelRegion.regionShot }}
          />
        </div>
      )}
    </AnimatePresence>
  );
}
