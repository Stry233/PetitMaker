/*
 * The assistant panel: the desk band, the job zone, the steering queue and the composer, assembled
 * from the session projection. Ancestors of the character's seat stay untransformed, because the
 * fixed character is placed from their measured rectangles.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotionConfig, useTransform } from 'framer-motion';
import { composerRoute, rolledBackSeqs, signIn, type RepairAct } from '../../agent/panel';
import { useT } from '../../i18n/context';
import { helpTargetAttr } from '../session/help-targets';
import { framerMotion } from '../design/motion';
import { useUiPreviewPose } from '../design/preview';
import { ControlConfirm } from '../primitives/ControlConfirm';
import { ScrollArea } from '../primitives/ScrollArea';
import { useSizeGlide } from '../primitives/use-size-glide';
import { CONTROL_CLEARANCE } from '../primitives/use-scroll-row';
import { useViewportEpoch } from '../primitives/use-viewport-epoch';
import { DOCK_CHROME_W } from '../shell/panel-frame';
import { zoneEnter } from './parts/panel-parts';
import { setDeskSeat, setPanelCarriage } from './character/seat';
import { Composer } from './composer/Composer';
import { DeskHeader } from './desk/DeskHeader';
import {
  dockedStyle, JOB_ZONE_STYLE, jobZoneFloor, knobCarry, panelStyle, panelVariants, PLATE_HOLDER, plateVariants,
  REVEALED, WIPE_GROUND, WIPE_OPEN, WIPE_SEED,
} from './desk/plate';
import { PinControls } from './desk/PinControls';
import { useSecondClock } from './hooks/use-clock';
import { usePanelZone } from './hooks/use-panel-zone';
import { useStorageNotice } from './hooks/use-storage-notice';
import { IconSprite } from './parts/sprite';
import { PHASE } from './derive/phase';
import { incidentWords } from './derive/repair';
import { sessionLayout } from './derive/session-layout';
import { AskStack, asksStand } from './record/AskStack';
import { SessionRecord } from './record/SessionRecord';
import { ZoneScreen, type ZoneScreenKind } from './record/ZoneScreen';
import type { PanelShellProps } from './panel-shell-props';
import { PANEL_CONFIRM_W } from './panel-skin';
import { CHIP_VIGNETTE, RegionButton, RegionChip } from './composer/region-chip';
import { ScrollIntent } from './parts/scroll-intent';
import type { SetupHandle } from './connection/SetupScreen';
import type { SetupFace } from './connection/setup-parts';
import { SteerQueue } from './composer/SteerQueue';
import { useFollowNewest } from './hooks/use-follow-newest';
import { AwayOwner, useAway } from '../primitives/away';

/** No records filed, for a caller that keeps no such marks. */
const NONE_FILED: ReadonlySet<number> = new Set();

/** No ask deck open. */
const NO_DECKS: ReadonlySet<string> = new Set();

