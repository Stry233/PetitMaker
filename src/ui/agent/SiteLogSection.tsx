/*
 * SiteLogSection — the Site Log itself, composed. Its host hands in the column's rect through
 * `AgentFrameProvider` and this file fills it with four zones: header row → dock → the log →
 * composer, or the setup screen when the gear is open / no key exists / an incident needs attention.
 *
 * Layout: the header and composer sit at fixed design offsets; the dock's
 * height is CONTENT-DRIVEN (chips and segments grow it), so the log's top and
 * height derive from a live measurement of the dock (ResizeObserver, converted
 * back to design px through the scale) — the one place the design grid flexes.
 *
 * Layering contract: each zone sits in a zero-layout wrapper (absolute
 * inset-0, hit-transparent) and every interactive island re-enables its own
 * pointer events; the setup <-> chat slide is the only screen-level motion.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { springs, exitTransition } from '../design/styles';
import { usePx } from '../design/scale';
import { useAgentFrame } from './frame';
import { useAgentStore } from '../../agent/store';
import { PROVIDER_ACCENT } from '../../agent/providers/defaults';
import { useAgentSession, type LogEntry } from '../../agent/session';
import { deriveDock } from './dock-state';
import { Dock } from './Dock';
import { HeaderRow } from './HeaderRow';
import { SiteLog } from './SiteLog';
import { Composer } from './Composer';
import { SetupScreen } from './SetupScreen';
import { OrderSlip } from './entries/OrderSlip';
import { AgentNote } from './entries/AgentNote';
import { BuildTicket } from './entries/BuildTicket';
import { SketchCard } from './entries/SketchCard';
import { BlueprintCard } from './entries/BlueprintCard';
import { useProviderSettings } from './useProviderSettings';
import { useSiteLogTurn } from './useSiteLogTurn';

/** Vertical rhythm (design px, prototype ×2): header 76 tall, 22 gaps. The composer sits at the
 *  section's own foot, which is the frame's `composerTop`. */
const HEADER_H = 76;
const GAP = 22;

interface Props {
  top: number;
  /** Cells in the painted region; 0 = whole map. The cells themselves are read from the store by
   *  the turn runner, so only the count travels through the panel props. */
  regionSize: number;
  isSelecting: boolean;
  onSelectRegion: () => void;
  onClearRegion: () => void;
}

