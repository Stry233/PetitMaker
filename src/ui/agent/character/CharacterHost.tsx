/*
 * Hosts the single live character in an unzoomed fixed layer. Floating-panel travel shares one
 * progress value with the character; dock transitions swap seats while she is hidden. The folded
 * hero chip and character pose both read the same memoized session projection as the panel.
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type RefObject,
} from 'react';
import { animate, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
// Eager: the folded character loads with the frame, so it reads the session store directly.
import { panelView, useAgentSession } from '../../../agent/boot';
import { useT } from '../../../i18n/context';
import { useChromeScale } from '../../design/scale';
import { useDockDepth, useDockStage } from '../../shell/use-dock';
import { font, z, radii } from '../../design/styles';
import { INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { heroChipFace } from '../derive/clock';
import { useSecondClock } from '../hooks/use-clock';
import {
  amplitude, easingCss, framerMotion, landEasingCss, outEasingCss, outSeconds, overshootAt, seconds,
} from '../../design/motion';
import { edge, statePaper } from '../panel-skin';
import { Character, getCharacterHandle } from './Character';
import { characterPose } from './poses';
import { useCharacterIntent } from './intent';
import { useCelebrateEdge } from './use-celebrate-edge';
import {
  carriedAlong, carryStep, deskSeat, parkCharacter, popCharacter, restingSeat, seatBox, setCarry,
  showCharacter, watchDeskSeat,
} from './seat';
import { useObservedSize } from '../../primitives/use-observed-size';
import { ActionButton } from '../../primitives/ActionButton';
import { onMorph, onMorphLayout, pageMorphing, type MorphRun } from '../../primitives/morph';

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

interface CharacterHostProps {
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
  // The bottom dock's seam moves her desk seat when the handle sets a new depth.
  const depth = useDockDepth();
  const t = useT();
  // panelView is memoized by the store's log, epoch and live-buffer inputs.
  const view = useAgentSession(panelView);
  const celebrate = useCelebrateEdge(view);
  const surface = useCharacterIntent().pose;
  const pose = characterPose({ celebrate, surface, phase: view.phase, connected });
  const [parked, setParked] = useState<Parked | null>(null);

  // CSS zoom emits no resize event, so the settled chrome scale is also a placement input; the planes' size observer follows the glide.
  const chromeScale = useChromeScale();
  // The lazy panel registers its desk seat through an external-store seam.
  const seated = useSyncExternalStore(watchDeskSeat, deskSeat, () => null);
  const reduced = useReducedMotionConfig() === true;
  // One motion entry drives every track in the floating open or close gesture.
  const gesture = open ? 'panel.open' : 'panel.close';

  /** The chrome's morph is drawing her from her old place: her drawn box is mid-travel, so the chip
   *  pinned to her waits for it to settle. */
  const morphing = useRef(false);
  /** Whether the hero chip stands at her shoulder: only then is her drawn box read and rendered. */
  const chipShown = useRef(false);
  /** Measures both seats and places the character at the current shared gesture progress; `chip`
   *  false places her without a render, for the chip pinned to her to follow later. */
  const park = useCallback((along?: number, chip = true) => {
    // Seats are read where the morph puts them (`seat.ts:seatBox`), so she parks at the place it ends
    // at even while it runs, a seat that lands late included, and the morph carries her there.
    if (morphing.current) chip = false;
    // The desk remains the seat through collapse; restingSeat removes its carriage displacement.
    const folded = seatBox(entranceRef.current);
    const seat = restingSeat(seatBox(seated)) ?? folded;
    // Without a desk seat, folded and seated positions are identical and travel is zero.
    if (seat && folded) setCarry(along ?? carriedAlong(), carryStep(seat, folded));
    else if (along !== undefined) setCarry(along);
    const at = parkCharacter(seat);
    // A glide or slide re-parks her every frame; with no chip to follow her, that is a write and no render.
    if (!chip || !chipShown.current || !at) return;
    // Height follows the rendered artwork and is measured after width placement.
    const drawn = getCharacterHandle()?.el?.getBoundingClientRect();
    const next = { ...at, height: drawn && drawn.height > 0 ? drawn.height : at.width };
    setParked((was) => (was && was.left === next.left && was.top === next.top && was.width === next.width && was.height === next.height ? was : next));
  }, [entranceRef, seated]);

  const parkNow = useRef(park);
  parkNow.current = park;

  // React may commit frame layout after resize listeners run, so placement repeats on the next frame.
  const parkSettled = useCallback(() => {
    parkNow.current();
    if (typeof requestAnimationFrame !== 'function') return () => {};
    const frame = requestAnimationFrame(() => parkNow.current());
    return () => cancelAnimationFrame(frame);
  }, []);
  // A dock change can move a reused seat element without calling its ref, so the stage re-parks too.
  useEffect(() => parkSettled(), [parkSettled, park, chromeScale, place, depth]);
  // CSS zoom changes the containing plane's layout size, while each seat keeps its local size.
  useObservedSize(() => {
    const planes = new Set<HTMLElement>();
    for (const seat of [entranceRef.current, seated]) {
      let plane = seat?.parentElement;
      while (plane && !plane.style.getPropertyValue('--shell-zoom')) plane = plane.parentElement;
      if (plane) planes.add(plane);
    }
    return [...planes];
  }, () => parkNow.current(), [entranceRef, seated], { layout: false, immediate: false });
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
  /** Whether the place she stands at now hides her, for the morph's end to apply. */
  const awayNow = useRef(away);
  awayNow.current = away;
  const wasPlace = useRef(place);
  useEffect(() => {
    const from = wasPlace.current;
    wasPlace.current = place;
    if (from === place) return;
    popping.current?.cancel();
    popping.current = null;
    const to = away ? 0 : 1;
    // The folded stage is fully covered by the sheet, so it settles without an animation; a place the
    // chrome's morph changes (a turned screen docking the panel elsewhere) is the morph's to draw, her
    // box travelling and resizing from the old seat to the new rather than leaving and arriving.
    // While the chrome's morph carries her, a place the re-arrangement passes through on its way (the
    // panel leaving its free place to dock) neither hides nor pops her; the place it settles at does.
    if (pageMorphing() || morphing.current) { if (to === 1) showCharacter(1); return; }
    if (reduced || place === 'folded') { showCharacter(to); return; }
    popping.current = popCharacter(to, {
      // Departure completes within the form's outgoing segment.
      total: to === 1 ? seconds('panel.character.pop') : outSeconds('panel.character.pop'),
      easing: to === 1 ? easingCss('panel.character.pop') : outEasingCss('panel.character.pop'),
      land: landEasingCss('panel.character.pop'),
      from: 1 - (amplitude('panel.character.pop') ?? 0),
      past: overshootAt('panel.character.pop'),
    });
  }, [place, reduced, away]);

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

  // A layout-shape morph draws her as one of its pieces (`Character.tsx`): she takes her new seat just
  // before it measures where pieces end; the chip follows once the morph has run.
  useEffect(() => onMorphLayout(() => {
    morphing.current = true;
    parkNow.current(undefined, false);
  }), []);
  useEffect(() => {
    let latest: MorphRun | null = null;
    return onMorph((run) => {
      latest = run;
      void run.settled.then(() => {
        if (latest !== run) return;
        morphing.current = false;
        if (awayNow.current) showCharacter(0);
        parkNow.current();
      });
    });
  }, []);

  // Tick only while the folded hero chip can be visible.
  const chipWanted = !open && !hidden;
  const now = useSecondClock(chipWanted);
  const chip = chipWanted ? heroChipFace(view, now) : null;
  const chipUp = chip !== null;
  // The chip arrives at her current place, read before the paint that first shows it.
  useLayoutEffect(() => {
    chipShown.current = chipUp;
    if (chipUp) parkNow.current();
  }, [chipUp]);

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
          <ActionButton
            key="hero-chip"
            interaction="pill"
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
              whiteSpace: 'nowrap',
              background: statePaper.work,
              color: INK,
              border: edge,
              borderRadius: radii.pill,
              padding: '4px 10px',
              ...roleFont('caption'),
              fontFamily: font.family,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {t('agent.hero_chip', { phase: t(chip.wordKey), clock: chip.clock })}
          </ActionButton>
        )}
      </AnimatePresence>
    </div>
  );
}
