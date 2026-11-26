/*
 * Live assistant integration and lazy chunk boundary. Reads the session, settings and map; owns one
 * runner; and projects the result into PanelShell. Keeping the column mounted preserves the
 * runner's abort controller and in-flight job.
 */
import { memo, useCallback, useMemo, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  callFootprint, jobFootprint, PROVIDER_SIGN_INS, type AskRecord, type GateOption, type JobView, type ProviderId, type RepairAct,
} from '../../agent/panel';
import {
  answerStandingGate, clearJobs, gateCellCount, jobsByMap, pickGateOption, recallNote, recordsOf, runRepair, takeBackJob, takeBackTo,
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
import { useSignInEnding } from './hooks/use-sign-in-ending';
import { usePanelPlacement } from './hooks/use-panel-placement';
import { usePanelRegion } from './hooks/use-panel-region';
import { usePanelRunner } from './hooks/use-panel-runner';
import { useUndoDepth } from '../session/use-undo-depth';
import { MapShot, MarkedShot } from './parts/map-shot';
import { DAY_KEY, dayOf } from './derive/days';
import { OPTION_THUMB } from './record/OptionPick';
import { PanelShell } from './PanelShell';
import type { GateReply } from './panel-shell-props';
import { prettyModel, shortModel } from './connection/pretty-model';
import { OVERSIGHT_COPY } from './connection/setup-parts';
import { POSTCARD } from './panel-skin';
import { useMorph } from '../primitives/morph';

interface PanelColumnProps {
  /** Whether the mounted panel is visible. */
  open: boolean;
  /** Whether CharacterHost renders the live character outside this tree. */
  hosted?: boolean;
  /** Whether the panel should follow the frame's veil transition. */
  veiled?: boolean;
}

/** Hides the panel without pausing or stopping the runner. */


/** Renders an option's own footprint when it names a location. */
function optionThumb(option: GateOption) {
  const box = callFootprint(option.rect);
  return box ? <MarkedShot box={box} width={OPTION_THUMB.width} height={OPTION_THUMB.height} testId="option-shot" /> : null;
}

/** Captures the job region, its write-footprint union, or the whole map when bounds are unavailable. */
function recordShot(job: JobView) {
  return <MapShot box={jobFootprint(job)} width={POSTCARD.width} height={POSTCARD.height} whole />;
}

/** The sign-in a held key can be replaced by, with when it was issued if it came from one. */
function signInOf(provider: ProviderId, at: number | undefined): { provider: ProviderId; at?: number } {
  return at === undefined ? { provider } : { provider, at };
}

function PanelColumn({ open, hosted = false, veiled = false }: PanelColumnProps) {
  const t = useT();
  const locale = useLocale();
  const view = useAgentSession(panelView);
  const epoch = useAgentSession((s) => s.epoch);
  const liveAt = useAgentSession((s) => s.liveAt);
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
  const runner = usePanelRunner(armed, model, connected);
  const send = useCallback((text: string) => { runner?.send(text); }, [runner]);
  const stop = useCallback(() => { runner?.stop(); }, [runner]);
  const pause = useCallback(() => { runner?.pause(); }, [runner]);
  const resume = useCallback(() => { runner?.resume(); }, [runner]);
  // Ends the runner's current backoff without starting a parallel attempt.
  const retryNow = useCallback(() => { runner?.retryNow(); }, [runner]);

  /** The repairs that reach past the panel: a retry, a dropped key and the exported log. */
  const repair = useCallback((act: RepairAct) => { runRepair(runner, act); }, [runner]);

  useSignInEnding(connected);

  /** Settles a held job before filing the resulting record in past jobs. */
  const setAside = useCallback((orderSeq: number) => { runner?.setAside(orderSeq); }, [runner]);

  /** Answers the current gate; stale or duplicate answers become a localized warning. */
  const gateAnswer = useCallback((gateId: string, reply: GateReply) => {
    if (gateId === '') return;
    const answered = typeof reply === 'string' ? answerStandingGate(gateId, reply)
      : 'option' in reply ? pickGateOption(gateId, reply.option) : answerStandingGate(gateId, 'words', reply.words);
    if (!answered) showToast(t('agent.gate_stale'), 'warning');
  }, [t]);

  /** Resubmits a capped job (`resend` files it only while idle). */
  const keepGoing = useCallback((job: JobView) => { runner?.resend(job.orderText); }, [runner]);

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

  /** Projects each helper's transient progress into the lane of the row that started it. */
  const lane = useMemo(() => {
    const calls = Object.keys(childLive);
    if (calls.length === 0) return undefined;
    return Object.fromEntries(calls.map((callId) => {
      const child = childLive[callId]!;
      return [callId, {
        task: child.task, ops: child.ops,
        ...(child.opName ? { opName: child.opName } : {}),
        ...(child.label ? { label: child.label } : {}),
      }];
    }));
  }, [childLive]);

  /** Gate thumbnails frame the affected footprint and its surroundings, marked in place. */
  const currentOps = view.current?.ops;
  const gateThumb = useCallback((ask: AskRecord) => {
    const box = ask.callId === undefined ? undefined : currentOps?.find((op) => op.callId === ask.callId)?.footprint;
    return box ? <MarkedShot box={box} width={GATE_THUMB.width} height={GATE_THUMB.height} testId="gate-shot" zoom /> : null;
  }, [currentOps]);

  /** Separates records from another map from records whose map identity cannot be verified. */
  const { otherMap, unknownMap } = useMemo(() => jobsByMap(recordsOf(view), liveMapId), [view, liveMapId]);

  /** Compact model and oversight label for the management header. */
  const connectionMeta = joinList(locale, [model === '' ? '' : shortModel(model), t(OVERSIGHT_COPY[settings.oversight].label)]
    .filter((part) => part !== ''), { conjunction: false });

  /** Counts resolved cells for a gated write; single-cell calls omit the redundant count. */
  const gate = view.gate;
  const gateCells = useMemo(() => gateCellCount(gate, currentOps, grid), [gate, currentOps, grid]);

  const sketches = useMapSketches(grid, open && connected && view.current === undefined);
  const panelRegion = usePanelRegion(view);
  const placement = usePanelPlacement({ t, veiled, planGateStanding: view.gate?.scope === 'plan' });
  const { place } = placement;

  return (
    <AnimatePresence>
      {/* Keep one panel node through pin and fold stages; a pinned collapse stays until the sheet covers it. */}
      {(open || placement.pinned || place === 'folded') && (
        <PanelPiece key="assistant-panel" wrapRef={placement.wrapRef} style={placement.wrapper}>
          <PanelShell
            panel={{
              view, running, open, visit, hosted, veiled, liveAt,
              ...(mapName ? { mapName } : {}),
              maxHeight: placement.maxHeight,
              ...(lane ? { lane } : {}),
              ...sketches,
            }}
            connection={{
              connected, ready, connectionMeta,
              ...(PROVIDER_SIGN_INS[armed.providerId] ? { signIn: signInOf(armed.providerId, settings.signedIn[armed.providerId]) } : {}),
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
              edge: placement.edge,
              ...(place === 'leaving' || place === 'folded' ? { away: place } : {}),
              pinBlocked: placement.pinBlocked,
              onTogglePin: placement.togglePin,
              onSwitchSide: placement.switchSide,
            }}
            verbs={{
              onSend: send, onStop: stop, onPause: pause, onResume: resume, onRetryNow: retryNow, onGateAnswer: gateAnswer,
              onRepair: repair, onSetAside: setAside, onFileAway: fileAway, onClearRecord: clearRecord,
              onRewindAll: takeBackJob, onKeepGoing: keepGoing, onRecallSteer: recallNote, onRewind: takeBackTo, onRollBack: takeBackJob,
              onClearJobs: clearJobs, onDismissStorage: dismissStorageNotice,
            }}
            pictures={{ gateThumb, optionThumb, recordShot, recordStamp, regionShot: panelRegion.regionShot }}
          />
        </PanelPiece>
      )}
    </AnimatePresence>
  );
}

/** The panel's root, a piece of the chrome's morph inside the presence that closes it. Its content
 *  re-flows between a side and a bottom dock, so the old fades out as the new fades in. */
function PanelPiece({ wrapRef, style, children }: { wrapRef: Ref<HTMLDivElement>; style: CSSProperties; children: ReactNode }) {
  const morph = useMorph('assistant', undefined, { reflows: true });
  return <div ref={wrapRef} data-testid="shell-assistant-panel" {...morph} style={style}>{children}</div>;
}

/** Memoised: its host re-renders with the window and the dock, and the panel reads its own state. */
export default memo(PanelColumn);
