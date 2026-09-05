/*
 * Hosts the single live character in an unzoomed fixed layer. Floating-panel travel shares one
 * progress value with the character; dock transitions swap seats while she is hidden. The folded
 * hero chip and character pose both read the same memoized session projection as the panel.
 */
import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type RefObject,
} from 'react';
import { animate, AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { panelView, useAgentSession } from '../../../agent/session/store';
import { useT } from '../../../i18n/context';
import { useChromeScale } from '../../design/scale';
import { useDockStage } from '../../shell/use-dock';
import { cursors, font, z } from '../../design/styles';
import { INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { heroChipFace, useSecondClock } from '../dock-face';
import {
  amplitude, easingCss, framerMotion, landEasingCss, outEasingCss, outSeconds, overshootAt, seconds,
} from '../motion';
import { edge, statePaper } from '../tokens';
import { Character, getCharacterHandle } from './Character';
import { poseForPhase } from './poses';
import { useSurfacePose } from './surface-pose';
import { useCelebrateEdge } from './use-celebrate-edge';
import {
  carriedAlong, carryStep, deskSeat, parkCharacter, popCharacter, restingSeat, seatBox, setCarry,
  showCharacter, watchDeskSeat,
} from './seat';

/** Zero-size fixed layer; only the character and hero chip opt into pointer events. */
const LAYER_STYLE: CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  zIndex: z.panel + 1,
  pointerEvents: 'none',
};

/** Docked character sits one rung above the ground-level desk. */
const GROUND_LAYER_STYLE: CSSProperties = { ...LAYER_STYLE, zIndex: z.ground + 1 };

/** The parked character's box in the layer's own space, which the chip is placed from. */
interface Parked { left: number; top: number; width: number; height: number }

/** The chip's own seat at the character's shoulder: a little inside her right edge, a little below
 *  her top, so it reads as pinned to her rather than floating beside her. */
const CHIP_IN = 6;
const CHIP_DOWN = 4;

/** How far the chip starts short of its own size, per its declaration. */
const CHIP_FROM = 1 - 0.3;

export interface CharacterHostProps {
  /** Folded character seat. */
  entranceRef: RefObject<HTMLElement | null>;
  /** Whether the panel is intended to be open. */
  open: boolean;
  /** Whether a provider credential is available. */
  connected: boolean;
  /** The interface has been put away, so the character goes with the frame she stands on. */
  hidden?: boolean;
  /** Character width before the first seat measurement. */
  size: number;
  /** Opens the panel from the hero chip. */
  onOpen?: () => void;
  /** Toggles the panel from the character; absent leaves pointer handling to the block below. */
  onToggle?: () => void;
}

export function CharacterHost({
  entranceRef, open, connected, hidden = false, size, onOpen, onToggle,
}: CharacterHostProps) {
  const { place, sheetAside } = useDockStage();
  const t = useT();
  // panelView is memoized by the store's log, epoch and live-buffer inputs.
  const view = useAgentSession(panelView);
  const celebrate = useCelebrateEdge(view);
  // Celebration overrides surface pose, which overrides the session phase.
  const surface = useSurfacePose();
  const pose = celebrate ?? surface ?? poseForPhase(view.phase, { connected });
  const [parked, setParked] = useState<Parked | null>(null);

  // CSS zoom emits no resize event, so animated chrome scale is also a placement input.
  const chromeScale = useChromeScale();
  // The lazy panel registers its desk seat through an external-store seam.
  const seated = useSyncExternalStore(watchDeskSeat, deskSeat, () => null);
  const reduced = useReducedMotionConfig() === true;
  // One motion entry drives every track in the floating open or close gesture.
  const gesture = open ? 'panel.open' : 'panel.close';

  /** Measures both seats and places the character at the current shared gesture progress. */
  const park = useCallback((along?: number) => {
    // The desk remains the seat through collapse; restingSeat removes its carriage displacement.
    const folded = seatBox(entranceRef.current);
    const seat = restingSeat(seatBox(seated)) ?? folded;
    // Without a desk seat, folded and seated positions are identical and travel is zero.
    if (seat && folded) setCarry(along ?? carriedAlong(), carryStep(seat, folded));
    else if (along !== undefined) setCarry(along);
    const at = parkCharacter(seat);
    // Height follows the rendered artwork and is measured after width placement.
    const drawn = getCharacterHandle()?.el?.getBoundingClientRect();
    const height = drawn && drawn.height > 0 ? drawn.height : at?.width;
    if (at && height !== undefined) setParked({ ...at, height });
    // Dock changes can move a reused seat element without retriggering its ref callback.
  }, [entranceRef, seated, place]);

  const parkNow = useRef(park);
  parkNow.current = park;

  // React may commit frame layout after resize listeners run, so placement repeats on the next frame.
  const parkSettled = useCallback(() => {
    parkNow.current();
    if (typeof requestAnimationFrame !== 'function') return () => {};
    const frame = requestAnimationFrame(() => parkNow.current());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => parkSettled(), [parkSettled, park, chromeScale]);
  // A stable listener also catches height-only resizes that do not change chrome scale.
  useEffect(() => {
    let settle = () => {};
    const onResize = () => { settle(); settle = parkSettled(); };
    window.addEventListener('resize', onResize);
    return () => {
      settle();
      window.removeEventListener('resize', onResize);
    };
  }, [parkSettled]);

  /** Animates one interruptible progress value; docked and reduced-motion states settle immediately. */
  const away = place === 'leaving' || place === 'folded';
  // Docked ground stays at the open endpoint while the sheet performs the visible motion.
  const along = place === 'ground' || (open && !away) ? 1 : 0;
  useEffect(() => {
    if (reduced || place === 'ground' || place === 'folded') {
      parkNow.current(along);
      return undefined;
    }
    const run = animate(carriedAlong(), along, {
      ...framerMotion(gesture),
      onUpdate: (v: number) => parkNow.current(v),
    });
    return () => run.stop();
  }, [along, reduced, place, gesture]);

  // Place changes own character presence; floating open and close carry her without a separate pop.
  // Cancel a prior WAAPI animation before writing the next destination style.
  const popping = useRef<Animation | null>(null);
  const wasPlace = useRef(place);
  useEffect(() => {
    const from = wasPlace.current;
    wasPlace.current = place;
    if (from === place) return;
    popping.current?.cancel();
    popping.current = null;
    const to = away ? 0 : 1;
    // The folded stage is fully covered by the sheet, so it settles without an animation.
    if (reduced || place === 'folded') { showCharacter(to); return; }
    popping.current = popCharacter(to, {
      // Departure completes within the form's outgoing segment.
      total: to === 1 ? seconds('panel.character.pop') : outSeconds('panel.character.pop'),
      easing: to === 1 ? easingCss('panel.character.pop') : outEasingCss('panel.character.pop'),
      land: landEasingCss('panel.character.pop'),
      from: 1 - (amplitude('panel.character.pop') ?? 0),
      past: overshootAt('panel.character.pop'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, reduced]);

  // Follow the moving sheet and dock parallax by remeasuring its stable seat element each frame.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return undefined;
    const until = performance.now() + seconds('panel.pin.slide') * 1000;
    let frame = requestAnimationFrame(function follow(now) {
      parkNow.current();
      if (now < until) frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [sheetAside]);

  // Tick only while the folded hero chip can be visible.
  const chipWanted = !open && !hidden;
  const now = useSecondClock(chipWanted);
  const chip = chipWanted ? heroChipFace(view, now) : null;

  return (
    <div
      data-testid="character-layer"
      style={{
        ...(place === 'ground' ? GROUND_LAYER_STYLE : LAYER_STYLE),
        visibility: hidden ? 'hidden' : 'visible',
      }}
    >
      {/* The character itself is the control; this layer draws no surrounding plate. */}
      <Character
        pose={pose}
        size={size}
        {...(onToggle && !hidden ? { press: { onPress: onToggle, open } } : {})}
      />
      <AnimatePresence>
        {chip && parked && (
          <motion.button
            key="hero-chip"
            type="button"
            data-testid="hero-chip"
            onClick={() => onOpen?.()}
            initial={{ opacity: 0, scale: CHIP_FROM }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: CHIP_FROM }}
            transition={framerMotion('panel.chip.hero')}
            style={{
              position: 'absolute',
              left: parked.left + parked.width - CHIP_IN,
              top: parked.top + CHIP_DOWN,
              transformOrigin: '0 60%',
              // The chip opts into input while the zero-size layer remains pointer-transparent.
              pointerEvents: 'auto',
              cursor: cursors.clickable,
              whiteSpace: 'nowrap',
              background: statePaper.work,
              color: INK,
              border: edge,
              borderRadius: 999,
              padding: '4px 10px',
              ...roleFont('caption'),
              fontFamily: font.family,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {`${t(chip.wordKey)} ${chip.clock}`}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