export function SiteLogSection({ top, regionSize, isSelecting, onSelectRegion, onClearRegion }: Props) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, scale } = usePx();
  const frame = useAgentFrame();
  const agent = useAgentStore();
  const provider = agent.settings.provider;
  const apiKey = agent.settings.keys[provider] ?? '';
  const accent = PROVIDER_ACCENT[provider];

  const [draft, setDraft] = useState('');
  // The setup/chat choice lives in the agent store: saved keys decrypt asynchronously,
  // so a mount-time decision reads "no key" for a user who has one (setup flashes, then
  // sticks); and component state forgets the screen across panel switches. The store
  // decides once, after hydration, and the choice survives leaving the panel.
  const keysHydrated = agent.keysHydrated;
  const setupOpen = agent.setupOpen;
  useEffect(() => {
    if (keysHydrated && agent.setupOpen === null) agent.setSetupOpen(!apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysHydrated, apiKey]);
  /** Slide direction: opening setup slides in from the LEFT (back), entering
   *  the chat slides in from the RIGHT (forward) — prep before build. */
  const [slideDir, setSlideDir] = useState(1);
  const setSetupOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const prev = agent.setupOpen ?? !apiKey;
    const next = typeof v === 'function' ? v(prev) : v;
    if (next !== prev) setSlideDir(next ? -1 : 1);
    agent.setSetupOpen(next);
  };
  const turn = useSiteLogTurn({ draft, setDraft });

  // The FIRST screen renders already centered (no slide-in on agent-mode
  // entry) while its children keep their own entrances; screens mounted by a
  // later toggle slide in. AnimatePresence initial={false} would silence the
  // children's entrances too, so the suppression lives on the screen only.
  const firstScreen = useRef(true);
  useEffect(() => { firstScreen.current = false; }, []);

  const entries = useAgentSession((s) => s.log);
  const running = useAgentSession((s) => s.running);
  const thinking = useAgentSession((s) => s.thinking);
  const gate = useAgentSession((s) => s.gate);
  const vitals = useAgentSession((s) => s.vitals);
  const suggestion = useAgentSession((s) => s.suggestion);

  // provider/key/model machinery (unchanged hook); it opens setup when a
  // key-less provider is selected and closes it when a key is committed
  const ps = useProviderSettings(setSetupOpen);

  // an incident (401 / 429) surfaces on the setup screen
  useEffect(() => {
    if (turn.incident) setSetupOpen(true);
  }, [turn.incident]);

  /* ── dock derivation ── */
  const draftBp = entries.find((e) => e.kind === 'bp' && e.draft && !e.undone && !e.paused);
  const liveBp = entries.find((e) => e.kind === 'bp' && !e.done && !e.undone);
  const pickPending = entries.some((e) => e.kind === 'sketches' && e.picked === null && !e.undone);
  const view = deriveDock(
    {
      gate,
      waitingGate: !!draftBp && !running,
      waitingPick: pickPending && !running,
      bp: liveBp && liveBp.kind === 'bp' ? liveBp : null,
      running,
      thinking,
      vitals,
    },
    t,
  );

  /* ── content-driven dock height → log geometry ──
     Measured in DESIGN px (offsetHeight / the LIVE scale), so it is
     scale-invariant: it must NOT change while the UI zoom (Ctrl +/-) animates,
     or the log/composer it positions would lag a frame behind the rest of the
     panel. useLayoutEffect (not useEffect) settles it before paint; the live
     scaleRef keeps the divide correct without re-subscribing the observer on
     every zoom frame; the ResizeObserver still catches real content changes. */
  const dockWrapRef = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(0);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const showDock = entries.length > 0 && setupOpen === false;
  useLayoutEffect(() => {
    const el = dockWrapRef.current;
    if (!el || !showDock) { setDockH(0); return; }
    const measure = () => setDockH(Math.round(el.offsetHeight / scaleRef.current));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showDock, view.key]);

  const logTop = top + HEADER_H + GAP + (showDock ? dockH + GAP : 0);
  const logHeight = top + frame.composerTop - GAP - logTop;

  // Smooth the log's top/height ONLY across a dock enter/leave (so start-fresh
  // doesn't snap), never during a UI-zoom animation (that would make it lag).
  const [smoothGeom, setSmoothGeom] = useState(false);
  const prevShowDock = useRef(showDock);
  useEffect(() => {
    if (prevShowDock.current === showDock) return;
    prevShowDock.current = showDock;
    setSmoothGeom(true);
    const id = setTimeout(() => setSmoothGeom(false), 340);
    return () => clearTimeout(id);
  }, [showDock]);

  /* ── entry rendering ── */
  const flipTicket = (id: number) => {
    const S = useAgentSession.getState();
    const e = S.getEntry(id);
    if (e?.kind === 'ticket') S.patchEntry(id, { flipped: !e.flipped });
  };
  const toggleSummary = (id: number) => {
    const S = useAgentSession.getState();
    const e = S.getEntry(id);
    if (!e || (e.kind !== 'ticket' && e.kind !== 'bp')) return;
    const latest = entries.length > 0 && entries[entries.length - 1]!.id === id;
    S.patchEntry(id, { summaryOpen: !(e.summaryOpen ?? latest) });
  };
  const lastId = entries.length ? entries[entries.length - 1]!.id : -1;
  // flex column wrapper: entries decide their own alignment (the order slip
  // rides alignSelf flex-end; a block wrapper would pin everything left).
  // The exit animation is the start-fresh sweep.
  const renderEntry = (e: LogEntry, i: number) => (
    <motion.div
      key={e.id}
      data-eid={e.id}
      data-ekind={e.kind}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: px(16), scale: 0.97, transition: { ...exitTransition, delay: Math.min(i * 0.02, 0.24) } }}
      style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}
    >
      {e.kind === 'oslip' && <OrderSlip entry={e} />}
      {e.kind === 'note' && <AgentNote entry={e} />}
      {e.kind === 'ticket' && (
        <BuildTicket entry={e} latest={e.id === lastId} onUndo={turn.undoEntry} onFlip={flipTicket} onToggleSummary={toggleSummary} />
      )}
      {e.kind === 'sketches' && <SketchCard entry={e} accent={accent} onPick={turn.pickSketch} />}
      {e.kind === 'bp' && (
        <BlueprintCard
          entry={e}
          accent={accent}
          latest={e.id === lastId}
          onGate={turn.blueprintGateAnswer}
          onResume={turn.resumeBlueprint}
          onRewind={turn.rewindStage}
          onUndo={turn.undoEntry}
          onToggleSummary={toggleSummary}
        />
      )}
    </motion.div>
  );

  const jumpToBlueprint = () => {
    const logEl = turn.logRef.current;
    const cards = logEl?.querySelectorAll('[data-ekind="bp"]');
    const el = cards && cards.length ? cards[cards.length - 1] : null;
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  };

  const placeholder = running
    ? t('agent2.ph_running')
    : entries.length
      ? t('agent2.ph_more')
      : t('agent2.ph_first');

  /* ── screen transition: the setup <-> chat slide owns ALL movement here (the panel's own
        arrival is the host's); a per-row bottom-up cascade on top of the slide read as
        double motion ── */
  const slide = {
    enter: (dir: number) => (reduced ? { opacity: 0 } : { x: dir * px(180), opacity: 0 }),
    center: { x: 0, opacity: 1, transition: reduced ? { duration: 0 } : springs.stiff },
    exit: (dir: number) => (reduced ? { opacity: 0, transition: { duration: 0 } } : { x: -dir * px(180), opacity: 0, transition: exitTransition }),
  };

  // The setup/chat decision waits for key hydration (milliseconds); until it
  // lands, the panel holds both screens back.
  if (setupOpen === null) return null;

  if (setupOpen) {
    return (
      <AnimatePresence mode="wait" custom={slideDir}>
      <motion.div key="setup" custom={slideDir} variants={slide} initial={firstScreen.current ? 'center' : 'enter'} animate="center" exit="exit"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <SetupScreen
          top={top}
          height={frame.height}
          ps={ps}
          notice={turn.incident}
          onClearNotice={turn.clearIncident}
          onStartBuilding={() => { turn.clearIncident(); setSetupOpen(false); }}
        />
      </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence mode="wait" custom={slideDir}>
    <motion.div key="log" custom={slideDir} variants={slide} initial={firstScreen.current ? 'center' : 'enter'} animate="center" exit="exit"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <HeaderRow
          top={top}
          regionCells={isSelecting || regionSize > 0 ? regionSize : 0}
          onRegionToggle={() => (regionSize > 0 || isSelecting ? onClearRegion() : onSelectRegion())}
          onSetup={() => setSetupOpen(true)}
          onReset={() => {
            turn.pause();
            useAgentSession.getState().clearLog();
            agent.clearChat();
          }}
          canReset={entries.length > 0}
        />
      </div>

      <AnimatePresence initial={false}>
        {showDock && (
          <motion.div
            key="dock"
            initial={reduced ? false : { opacity: 0, y: px(-10), scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: springs.gentle }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: px(-10), scale: 0.98, transition: exitTransition }}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <div
              ref={dockWrapRef}
              style={{
                position: 'absolute',
                left: px(frame.x),
                top: px(top + HEADER_H + GAP),
                width: px(frame.w),
                pointerEvents: 'auto',
              }}
            >
              <Dock view={view} onChip={turn.gateAnswer} onJump={jumpToBlueprint} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <SiteLog
          top={logTop}
          height={logHeight}
          smoothGeom={smoothGeom}
          entries={entries}
          hasKey={Boolean(apiKey)}
          onStarter={(text) => void turn.send(text)}
          renderEntry={renderEntry}
          logRef={turn.logRef}
          onScroll={() => {
            const el = turn.logRef.current;
            if (!el) return;
            turn.nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        />
      </div>

      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <Composer
          top={top + frame.composerTop}
          draft={draft}
          setDraft={setDraft}
          running={running}
          hasKey={Boolean(apiKey)}
          placeholder={placeholder}
          suggestion={suggestion}
          onSend={() => void turn.send(draft.trim() ? undefined : (suggestion ?? undefined))}
          onPause={turn.pause}
        />
      </div>
    </motion.div>
    </AnimatePresence>
  );
}