export function PanelShell({ panel, connection, records = {}, region: area = {}, dock = {}, verbs, pictures = {} }: PanelShellProps) {
  const { view, open = true, visit = 0, now, maxHeight, hosted = false, veiled = false } = panel;
  const { connected, ready = true } = connection;
  const { filed = NONE_FILED, cleared = NONE_FILED, storageNotice, restored = false, undoDepth } = records;
  const { bounds: region = null, marking = false, onMarkRegion, onClearRegion } = area;
  const { pinned = false, edge = 'left', away } = dock;
  const { onStop, onResume, onFileAway, onRepair } = verbs;
  const { regionShot } = pictures;
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  // Help figures draw the panel without taking over the live character's seams.
  const previewPose = useUiPreviewPose();
  const pictured = previewPose !== null;
  const plateRef = useRef<HTMLDivElement>(null);
  const jobZoneRef = useRef<HTMLDivElement>(null);
  const setupRef = useRef<SetupHandle>(null);
  const focusComposer = useRef<(() => void) | null>(null);
  // One motion value drives both the plate's clip and the dock knob's carry.
  const wipe = useMotionValue(pinned ? WIPE_GROUND : reduced ? WIPE_OPEN : WIPE_SEED);
  const carry = {
    x: useTransform(wipe, (clip: string) => knobCarry(clip).x),
    y: useTransform(wipe, (clip: string) => knobCarry(clip).y),
    scale: useTransform(wipe, (clip: string) => knobCarry(clip).scale),
  };
  const { zone, dispatch, repairSteps } = usePanelZone({ connected, ready, open, visit, jobInFlight: view.current !== undefined, cleared }, panel.initialZone);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const storage = useStorageNotice(storageNotice, verbs.onDismissStorage, onRepair);
  const [setupFace, setSetupFace] = useState<SetupFace | null>(null);
  // A dropped suggestion belongs to its order, even where a later question offers the same words.
  const [droppedGhost, setDroppedGhost] = useState<{ orderSeq: number | undefined; text: string | null } | null>(null);
  const [drafting, setDrafting] = useState(false);
  // Held here so opening and closing a record keeps the list open.
  const [historyOpen, setHistoryOpen] = useState(previewPose?.historyOpen ?? false);
  const currentSeq = view.current?.orderSeq;
  const [decks, setDecks] = useState<{ seq: number | undefined; open: ReadonlySet<string> }>({ seq: undefined, open: NO_DECKS });
  const openDecks = decks.seq === currentSeq ? decks.open : NO_DECKS;
  // The control a stop was asked from, for the job it was asked about.
  const [stopFrom, setStopFrom] = useState<{ anchor: RefObject<HTMLElement | null>; seq: number | undefined } | null>(null);
  const askStop = (anchor: RefObject<HTMLElement | null>) => setStopFrom({ anchor, seq: currentSeq });

  const hasAsk = asksStand(view);
  const layout = sessionLayout({
    view, connected, zone, filed, cleared, restored, storageNotice, dismissed, hasAsk, marking,
    sketch: panel.sketchbook !== undefined,
    ...(connection.signIn?.at !== undefined ? { signedInAt: connection.signIn.at } : {}),
    ...(records.otherMap ? { otherMap: records.otherMap } : {}),
    ...(records.unknownMap ? { unknownMap: records.unknownMap } : {}),
  });
  const { incident, opened, settled, keyCleared, showWelcome, notReady, owedJob, keyRefusal: refusal } = layout;
  /** The composer's words while a cleared key holds the job or the incident's fault stands. */
  const guidance = keyCleared ? 'agent.composer_disconnected' as const
    : incident && !layout.standingTrouble ? incidentWords(incident.cls, refusal).composerKey : undefined;
  const showSetup = zone.kind === 'setup';
  const managing = zone.kind === 'manage';
  const viewport = useViewportEpoch();
  const preserveReading = useFollowNewest(jobZoneRef, view, `${viewport}|${[...openDecks].sort().join(',')}`, !notReady);
  const rolledBack = useMemo(() => rolledBackSeqs(view.jobs, undoDepth), [view.jobs, undoDepth]);
  const ticked = useSecondClock(PHASE[view.phase].inFlight && now === undefined);
  const isRunning = panel.running ?? !PHASE[view.phase].atRest;

  /** One handler for every repair: the steps are the assistant's, the hands the panel's and its caller's. */
  const repair = (act: RepairAct): void => {
    for (const step of repairSteps(act)) {
      if (step.step === 'put-down') setDismissed(incident?.seq ?? null);
      else if (step.step === 'compose') focusComposer.current?.();
      // Inside the press, since the provider's window opens there; the key it returns replaces the held one.
      else if (step.step === 'sign-in') { if (connection.signIn) signIn.start(connection.signIn.provider); }
      else if (step.step === 'focus-key') setupRef.current?.focusKey();
      else if (step.step === 'zone') dispatch(step.event);
      else if (step.step === 'file') { if (incident) onFileAway?.(incident.seq); }
      else onRepair?.(act);
    }
  };
  // The caller's verb settles a held job before filing it; a caller with none files the record.
  const setAside = layout.offered === undefined ? undefined : verbs.onSetAside ?? onFileAway;

  const { ref: rootRef } = useSizeGlide<HTMLElement>({ axis: 'height', motionId: 'panel.height', disabled: pinned, resetKey: viewport });
  // Only the live panel is the character host's moving carriage.
  useEffect(() => {
    if (pictured) return undefined;
    setPanelCarriage(plateRef.current);
    return () => setPanelCarriage(null);
  }, [pictured]);

  const regionChip = region && !notReady && !marking && onMarkRegion && onClearRegion ? (
    <RegionChip
      key="region-chip"
      bounds={region}
      {...(regionShot ? { vignette: regionShot(region, CHIP_VIGNETTE.width, CHIP_VIGNETTE.height) } : {})}
      onMark={onMarkRegion}
      onClear={onClearRegion}
    />
  ) : null;

  const screen: ZoneScreenKind | null = showSetup ? { kind: 'setup', entry: zone.entry, focusKey: zone.focusKey }
    : showWelcome ? { kind: 'welcome' } : managing ? { kind: 'manage' } : opened ? { kind: 'record', job: opened } : null;
  const content: ReactNode = marking ? null : screen ? (
    <ZoneScreen
      screen={screen}
      setupRef={setupRef}
      pinned={pinned}
      jobCount={view.jobs.filter((job) => !cleared.has(job.orderSeq)).length}
      running={isRunning}
      phase={view.phase}
      {...pick(connection, 'liveConnection')} {...pick(pictures, 'recordStamp')} {...pick(verbs, 'onClearJobs')}
      rolledBack={rolledBack}
      dispatch={dispatch}
      onSetupFace={setSetupFace}
      onStop={onStop}
      onPause={verbs.onPause}
      onCloseRecord={() => { setHistoryOpen(true); dispatch({ type: 'close-record' }); }}
      {...pick(verbs, 'onClearRecord')}
    />
  ) : (
    <SessionRecord
      view={view}
      layout={layout}
      hasAsk={hasAsk}
      asks={(
        <AskStack
          view={view}
          drafting={drafting}
          openDecks={openDecks}
          onDeckChange={(id, next) => {
            const set = new Set(openDecks);
            if (next) set.add(id); else set.delete(id);
            setDecks({ seq: currentSeq, open: set });
          }}
          {...(pictures.gateThumb ? { gateThumb: pictures.gateThumb } : {})}
          {...(pictures.optionThumb ? { optionThumb: pictures.optionThumb } : {})}
          onGateAnswer={verbs.onGateAnswer}
        />
      )}
      pinned={pinned}
      sketchbook={panel.sketchbook}
      {...pick(connection, 'modelName')} {...pick(panel, 'lane')} {...pick(pictures, 'regionShot', 'recordShot', 'recordStamp')} {...pick(records, 'otherMap', 'unknownMap')} {...pick(verbs, 'onRollBack')}
      {...(undoDepth !== undefined ? { undoDepth } : {})}
      rolledBack={rolledBack}
      busy={isRunning}
      historyOpen={historyOpen}
      onHistoryOpen={setHistoryOpen}
      storage={storage}
      verbs={pick(verbs, 'onFileAway', 'onRewind', 'onRewindAll', 'onKeepGoing')}
      hold={{
        ...(onResume ? { onResume } : {}),
        onStop,
        ...(setAside ? { onSetAside: setAside } : {}),
        ...(layout.offered?.plan && layout.offered.plan.doneCount > 0
          ? { note: t('agent.ticket_stages_done', { n: layout.offered.plan.doneCount, m: layout.offered.plan.stages.length }) }
          : {}),
      }}
      onRepair={repair}
      onOpenRecord={(job) => dispatch({ type: 'open-record', seq: job.orderSeq })}
      onAskStop={askStop}
    />
  );

  const gone = !open || away !== undefined || veiled;
  const goneAttrs = useAway(gone);
  const plateTransition = pinned || away === 'folded' ? REVEALED : framerMotion(away === 'leaving' ? 'panel.close' : 'panel.open');
  const controls = dock.onTogglePin && edge !== 'bottom' ? (
    <PinControls
      pinned={pinned}
      dockSide={edge}
      blocked={dock.pinBlocked ?? false}
      carry={carry}
      onTogglePin={dock.onTogglePin}
      {...(dock.onSwitchSide ? { onSwitchSide: dock.onSwitchSide } : {})}
    />
  ) : null;

  return (
    // This unclipped holder carries the plate, the external knob and the hosted character together;
    // folded, leaving or veiled, it and the cards it portals take no input.
    <AwayOwner away={gone}>
      <motion.div
        ref={plateRef}
        {...goneAttrs}
        // Inline visibility hides the folded plate in the same paint as its dock-geometry change.
        style={away === 'folded' ? { ...PLATE_HOLDER, visibility: 'hidden' } : PLATE_HOLDER}
        variants={panelVariants}
        // A docked plate is revealed by the sheet around it and has no entrance of its own.
        initial={reduced || pinned ? false : 'hidden'}
        animate={away ? 'hidden' : pinned ? 'ground' : 'shown'}
        exit="gone"
        transition={plateTransition}
      >
        <motion.section
          ref={rootRef}
          data-testid="panel-shell"
          {...helpTargetAttr(showSetup || managing ? 'agent-setup' : showWelcome ? 'agent-intro' : marking ? 'agent-region' : opened ? 'agent-trail' : incident ? 'agent-trouble' : 'agent-run')}
          variants={plateVariants}
          // Framer transitions are not inherited, so the plate repeats the holder's.
          transition={plateTransition}
          style={{ ...(pinned ? dockedStyle(maxHeight, edge) : panelStyle(maxHeight, notReady)), clipPath: wipe }}
        >
          {/* One hidden sprite supplies every symbol the panel's glyphs reference. */}
          <IconSprite />
          {pinned ? controls : null}
          {/* Only the desk band reserves the dock controls' gutter. */}
          <div data-testid="desk-band" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', paddingRight: pinned && edge !== 'bottom' ? DOCK_CHROME_W : 0 }}>
            <DeskHeader
              view={view}
              // Setup owns the connection's status while it stands.
              connected={connected && !showSetup}
              {...pick(panel, 'mapName')} {...pick(connection, 'providerName', 'modelName', 'connectionMeta')} {...pick(verbs, 'onRetryNow')}
              keyRefusal={refusal}
              now={now ?? ticked}
              {...pick(panel, 'liveAt')}
              onPause={verbs.onPause}
              onAskStop={askStop}
              onResume={() => onResume?.()}
              onCardAct={repair}
              onManage={() => dispatch({ type: 'manage' })}
              managing={managing}
              {...(opened ? { readingRecord: pictures.recordStamp?.(opened) ?? '' } : {})}
              helper={panel.lane !== undefined}
              setupFace={showSetup ? setupFace : null}
              {...(marking ? { marking: region ? 'painted' as const : 'blank' as const } : {})}
              {...(area.gateCells !== undefined ? { gateCells: area.gateCells } : {})}
              recordFiled={settled === null && opened === undefined && view.phase === 'idle'}
              heldOffer={layout.offered !== undefined && !keyCleared}
              storageSetAside={storageNotice === 'corrupt'}
              unsaved={storageNotice === 'lost'}
              // CharacterHost measures this empty seat and stands the live character over it.
              {...(hosted ? { characterSlot: <div ref={setDeskSeat} style={{ position: 'absolute', inset: 0 }} /> } : {})}
            />
          </div>
          <motion.div
            key={showSetup ? 'setup' : showWelcome ? 'welcome' : managing ? 'manage' : 'session'}
            {...zoneEnter(reduced)}
            data-testid="panel-job-frame"
            style={{ ...JOB_ZONE_STYLE, minHeight: jobZoneFloor(maxHeight, layout.zoneEmpty) }}
          >
            <ScrollIntent.Provider value={preserveReading}>
              <ScrollArea ref={jobZoneRef} data-testid="panel-job-zone" gutter="stable both-edges" fade={view.current ? 'end' : 'both'}
                style={{ flex: '1 1 auto', margin: `0 calc(0px - ${CONTROL_CLEARANCE})` }}
                contentStyle={{ display: 'flex', flexDirection: 'column', gap: 10, padding: CONTROL_CLEARANCE, minHeight: '100%', boxSizing: 'border-box' }}>
                {content}
              </ScrollArea>
            </ScrollIntent.Provider>
          </motion.div>
          {/* A standing queue zone keeps notes from resizing the record under the pointer. */}
          <SteerQueue steers={view.queuedSteers} {...(verbs.onRecallSteer ? { onRecall: verbs.onRecallSteer } : {})} />
          {/* Setup, the keyless rest and management carry their own foot. */}
          {notReady ? null : (
            <Composer
              route={composerRoute(view.phase)}
              running={isRunning}
              away={gone}
              marking={marking}
              {...(onMarkRegion ? { regionButton: <RegionButton bounds={region} marking={marking} onPress={onMarkRegion} /> } : {})}
              {...(regionChip ? { regionChip } : {})}
              // A standing question takes its answer in the composer.
              answering={settled?.job.question === true}
              {...(guidance ? { blocked: { key: guidance, off: layout.refusesOrders } } : {})}
              suggestion={filed.has(owedJob?.orderSeq ?? -1)
                || (droppedGhost?.orderSeq === owedJob?.orderSeq && droppedGhost?.text === view.suggestion) ? null : view.suggestion}
              onSend={verbs.onSend}
              onStop={askStop}
              {...(onResume ? { onResume } : {})}
              onDropSuggestion={() => setDroppedGhost({ orderSeq: owedJob?.orderSeq, text: view.suggestion })}
              onDraftChange={setDrafting}
              {...(panel.fill ? { fill: panel.fill } : {})}
              focusRef={focusComposer}
              {...(view.phase === 'idle' ? { caveat: t('agent.caveat') } : {})}
            />
          )}
        </motion.section>
        {/* The free panel's tab paints after the plate so their outlines join. */}
        {pinned ? null : controls}
        <AnimatePresence>
          {stopFrom !== null && isRunning && stopFrom.seq === currentSeq && (
            <ControlConfirm
              key="stop"
              anchor={stopFrom.anchor}
              floor={false}
              width={PANEL_CONFIRM_W}
              helpTarget={{ page: 'agent-run' }}
              title={t('agent.dock_stop_question')}
              cancelLabel={t('agent.action_cancel')}
              confirmLabel={t('agent.action_stop')}
              confirmTestId="dock-confirm-stop"
              cancelTestId="dock-confirm-cancel"
              onCancel={() => setStopFrom(null)}
              onConfirm={() => { setStopFrom(null); onStop(); }}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </AwayOwner>
  );
}

/** The named props that are present, for spreading into a child without passing undefined. */
function pick<T extends object, K extends keyof T>(from: T, ...keys: K[]): { [P in K]?: NonNullable<T[P]> } {
  const out: { [P in K]?: NonNullable<T[P]> } = {};
  for (const key of keys) if (from[key] !== undefined) out[key] = from[key] as NonNullable<T[K]>;
  return out;
}
