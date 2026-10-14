/*
 * Renders the fixed-height assistant status card and character seat. Face identity controls keyed
 * flips; clock and metadata changes repaint in place. Context screens can override session state.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { motion, useReducedMotionConfig, AnimatePresence } from 'framer-motion';
import type { PanelView } from '../../../agent/panel';
import { useT } from '../../../i18n/context';
import { Character } from '../character/Character';
import { poseForPhase, type PoseName } from '../character/poses';
import { setIntentPose } from '../character/intent';
import { StatusCard } from './StatusCard';
import { useLastActivity } from '../hooks/use-clock';
import { buildFace, deskFaceKey, deskPose, deskSeat, showsAllowAll, type DeskContext } from '../derive/desk-face';
import type { RepairAct } from '../derive/repair';
import type { SetupFace } from '../connection/setup-parts';
import { CHARACTER_SEAT } from '../../shell/panel-frame';
import { flipProfile, outMotion, turnSeconds } from '../../design/motion';

/** Gap between the externally hosted character seat and the status card. */
const DESK_GAP = 10;

/** Status-card flip perspective in pixels. */
const PERSPECTIVE = 520;

/** Status-card landing overshoot in degrees. */
const FLIP_OVERSHOOT = 7;

/** Full status-card turn duration from the motion registry, in milliseconds. */
const TURN_MS = turnSeconds('panel.dock.flip') * 1000;

interface DeskHeaderProps {
  view: PanelView;
  /** Connection readiness; callers explicitly report disconnected state. */
  connected?: boolean;
  /** The map the session is standing on, for the meta's fallback. */
  mapName?: string;
  /** The armed provider's display name, which the key faces say as their datum (`DeskContext`). */
  providerName?: string;
  /** The armed model's display name, the unserved-model face's own datum (`DeskContext`). */
  modelName?: string;
  /** One-shot pose override; the phase decides when absent. */
  pose?: PoseName;
  /** Clock source for elapsed time and retry countdowns. */
  now?: number;
  onPause?: () => void;
  /** Stop was pressed on the card's seat; the caller confirms from that control. */
  onAskStop?: (from: RefObject<HTMLElement | null>) => void;
  onResume?: () => void;
  onRetryNow?: () => void;
  /** The gear: one press back to the connection surface. */
  onManage?: () => void;
  /** Whether that surface is what the panel is showing right now, which lights the gear and turns
   *  the card into the connection's own face. */
  managing?: boolean;
  /** The live connection as one line, said on the manage face's meta deck. */
  connectionMeta?: string;
  /** A past record is open over the job zone, and this is its provenance (`DeskContext.reading`). */
  readingRecord?: string;
  /** A delegate is at work (`DeskContext.helper`). */
  helper?: boolean;
  /** Setup step currently replacing the job zone. */
  setupFace?: SetupFace | null;
  /** A saved session came back unreadable and was set aside on load (`DeskContext.setAside`). */
  storageSetAside?: boolean;
  /** The map holds the pencil, and whether a stroke has landed yet (`DeskContext.marking`). */
  marking?: 'blank' | 'painted';
  /** How many cells the call at the open gate would touch (`DeskContext.gateCells`). */
  gateCells?: number;
  /** The settled record has been put away (`DeskContext.recordFiled`). */
  recordFiled?: boolean;
  /** Whether the hold is a restored offer rather than a live pause. */
  heldOffer?: boolean;
  /** Whether local storage is full and the session is currently unsaved. */
  unsaved?: boolean;
  /** A terminal face's worded act, reported by its own id (the verbs live with the caller). */
  onCardAct?: (act: RepairAct) => void;
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
  onAskStop,
  onResume,
  onRetryNow,
  onManage,
  managing = false,
  connectionMeta,
  readingRecord,
  helper = false,
  setupFace,
  onCardAct,
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
  const ctx: DeskContext = {
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
  const key = deskFaceKey(view, ctx);
  // Tool and text streaming share one card so rapid updates cannot repeatedly hide its controls.
  const flowing = key === 'thinking' || key === 'streaming' || key === 'executing';
  const stateKey = flowing ? 'working' : key;

  // Publish surface-specific poses to the externally hosted live character.
  const surfacePose = deskPose(view, ctx);
  useEffect(() => {
    setIntentPose(surfacePose);
    return () => setIntentPose(null);
  }, [surfacePose]);

  const seat = deskSeat(view, ctx);
  const face = buildFace(view, ctx, now, activeAt, t);
  const seatRef = useRef<HTMLButtonElement>(null);
  const faceKey = stateKey;
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
  // Oversight status appears only on a face backed by an active session.
  const showAllow = showsAllowAll(view, ctx, face);

  const card = (
    <StatusCard
      face={face}
      seat={seat}
      seatRef={seatRef}
      gear={connected && !managing}
      allowAll={showAllow}
      reduced={reduced}
      t={t}
      onSeat={(act) => {
        if (act === 'pause') onPause?.();
        else if (act === 'stop') onAskStop?.(seatRef);
        else if (act === 'resume') onResume?.();
      }}
      onManage={onManage}
      onRetryNow={onRetryNow}
      onCardAct={onCardAct}
    />
  );

  return (
    <div
      data-testid="desk-header"
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
          ?? <Character pose={pose ?? deskPose(view, ctx) ?? poseForPhase(view.phase, { connected })} size={56} />}
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
