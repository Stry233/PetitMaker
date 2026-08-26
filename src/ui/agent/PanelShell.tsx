/*
 * PanelShell.tsx — the column everything else in this directory stands in, and the assembly is all
 * it is. The normative prototype's `makePanel`: FOUR top-level groups, in this order and no
 * other —
 *
 *   desk (character + dock) · the job zone · the steering chip · the composer
 *
 * FOUR IS A LIMIT, NOT A COUNT. Every state of the panel is one of those four zones showing
 * something different, so a fifth group would be a state the layout has no place for: the setup
 * screen replaces the JOB ZONE's contents rather than standing beside it. Nothing here appears
 * between two standing controls and pushes them apart.
 *
 * THE COMPOSER IS ABSENT IN THE WHOLE SETUP FAMILY — the keyless rest, every step of the connection
 * screen, and the manage card — and the bottom zone is then the SCREEN'S OWN ACTION ROW: Connect, the
 * step's Back or Try again, Done. Each of those screens fills the job zone and pins its own foot to
 * the foot of it, so what stands at the bottom of the panel is the one thing the surface is asking
 * for. A field standing there with nowhere to send is an invitation the surface above it contradicts,
 * and a disabled well is still a message box the eye and the caret both go to first.
 *
 * IT RENDERS PROJECTIONS AND CALLS VERBS. `PanelView` in, runner verbs out: this file reads no
 * store, derives no session fact and owns no timer. The two facts it does compute are the shell's
 * own rather than the log's — which settled jobs the user has since undone (the undo depth against
 * each job's first checkpoint) and whether a key is held at all — and both are inputs it is handed.
 *
 * NO ANCESTOR OF THE CHARACTER'S SEAT MAY CARRY A TRANSFORM. The one live character stands in her own
 * layer (`character/seat.ts`), positioned `fixed` from the seat's measured rect; a transform or a
 * filter on an ancestor of that box becomes the containing block for the `fixed` element and she
 * lands somewhere else entirely. Her dust puff has the same requirement for the same reason. So the
 * panel enters by opacity and a clip-path wipe, which clip paint and leave the box alone, and never
 * by transform.
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import {
  motion, useMotionValue, useReducedMotionConfig, useTransform, type Variants,
} from 'framer-motion';
import { composerRoute } from '../../agent/session/composer-routing';
import type { AskRecord, JobView, PanelView, SessionPhase } from '../../agent/core/project-view';
import type { GateOption, JobOutcome } from '../../agent/core/types';
import { useT } from '../../i18n/context';
import { PLATE, PLATE_INK } from '../design/tokens';
import { radii } from '../design/styles';
import { AnswerPaper, isAnswerJob } from './AnswerPaper';
import { IconButton, PIN_KNOB, PIN_KNOB_OUT, PinKnob, RESUME_PRIMARY } from './atoms';
import { Banner, type BannerActionId, type BannerClass } from './Banner';
import { ArchiveCard, FlipTicket, IncidentCard, StopCard, type Checkpoint } from './FlipTicket';
import { Composer, COMPOSER_HEIGHT } from './Composer';
import { CHIP_VIGNETTE, RegionButton, RegionChip, TICKET_VIGNETTE } from './region-chip';
import { DeskHeader, DOCK_HEIGHT, keyGone, type DockActId } from './DeskHeader';
import { AskDeck, deckRuns } from './AskDeck';
import { GateBlock } from './GateBlock';
import { OptionPick, optionAskFrom } from './OptionPick';
import { PlanGate } from './PlanGate';
import { HistoryStrip } from './HistoryStrip';
import { IconSprite } from './icons';
import { JobTicket, jobStamps, pausedWhere } from './JobTicket';
import { ResumeCard } from './ResumeCard';
import { SteerQueue } from './SteerQueue';
import type { LaneView } from './Lane';
import type { RegionBounds } from '../../state/region-bounds';
import { edge, PANEL_MIN_HEIGHT, PANEL_PAD, PANEL_WIDTH } from './tokens';
import { DOCK_CHROME, DOCK_CHROME_FILE_H, DOCK_CHROME_W, type DockSide } from '../shell/panel-frame';
import { fmtClock, useSecondClock } from './dock-face';
import { easingCss, framerMotion, seconds } from './motion';
import { SetupScreen } from './SetupScreen';
import { DreamOffice } from './DreamOffice';
import { getCharacterHandle } from './character/Character';
import { setDeskSeat, setPanelCarriage } from './character/seat';
import { ManageScreen } from './ManageScreen';
import type { LiveConnection } from '../../agent/exec/runner';
import type { SetupEntry, SetupFace } from './setup-parts';
import { windowPill } from '../design/window-skin';
import { useScrollFade } from '../primitives/scroll-fade';
import { useViewportEpoch } from '../hooks/use-viewport-epoch';
import { useCelebrateEdge } from './character/use-celebrate-edge';

/**
 * The panel arriving and leaving, as one variants object so the swap can drive the exit with an
 * `AnimatePresence` of its own (`initial`/`animate` already run here).
 *
 * IT WIPES OUT OF ITS OWN TOP-LEFT CORNER, which is the corner the CHARACTER stands on: the frame
 * anchors the panel's top-left to her seat, so the wipe is the panel unfolding from behind her rather
 * than fading in over the map (prototype `panelOpen`'s `clip-path: inset(0 92% 92% 0)`).
 *
 * AND NO TRANSFORM, WHICH IS THE PROTOTYPE'S ONE DEVIATION HERE — its `panelClose` shrinks by 4%. The
 * character is placed `fixed` from her seat's measured rect, and her seat is reserved inside this
 * panel; a transform here changes that rect while the measurement is being taken and seats her off
 * her mark. `clip-path` clips paint and leaves the box alone, so the wipe is safe where a scale is
 * not. Same rule the frame's own entrance follows, for the same reason.
 *
 * THE GROUND HAS ITS OWN STANDING STATE, AND IT IS THE SQUARE ONE. A clip written for a card carries
 * that card's corner, and this one OUTLIVES the wipe — an `inset(0 round 28px)` clips nothing but the
 * corners, forever, so a docked plate reached its edges and still showed the page through four
 * rounded notches. Docked there is no wipe to ride and nothing to round against, so the standing clip
 * is the square one. (Not `none`: the property is animated, and a keyword cannot be interpolated
 * against an inset on the way back out.)
 */
/**
 * The seed rect the wipe grows out of and folds back into (her folded box, in the plate's own corner),
 * and the rect that clips nothing.
 *
 * THE OPEN RECT IS NOT FOUR ZEROES, AND THAT IS LOAD-BEARING RATHER THAN A TRICK. An `inset()` whose
 * four offsets are equal SERIALIZES to one value, and an inset of one component cannot be interpolated
 * against one of four — so read off a standing panel, the fold had nothing to tween and the clip
 * jumped to the seed rect on frame one, which is what left the close a bare fade. A hair of NEGATIVE
 * inset on two edges keeps four components in the computed value, and negative is the safe direction:
 * it puts the clip edge just OUTSIDE the border box, so nothing of the plate is ever cut.
 */
/** The floating plate's own corner, in frame px. Named because THREE declarations are that one radius:
 *  the plate's border, the clip the entrance wipe rides (below, which outlives the wipe), and the depth
 *  the dock knob hangs from — a control any higher than this has its inner half over the curve, where
 *  there is no paper behind it. */
export const PANEL_RADIUS = 28;

const WIPE_SEED = `inset(0% 92% 92% 0% round ${PANEL_RADIUS}px)`;
const WIPE_OPEN = `inset(0% -1% -1% 0% round ${PANEL_RADIUS}px)`;
const WIPE_GROUND = 'inset(0% -1% -1% 0%)';

/**
 * THE KNOB RIDES THE WIPE, BY ARITHMETIC. The wipe is a clip on the PLATE, and the knob stands
 * outside the plate — the clip would cut it — so left unmoved it hung whole over the map while the
 * paint it hangs on shrank into the far corner (measured mid-fold: 435 screen px between the disc and
 * the plate's visible edge). This reads a clip value as the carry that keeps the disc CENTRED ON THE
 * PLATE'S VISIBLE RIGHT EDGE, proportionally down its visible height, at the visible box's own share
 * of the plate — one function of the same animated value the plate paints with, never a second
 * animation approximating the first (the character's `placeCarried` is the precedent).
 *
 * Insets are clamped at zero: the open rect's hair of NEGATIVE inset exists to keep the clip
 * interpolable (see below) and cuts nothing, so it carries the knob nowhere. And an `inset()` whose
 * edges agree SERIALIZES to fewer components, so every arity is read, or the disc would jump at a
 * serialization boundary.
 */
export function knobCarry(clip: string): { x: number; y: number; scale: number } {
  const inset = /inset\(([^)]*)\)/.exec(clip)?.[1];
  if (inset === undefined) return { x: 0, y: 0, scale: 1 };
  const edges = (inset.split('round')[0] ?? '').trim().split(/\s+/).map((v) => parseFloat(v));
  const right = Math.max(0, (edges.length > 1 ? edges[1] : edges[0]) ?? 0) / 100;
  const bottom = Math.max(0, (edges.length > 2 ? edges[2] : edges[0]) ?? 0) / 100;
  return {
    x: 0 - PANEL_WIDTH * right,
    y: 0 - (PANEL_RADIUS + PIN_KNOB.size / 2) * bottom,
    scale: 1 - right,
  };
}

/**
 * ONE STATE NAME, TWO ELEMENTS, EACH DECLARING THE TRACK IT OWNS.
 *
 * The panel is the plate AND the tab hanging off its edge (see the return below), so the thing that
 * appears and goes away is the pair: the HOLDER carries the fade, which is what makes them leave
 * together — a fade on the plate alone left the tab standing on the map after the panel had gone. The
 * PLATE carries the wipe, since the corner the wipe seeds from is the plate's own. Framer hands the
 * state name down from the holder, so neither element has a label or a clock of its own.
 *
 * AND IT FOLDS BACK THE WAY IT CAME, which is what makes the close the open's mirror rather than a
 * second, unrelated motion: the same seed rect at the same corner, the same coupling to her step,
 * reversed. The corner means as much on the way out as on the way in — the panel is going BACK to her,
 * and a plain fade said only that it had stopped being there. Its own clock is shorter, the way every
 * other leave in the house is.
 */
export const panelVariants: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1 },
  ground: { opacity: 1 },
  gone: { opacity: 0, transition: framerMotion('panel.close') },
};

export const plateVariants: Variants = {
  hidden: { clipPath: WIPE_SEED },
  shown: { clipPath: WIPE_OPEN },
  ground: { clipPath: WIPE_GROUND },
  gone: { clipPath: WIPE_SEED, transition: framerMotion('panel.close') },
};

/** A DOCKED PLATE IS REVEALED, NOT ARRIVED: the sheet sliding off it is its whole entrance, so it
 *  lands square and opaque in the frame it is asked for, however it got there. Without this the plate
 *  that a dock revives out of the floating exit resumed that exit's own values, fading up and
 *  un-wiping while the sheet was already off it, in plain view. NO MOTION rather than a motion of zero
 *  length: there is no clock here to be chosen, which is why this names no number. */
const REVEALED = { type: false } as const;

/** The phases whose dock face carries a RUNNING number — the elapsed clock or a countdown. A hold
 *  and a receipt read a stamp instead, so their faces need no tick. */
const TICKING: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'thinking', 'streaming', 'executing', 'gated', 'pausing', 'retrying',
]);

/** The phases in which a job is not proceeding, so the composer's stop control has nothing to stop. */
const AT_REST: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['idle', 'paused', 'aborted', 'incident']);

/** The phases in which the work is NOT MOVING though the job is still open: the ticket's tape
 *  freezes where it stands rather than crawling on about progress nobody is making. A gate is one of
 *  them — the assistant is waiting on the user, not building. */
const HELD: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'gated', 'retrying', 'pausing', 'paused',
]);

/** The phases whose ticket carries the hold's own mark and the two verbs that end it. `pausing` is
 *  not one: the pause has not landed, so there is nothing yet to resume from. */
const ON_HOLD: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['paused']);

/** How far off the foot still counts as "reading the newest thing", in px. One op row's worth of
 *  slack, so a fractional scroll position or a row settling into place does not read as a scroll-up. */
const FOLLOW_SLACK = 48;

/**
 * The record follows the work (prototype: the job zone's `scrollTop` is set to its `scrollHeight`
 * whenever the blocks change). Without it the newest op row, an open gate's two buttons and the
 * closing summary all arrive below the fold and the user scrolls by hand at every step.
 *
 * ONE DEVIATION FROM THE PROTOTYPE, WHICH SCROLLS UNCONDITIONALLY: it follows only while the user
 * is ALREADY at the foot. A demo has nobody reading its history; a real job appends for minutes,
 * and yanking the view back down each time would make the record unreadable while it is being
 * written. Scrolling up is how the user says "I am reading"; returning to the foot resumes the
 * follow.
 *
 * `active` is off wherever the zone holds no RECORD — the setup screen, which is a form read from
 * the top down, and whose first line is what scrolling to the foot would hide — AND while a thoughts
 * box is open. An open box is a wall of text being READ, and the projection moves several times a
 * second during the very turn that produced it, so the follow would drag the reader back to the foot
 * on each one. The ticket reports the box (`JobTicket.onThoughtsOpenChange`); closing it hands the
 * follow back.
 *
 * THE PIN SURVIVES THE ROOM CHANGING, and what that took is telling a SCROLL apart from a RESHAPE.
 * A resize moves the zone's box without changing a word of the record, and the browser adjusts the
 * container's own `scrollTop` as it goes and fires `scroll` for it — read as a scroll, that is the
 * user saying "I am reading" about a move they never made, and the follow was dropped for good. It
 * cost an open gate's Approve 20px of fold on an 800 -> 780 -> 800 round trip and 50px on a
 * width-only one (the frame re-zooms, so the box changes with the window's height untouched).
 *
 * SO THE HANDLER MEASURES THE BOX, NOT THE POSITION — and the box is the ZONE'S OWN HEIGHT, never
 * its scrollHeight. A scroll arriving with the box a different size than it was is the layout's, so
 * the standing answer is kept and the foot is re-taken; a scroll over an UNCHANGED box is the
 * user's own, however much the CONTENT has grown since. Content growing inside an unchanged box
 * fires no scroll at all (a deck fanning open on its own height, an op row landing), so a cached
 * scrollHeight is stale by the user's next scroll — read against it, the hand on the wheel was
 * taken for a reshape and yanked to the foot (measured live: a fanned deck's reader, re-pinned
 * mid-read). Only the box changing makes the browser move `scrollTop` on its own, so the box is the
 * whole reshape test. This has to be the scroll handler and not a `resize` listener or a render
 * effect: at either of those moments the frame's zoom has not been applied yet, so the box reads at
 * its pre-zoom size and the pin lands on the foot the panel is about to stop having.
 * `ResizeObserver` backstops the case where the box changes and `scrollTop` does not, so no scroll
 * is fired at all.
 */
function useFollowNewest(
  ref: RefObject<HTMLDivElement | null>, key: unknown, epoch: string, active: boolean,
): void {
  const stuck = useRef(true);
  /** The zone's height at the last reading, so a reshape can be told from a scroll. */
  const boxHeight = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    const toFoot = () => {
      boxHeight.current = el.clientHeight;
      if (stuck.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      if (el.clientHeight !== boxHeight.current) { toFoot(); return; }
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    boxHeight.current = el.clientHeight;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(toFoot) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [ref, active]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
    boxHeight.current = el.clientHeight;
  }, [ref, key, epoch, active]);
}

/**
 * The panel box tweening from the height it had to the height it now wants (`panel.height`).
 *
 * MEASURED, NOT LAID OUT, and never a framer `layout` animation: that one animates a size change
 * with a TRANSFORM, and a transform on this element becomes the containing block for the `fixed`
 * character standing in her seat — she would land somewhere else entirely (see the file
 * header). A Web Animations keyframe pair on `height` animates the real property, sets no inline
 * style and leaves the box back at `auto` when it finishes, so the panel keeps being content-sized
 * between its want and its cap.
 *
 * IT COMPARES ACROSS COMMITS, which is the only way this can work: a layout effect runs AFTER the
 * DOM already holds the new content, so two readings taken inside one of them are equal by
 * construction — the tween never ran once (measured in the live app: four real shape changes,
 * including 367 to 159 own px on a mode switch, zero animations). So the height the last commit left
 * PAINTED is carried in a ref, and this commit's reading is compared against that.
 *
 * `offsetHeight`, NOT a rect: the panel stands inside the frame's css `zoom`, where
 * `getBoundingClientRect` answers in SCREEN px (550 for a 440px panel at 1.25) while the `height`
 * being animated is in the element's own. The same divide-out every measured popover here does,
 * except that reading the untransformed property needs no division at all.
 *
 * The FIRST measurement never animates: the panel's arrival is its own wipe (`panel.open`), and a
 * height tween from zero would be a second entrance underneath it. And a tween still RUNNING is read
 * before it is cancelled, because it holds the height: where the eye is is the animated value, and
 * the new tween starts from there rather than jumping back to the last painted number. One that has
 * finished holds nothing, so it is not read at all.
 *
 * A CHANGE OF ROOM RE-BASELINES RATHER THAN TWEENS (`viewport`). The cap is a css expression against
 * the window, so a resize moves the painted box with no React commit behind it and nothing here to
 * hear: the remembered height went stale by exactly the resize's own delta, and the NEXT shape change
 * then animated from it — measured, a 63px jump on a mode switch whose real height delta was zero.
 * The re-baseline is silent because a resize is the user dragging an edge and the box has to track
 * the pointer; a tween there would lag every step of the drag behind the window.
 */
function useHeightTween(
  ref: RefObject<HTMLElement | null>, shape: unknown, reduced: boolean, viewport: string,
): void {
  const painted = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  const room = useRef(viewport);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reroomed = room.current !== viewport;
    room.current = viewport;
    // A tween that has FINISHED no longer holds anything, and reading the box through it would
    // answer the height this commit has just laid out — from and to would match and the next change
    // would go untweened (the mode switch back, 159 to 367 own px, would run nothing).
    const live = running.current;
    const held = live !== null && live.playState === 'running';
    const from = held ? el.offsetHeight : painted.current;
    live?.cancel();
    running.current = null;
    const to = el.offsetHeight;
    painted.current = to;
    if (from === null || reduced || reroomed || Math.abs(to - from) < 1) return;
    if (typeof el.animate !== 'function') return; // jsdom, and any engine without Web Animations
    running.current = el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: seconds('panel.height') * 1000, easing: easingCss('panel.height') },
    );
  }, [ref, shape, reduced, viewport]);
  useLayoutEffect(() => () => { running.current?.cancel(); }, []);
}

/** The air between two zones, in px (artifact `#panel`). The plate's own inset is `tokens.ts`'s
 *  `PANEL_PAD`, which the receipt's full-width picture is derived from as well. */
const ZONE_GAP = 10;

/** How many gaps stand between the four zones. */
const ZONE_GAPS = 3;

/**
 * WHAT STANDS WHATEVER THE RECORD DOES, in px: the dock's constant card, the composer's own well,
 * the three gaps and the plate's padding. It is the room the record's floor may NOT take, and it is
 * derived rather than typed — a taller dock or a taller composer moves it by itself.
 *
 * Measured in the live frame to confirm the derivation: 180px, against a job zone of 186 in a 367px
 * panel (1280x800, no mode).
 */
export const PINNED_HEIGHT = PANEL_PAD * 2 + DOCK_HEIGHT + COMPOSER_HEIGHT + ZONE_GAP * ZONE_GAPS;


/**
 * HOW FAR DOWN THE ZONE A STICKY HEAD REACHES, in px, or 0 where nothing is parked.
 *
 * MEASURED RATHER THAN DERIVED, because the band is whatever the order line actually wrapped to: the
 * line clamps at two, so it is one rung or two depending on the order, the locale and the UI zoom,
 * and it is only sticky at all while a ticket is scrolled far enough to park it. The reading is the
 * live gap between the zone's own top and the parked line's bottom, which is 0 for every state that
 * has no ticket in it.
 *
 * The FIRST parked line wins: several tickets can be in the zone, and the one holding the top edge is
 * the only one covering anything.
 */
function stickyBand(zone: HTMLElement): number {
  const top = zone.getBoundingClientRect().top;
  for (const order of zone.querySelectorAll('[data-testid="ticket-order"]')) {
    const box = order.getBoundingClientRect();
    // A line that has not reached the top edge is scrolling normally and covers nothing; one already
    // above it belongs to a ticket that has scrolled past.
    if (box.bottom <= top || box.top > top + 1) continue;
    return Math.max(0, box.bottom - top);
  }
  return 0;
}

/**
 * The bare box the plate and its tab share, so the two are one object for the open gesture to carry.
 *
 * IT HOLDS NOTHING OF ITS OWN: no paper, no outline, no clip. `position: relative` is the whole of it
 * (the tab is placed against this box) plus `display: flex`, so the plate keeps the height and width
 * it declares for itself and the holder is exactly the plate's box.
 */
const PLATE_HOLDER: CSSProperties = { position: 'relative', display: 'flex' };

/**
 * THE PADDING AND THE OUTLINE ARE FOUR EDGES EACH AND NEVER A SHORTHAND, because the docked plate
 * overrides edges of the outline (only the seam's survives). An inline `border` beside an inline
 * `border-left` is a shorthand fighting a longhand, and the fight is decided by write ORDER —
 * undocking removes the longhand and React never re-writes the shorthand it did not change, so the
 * overridden edge came back at 0 rather than at its own value (measured after undocking from a
 * right-hand dock, where the desk, and so the character's seat, stood 14px too far into the corner).
 * Four of each, and every one of them written in both modes.
 */
const PANEL_STYLE: CSSProperties = {
  width: PANEL_WIDTH,
  boxSizing: 'border-box',
  background: PLATE,
  borderTop: edge,
  borderRight: edge,
  borderBottom: edge,
  borderLeft: edge,
  borderRadius: PANEL_RADIUS,
  paddingTop: PANEL_PAD,
  paddingRight: PANEL_PAD,
  paddingBottom: PANEL_PAD,
  paddingLeft: PANEL_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: ZONE_GAP,
  color: PLATE_INK,
  minHeight: PANEL_MIN_HEIGHT,
  overflow: 'hidden',
};

/**
 * The panel sized against the room the frame has for it, when the caller knows what that is.
 *
 * THE WANTED HEIGHT MUST YIELD TO THE CAP, and a plain `minHeight`/`maxHeight` pair does not do it:
 * CSS resolves a min-height that exceeds a max-height in the MIN's favour, so the two written side
 * by side leave the panel standing at its full want in a window that has less. At the frame's own
 * reference window (1280x800) the room under the entrance block is ~367px against a want of 430,
 * and in Generate mode — where the shelf takes the bottom third — it is ~159px: the panel ran past
 * its allowance and stood over the candidate cards. `min()` is what makes the want a want.
 */
/**
 * The plate DOCKED, which is not a card in a different place: it is the GROUND.
 *
 * A CARD IS ROUNDED AND OUTLINED BECAUSE IT IS LYING ON SOMETHING. This one is what everything else
 * is lying on (`design/styles.ts:z.ground`): three of its edges are the window's own and the fourth
 * is the seam where the sheet of interface covers it. So no corner rounds — there is nothing behind
 * one to round against, and a rounded corner here shows the page through it — and the outline survives
 * on that fourth edge alone, which is the one place this surface meets another. THE RADIUS HAS TWO
 * DECLARATIONS AND BOTH HAVE TO GO SQUARE: this one, and the clip the entrance wipe rides
 * (`panelVariants`), which carries the same 28 and outlives the wipe.
 *
 * THE SEAM IS THE SIDE'S: docked left the sheet covers the right edge, docked right the left. THE
 * CONTENT TAKES THE GUTTER'S WIDTH: the padding stays the plate's own on all four edges, so
 * everything below the dock band spans the docked column whole, and the buttons' seat is carved out
 * of the desk band alone (`desk-band` below), at the right in both modes.
 *
 * The height is the caller's cap, which docked IS the window, and the authored want has nothing to
 * say about it — every px the desk and the composer do not take belongs to the record.
 */
function dockedStyle(cap: string | undefined, side: DockSide): CSSProperties {
  const atSeam = side === 'left' ? 'right' : 'left';
  return {
    ...PANEL_STYLE,
    width: PANEL_WIDTH + DOCK_CHROME_W,
    minHeight: 0,
    height: cap ?? '100%',
    maxHeight: cap ?? '100%',
    borderRadius: radii.none,
    borderTop: '0',
    borderBottom: '0',
    borderLeft: atSeam === 'left' ? edge : '0',
    borderRight: atSeam === 'right' ? edge : '0',
  };
}

function panelStyle(cap: string | undefined, hug: boolean): CSSProperties {
  // A SCREEN BRINGS ITS OWN HEIGHT. The want above is for a DESK WITH A RECORD under it — the column
  // that would otherwise read as a chip — and a connection screen is not that: it is a form whose
  // foot is pinned to its own bottom, so a plate standing 430 tall around a 300px form opens a hole
  // between the last field and the verb that leaves the step. The form hugs, the way the normative
  // prototype's panel does on the same steps, and the cap still bounds it.
  if (hug) return { ...PANEL_STYLE, minHeight: 0, ...(cap === undefined ? null : { maxHeight: cap }) };
  if (cap === undefined) return PANEL_STYLE;
  return { ...PANEL_STYLE, maxHeight: cap, minHeight: `min(${PANEL_MIN_HEIGHT}px, ${cap})` };
}

/**
 * THE ONE SCROLLING REGION, and the panel's whole layout rests on it: the desk, the steer chip and
 * the composer are `flex: 0 0 auto`, so the panel grows to the room its host has and the RECORD is
 * what gives way. That is what pins the two controls a user needs — the dock at the top and the
 * composer at the bottom — while a long ticket scrolls between them.
 *
 * HOVER GROWTH NEEDS ROOM INSIDE THE CLIP, which is what the padding/margin pair is (artifact
 * `.zJob`, its derivation carried verbatim): the house press feedback scales a control to 1.03 about
 * its centre, so a full-width row in here (378px of panel less its 14px padding either side = 336px
 * of row) grows 5.04px per side — past an `overflow-x: hidden` edge that had 1px of padding, and the
 * card's own left and right border vanished for as long as the pointer rested on it. The 6px gutter
 * IS that growth, and the negative margins hand the width straight back, so no row is a pixel
 * narrower for it and no state's layout moves. Anything new in here that scales above 1.036 at full
 * width needs the pair re-derived. THE -5 IS NOT THE 6 MINUS ONE: the box owes the 12px of new
 * padding MINUS the 1px it already had, so 336px of row survives a 10px scrollbar gutter.
 */
const JOB_ZONE_STYLE: CSSProperties = {
  // GROW as well as shrink: the panel stands at its authored want (`PANEL_MIN_HEIGHT`) even when it
  // holds less, and the zone taking up that slack is what keeps the composer on the bottom edge
  // rather than floating halfway up an empty panel. The artifact's own `0 1 auto` cannot be read
  // apart from this one: its panel has no wanted height, so there is never slack to distribute.
  flex: '1 1 auto',
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '1px 6px',
  margin: '0 -5px',
  scrollbarWidth: 'thin',
  // NO STANDING GUTTER: `scrollbar-gutter: stable` reserves a scrollbar's width of RIGHT inset under
  // classic scrollbars whether or not anything scrolls, and it stacks with each screen's own
  // scroller into a one-sided margin (measured docked at 1440x900: content 15px off the plate's left
  // edge, 38px off its right). The room for a scrollbar is taken only while one shows, which is the
  // one state where an unequal inset reads as a scrollbar rather than as padding. Pinned by
  // `scroll-gutter.test.tsx`.
  // SCROLL ANCHORING OFF: the browser keeps a scroller's view on whatever content it judges the
  // reader to be looking at, which for a record that FOLLOWS ITS FOOT is a second opinion about the
  // one thing this zone decides for itself. Its adjustments are sub-pixel and arrive as ordinary
  // scrolls over an unchanged box, so `useFollowNewest` cannot tell one from a hand on the wheel.
  overflowAnchor: 'none',
};

/** No deck fanned open. A module constant so a fresh mount's set is the same object every time. */
const NO_DECKS: ReadonlySet<string> = new Set();

/** The record's floor, in px: below this a job zone is a dead band rather than a record. */
export const JOB_ZONE_FLOOR = 72;

/**
 * THE ROOM A PLAN CARD NEEDS TO BE READ IN, in the frame's own px, and what the panel borrows from
 * the bar below while one is standing unanswered.
 *
 * A plan gate is the tallest thing the panel can be holding a QUESTION on: a head, the two notes the
 * panel says in its own voice, one row per stage, and the answer pair. In Object mode at 1280x800 the
 * courteous room is 233 frame px against a 180px skeleton, so the card had 53px of zone to stand in
 * and what showed was the answer pair with the plan itself scrolled off above it — the user was being
 * asked to approve a plan the panel was not showing them. In Generate mode there was less again.
 *
 * SO THE COURTESY IS THE THING THAT GIVES. `footReserve` keeps the panel clear of the bottom bar,
 * which is worth having while the panel is only reporting; it is not worth a question the user cannot
 * read. While the gate stands the panel spends that reserve and paints over the bar instead
 * (`z.column`, the rung for a column standing over something as wide as the window), and the moment
 * it is answered the panel is back inside its allowance — nothing beneath it was moved or disabled at
 * any point, it was covered.
 *
 * THE FOOT GIVES AND THE HEAD DOES NOT, which is where this stops short of the number. At the
 * reference window the foot is worth 261 frame px of zone against the 53 the courteous cap left, so
 * the head, the note, four stages and the answer pair all stand; the last note line of the tallest
 * possible card still scrolls. Reaching the whole 419 would mean sliding the column up under the
 * block row as well, which puts the panel over the five mode blocks and the character's own entrance
 * — a cost the bar below never had, and one this ruling did not ask for.
 *
 * THE ASK IS GENEROUS ON PURPOSE and costs nothing where it is not needed: a cap does not stretch the
 * panel, it only stops bounding it (`panelStyle` gives the box no height of its own), so a two-stage
 * plan asks for the same room and ends where its own content ends.
 */
const PLAN_GATE_ROOM = 419;

/** What the borrow ADDS to the panel's least workable height: the room the card wants, less the
 *  record floor that height already asks for. */
export const GATE_BORROW = Math.max(0, PLAN_GATE_ROOM - JOB_ZONE_FLOOR);

/**
 * THE FLOOR YIELDS TO THE CAP, and that order is load-bearing: the desk and the composer are what a
 * user needs standing, so the floor is only ever what is LEFT after them.
 *
 * THE ARTIFACT'S FLAT 72 IS WHAT THIS DEVIATES FROM, and the reason is a room the artifact never
 * stands in: its panel is capped at `100vh - 136px` with the whole window to grow in, while this one
 * hangs under two block rows with a bottom bar under it, so its room can be 159px.
 *
 * A flat 72 pushed the composer out of the panel. Measured in the real frame at 1280x800 (the frame
 * stands under a 1.25 page zoom, so the room is the viewport divided by it): Object mode has 233px
 * against a pinned 180, so 72 asked for 252 and the composer's last 19px were clipped away; Generate
 * mode has 159, where the composer landed entirely below the panel's own box and a press aimed at it
 * answered CANVAS. `min(72px, max(0px, room - pinned))` is the floor where there is room for one and
 * nothing where there is not.
 *
 * WAIVED OUTRIGHT for a rest state whose whole record is the CLOSED past-jobs row: the 72px showed
 * as an empty strip under one 40px row (the artifact waives it by the same test).
 *
 * With no cap in hand the caller is not standing the panel in a room at all (a test, a lone mount),
 * so the floor is simply the floor.
 */
function jobZoneFloor(cap: string | undefined, waived: boolean): string | number {
  if (waived) return 0;
  if (cap === undefined) return JOB_ZONE_FLOOR;
  return `min(${JOB_ZONE_FLOOR}px, max(0px, calc(${cap} - ${PINNED_HEIGHT}px)))`;
}

/** Which settled jobs the user has undone past. A job's FIRST checkpoint records the undo depth
 *  before it wrote anything, so a live depth back down at or below that number means every edit the
 *  job made is off the map again. A job that took no checkpoint cannot be judged and is not
 *  reported: silence beats guessing that its work is gone. */
function rolledBackSeqs(jobs: readonly JobView[], undoDepth: number | undefined): ReadonlySet<number> {
  if (undoDepth === undefined) return new Set();
  const out = new Set<number>();
  for (const job of jobs) {
    const first = job.checkpoints[0];
    if (first !== undefined && undoDepth <= first.undoIndex) out.add(job.orderSeq);
  }
  return out;
}

/**
 * The outcomes whose settled job stands as a card in the record.
 *
 * AN ABORT IS ONE OF THEM, because a stopped job owes the user a decision (what happened to my map,
 * and do I want it back) that no other surface makes.
 *
 * AND SO IS AN INCIDENT, because the banner and the card say different things: the banner names the
 * CLASS and its repair, the card names WHICH ORDER and HOW FAR IT GOT. Withholding it leaves an
 * incident face as a banner over ~112px of empty cream with the order it is about nowhere on screen,
 * where the artifact keeps the order standing under the notice. The card carries no verbs of its
 * own, so the two are not the same trouble said twice with two different verbs.
 */
const CARDED: ReadonlySet<JobOutcome> = new Set<JobOutcome>(['done', 'capped', 'aborted', 'incident']);

/** Which of the terminal family's cards a settled job earns. */
type TerminalShape = 'paper' | 'stop' | 'receipt' | 'stalled';

/** How long a settled job had run when it ended, as the dock reads the same fact: a settled reading
 *  is the last event the log recorded, not the wall clock, so it stands frozen at what happened. */
function clockOf(view: PanelView, job: JobView): string | null {
  return fmtClock((view.lastEventAt - job.orderAt) / 1000);
}

/**
 * The settled job standing in the record, and which card it is.
 *
 * THE CARD TAKES THE TICKET'S PLACE, which is why a job in flight leaves none: the newest settled
 * record is the one the desk is talking about, and an order given over it starts the next job. A
 * FILED record has no card at all — the user has put it away, and the row in the past-jobs list is
 * what it becomes.
 *
 * WHICH card: an ABORT is the stop card whatever it did (a stopped build is a decision, not a
 * receipt), and everything else splits on `AnswerPaper.isAnswerJob`, the projection's own
 * answer-vs-build boundary rather than a second reading of the ops (see that file's header).
 */
function terminal(
  view: PanelView, filed: ReadonlySet<number>, held?: JobView,
): { job: JobView; shape: TerminalShape } | null {
  if (view.current) return null;
  const job = view.jobs[view.jobs.length - 1];
  if (!job || job.outcome === undefined || !CARDED.has(job.outcome)) return null;
  if (filed.has(job.orderSeq)) return null;
  // ONE JOB, ONE CARD — the same rule `past` below applies to the history list, and the second site
  // it has to hold at. A key revoked under a job the loop had already ABORTED reaches both readings:
  // the job has settled (so it is the terminal record) and it is keyless with edits on the map (so
  // it is the blocked offer). The zone then stood a resume card reading "paused at the step
  // boundary" above a stop card reading "Stopped by you" — one order twice, neither sentence true,
  // two ways to put it away and the rewind on only one of them. The OFFER leads, because it is the
  // one that carries the repair.
  if (held !== undefined && job === held) return null;
  const shape: TerminalShape = job.outcome === 'aborted'
    ? 'stop'
    : job.outcome === 'incident'
      ? 'stalled'
      : isAnswerJob(job) ? 'paper' : 'receipt';
  return { job, shape };
}

/** The hold's own controls, standing after the card that produced the hold. Its geometry is the
 *  ticket foot's, so a hold reads the same wherever its verbs ended up. */
const HOLD_ACTIONS_STYLE: CSSProperties = { display: 'flex', gap: 8, flex: '0 0 auto' };

/** No records filed, for a caller that keeps no such marks. */
const NONE_FILED: ReadonlySet<number> = new Set();

/**
 * WHAT AN UNREPAIRED FAULT LEAVES THE COMPOSER SAYING, and whether the field is off while it stands.
 *
 * A fault the user must fix FIRST turns the well off and puts the repair where the invitation would
 * be: an order typed into a spent account, a blocked endpoint or an exhausted ladder is an order the
 * panel cannot carry, and "Give an order" over one of those is a promise it will break. The
 * exception is the fault whose repair IS the next order — a job too big to hold — which keeps the
 * field live and only rewords it.
 *
 * A CLASS THAT IS ABSENT HERE LEAVES THE COMPOSER ALONE, which is the honest default for the generic
 * incident: nothing specific is owed, so nothing specific is said.
 */
const COMPOSER_BLOCKED: Partial<Record<BannerClass, { key: string; off: boolean }>> = {
  auth: { key: 'agent3.composer_blocked_key', off: true },
  'key-cleared': { key: 'agent3.composer_disconnected', off: true },
  quota: { key: 'agent3.composer_blocked_provider', off: true },
  cors: { key: 'agent3.composer_blocked_endpoint', off: true },
  // The address is fine and the model is not, so the instruction is the model rather than the URL.
  model: { key: 'agent3.composer_blocked_model', off: true },
  network: { key: 'agent3.composer_blocked_waiting', off: true },
  overloaded: { key: 'agent3.composer_blocked_waiting', off: true },
  'rate-limit': { key: 'agent3.composer_blocked_waiting', off: true },
  overflow: { key: 'agent3.composer_shorter', off: false },
};

/**
 * The trouble the panel should be showing, or null. The phase says a job ended badly; the job's own
 * `errorCls` says which of nine notices that is.
 *
 * IT REPORTS THE JOB, NOT JUST THE CLASS, because a dismissal has to be about ONE incident. Keyed
 * by class, the second network failure of a session would be swallowed by the first one's dismissal
 * for as long as the panel stayed mounted — the user waves a notice away and the app stops telling
 * them the same thing has gone wrong again. A settling job's `orderSeq` is that incident's identity.
 * `-1` stands for an incident with no job behind it (a stray `incident` before any order), which no
 * real `orderSeq` can collide with.
 */
function trouble(view: PanelView): { cls: BannerClass; seq: number } | null {
  if (view.phase !== 'incident') return null;
  const last = view.jobs[view.jobs.length - 1];
  return { cls: last?.errorCls ?? 'unknown', seq: last?.orderSeq ?? -1 };
}

export interface PanelShellProps {
  view: PanelView;
  /** False puts the setup screen in the job zone and disables the composer. */
  connected: boolean;
  /**
   * WHETHER THE CONNECTION COULD ACTUALLY CARRY AN ORDER (`settings.ts:connectionReady`): a key
   * filed, an address where the provider is the user's own server, a model id standing.
   *
   * A KEY ALONE IS NOT THAT, and the difference is the whole of why this arrives beside `connected`.
   * The connection screen fills the three in over several steps and a session can come back holding
   * half of them (a reload with the model never defaulted), so a panel keyed on the key alone stood
   * at "Ready for orders" over a connection whose first request could not be built. Unready and
   * keyed, the job zone shows the connection screen at the step that owns what is missing.
   *
   * Defaults TRUE, so a caller that does not model the question is read as it always was rather than
   * having its panel replaced by a form it never asked for.
   */
  ready?: boolean;
  /** The map the session is standing on, for the dock meta's fallback: at rest and on a receipt the
   *  map IS the context, and only the caller reading the editor's store knows its name. */
  mapName?: string;
  /** The armed provider's display name, which the dock's key faces say as their datum. A SETTINGS
   *  fact, so it arrives beside the projection rather than in it. */
  providerName?: string;
  /** The armed model's display name: the unserved-model banner names it in its sentence, and the
   *  dock carries it as that face's datum. */
  modelName?: string;
  /** The connection the job in flight LAUNCHED with, for the settings card to tell apart from the
   *  armed one. Undefined where no job is running. */
  liveConnection?: LiveConnection;
  /** `runner.active()`. Defaults to a phase reading, which agrees with it in every ordinary case. */
  running?: boolean;
  /** The live undo stack depth, for the rolled-back reading. Omitted, no job reports rolled back. */
  undoDepth?: number;
  /** The settled records the user has put away (`agent/session/store.ts:filed`). A filed record has
   *  no card in the job zone; the past-jobs row is what it becomes. */
  filed?: ReadonlySet<number>;
  /** The session's own storage health (`agent/session/store.ts:storageNotice`): a save that had to
   *  prune, a save that could not be made at all, or a saved session that came back unreadable. Each
   *  is its own banner, and `onDismissStorage` is how the notice is put down. */
  storageNotice?: 'pruned' | 'lost' | 'corrupt' | null;
  onDismissStorage?(): void;
  /** The session came back from storage and nothing has happened to it since
   *  (`agent/session/store.ts:restored`). It is the one thing that tells a job the user is HOLDING
   *  from a job the session was FOUND holding, and the two are different screens (see the offer
   *  below). */
  restored?: boolean;
  /** Put a HELD job away: settle it and file the record. Distinct from `onFileAway`, which files a
   *  record that has already settled — a job still in the current seat has to be ended first, or the
   *  panel keeps a hold with no card. Unwired, a held offer draws no set-aside. */
  onSetAside?(orderSeq: number): void;
  /** The records the user has REMOVED (`agent/session/store.ts:cleared`). They are filed too, so
   *  they already have no card; this is what also keeps them out of the past-jobs list, where a
   *  cleared record standing as a row is a removal that did not happen. */
  cleared?: ReadonlySet<number>;
  /** The records whose edits are on a map that is not the one open. Those rows read but cannot be
   *  rolled back, and the panel stands the notice over the list. */
  otherMap?: ReadonlySet<number>;
  /** The records that name no map at all, so no roll back from here can be PROVEN to aim at the map
   *  that is standing. Refused like the above and said in its own words. */
  unknownMap?: ReadonlySet<number>;
  /** Which past record is OPEN as its own reading, by order seq. An opened record is a STATE: it
   *  covers the job zone and the dock says so. */
  openRecord?: number | null;
  /** Overrides the panel's own ~1Hz retry clock. Tests pass a fixed value; nothing else needs to. */
  now?: number;
  /** How tall the panel may stand, as a css length: the room the FRAME has for it, which only the
   *  caller standing it in the frame knows. Omitted, the panel takes its authored height. */
  maxHeight?: string;

  onSend(text: string): void;
  onStop(): void;
  onPause(): void;
  /** Continue a paused job with no note (the composer's empty submit on the resume route). */
  onResume?(): void;
  /** `words` carries the sentence the user is answering with — a tapped quick pill and a chosen
   *  option both take that route, because that is what they are: the user's own reply, sent for
   *  them. The gate cancels the call it was holding and the sentence becomes guidance. */
  onGateAnswer(gateId: string, answer: 'allow' | 'skip' | 'words', words?: string): void;
  /** Ends a retry backoff early (`runner.retryNow()`), which is what the dock's countdown presses. */
  onRetryNow?(): void;
  /** The gear: one press back to the connection surface, from any connected face. */
  onManage?(): void;
  /** Whether that surface is what the job zone is showing. The manage card is CHROME over the
   *  session — the log, the phase and the job in flight are all untouched while it stands, which is
   *  what lets Done put the exact same session back (escape invariant 4). */
  managing?: boolean;
  /** The live connection as one line, for the manage face's meta. */
  connectionMeta?: string;
  /** How many settled records the manage card's clear verb would take. */
  jobCount?: number;
  /** Dismisses the manage card. */
  onManageDone?(): void;
  /** Removes every settled record, from the manage card's own confirm. */
  onClearJobs?(): void;
  /** A terminal face's worded act. `new-order` is answered HERE — the composer it points at is this
   *  file's own child — and the rest travel to the caller, which owns the runner and the key vault. */
  onDockAct?(act: DockActId): void;
  onRecallSteer?(steerSeq: number): void;
  onRewind?(checkpoint: Checkpoint): void;
  /** Put a settled record away, by its order seq. Unwired, the terminal card offers no File it away
   *  rather than one that files nothing. */
  onFileAway?(orderSeq: number): void;
  /** Told that the user has waved the suggestion ghost away. The panel drops it ITSELF (the ghost is
   *  a projection, so there is nothing a caller could clear); this is only for a caller that wants
   *  to know. */
  onDropSuggestion?(): void;
  onBannerAction?(action: BannerActionId): void;
  onOpenTicket?(job: JobView): void;
  /** Close the opened record and go back to the state it was opened from, list reopened. */
  onCloseRecord?(): void;
  /** Remove one settled record outright, from the archive card's own confirm. */
  onClearRecord?(orderSeq: number): void;
  onRollBack?(job: JobView): void;
  /** Take a whole settled job back off the map, from the receipt's back face or the stop card. */
  onRewindAll?(job: JobView): void;
  /** The capped receipt's ink primary: file the same order again with a fresh turn budget. */
  onKeepGoing?(job: JobView): void;
  onSetupDone?(): void;
  /**
   * Put the panel away. UNCONDITIONAL, and that is the whole point: Escape and the block that opens
   * the panel both call this in EVERY state, setup and a refused key included. Refusing to fold
   * from those two leaves a visitor who cannot get a key working with no way back to the map at
   * all; the parked character is the standing way back in, and a running job keeps running shut.
   * It is not a pause and it never touches the run.
   */
  onCollapse?(): void;

  /** One ask's map thumbnail, built by the caller that owns a renderer (a `PlanGate` has no
   *  footprint and is never asked). Per ASK rather than one node for the panel: an answered card goes
   *  on standing with its own picture, so several can be on screen at once. */
  gateThumb?(ask: AskRecord): ReactNode;
  /** One OPTION's map thumbnail, the same slot one rung down: a pick ask's cards each name their own
   *  rect, so the picture is per option rather than per ask. */
  optionThumb?(option: GateOption): ReactNode;
  /** The live helper lane (`store.childLive` folded into a `LaneView`), for the delegate row that
   *  has one. Deliberately NOT part of `view`: the child's progress is not a log fact and must never
   *  reach anything a reload replays. */
  lane?: LaneView;
  /**
   * THE LIVE PAINTED REGION, or null for none — the store's one region fact, read by the caller
   * that stands beside the editor's store.
   *
   * It is the CHIP's subject and nothing else's. A running ticket draws the region the order was
   * FILED under (`JobView.region`), which is a copy taken at push time: the user may repaint or
   * clear the paint while the run stands, and the record must go on saying which region held. So
   * the two legitimately disagree mid-run, and neither is derived from the other.
   */
  region?: RegionBounds | null;
  /** The map holds the pencil (`state.selectingRegion`). The job zone folds, the composer yields,
   *  and the desk says where to look. */
  marking?: boolean;
  /** How many cells the call at the open gate would touch, measured by the caller that owns the tool
   *  surface's cell resolver and the live grid (`DeskHeader`'s `gateCells`). */
  gateCells?: number;
  /** Arm the map's own region brush, or finish a marking already under way. Absent, no frame button
   *  stands in the composer. */
  onMarkRegion?(): void;
  /** Clear THE PAINT ITSELF (`core/runtime/region-brush.ts:clearRegionSelection`), which is what
   *  the chip's cross does. Never a panel-local flag: the write tools read the store. */
  onClearRegion?(): void;
  /** A region's bounds photographed over the live map, at the size the caller is asked for. Built
   *  by the caller that owns a renderer, like every other picture on this seam; absent, the chip and
   *  the ticket head stand with their words and no vignette. */
  regionShot?(bounds: RegionBounds, width: number, height: number): ReactNode;
  /** One settled build's own photograph, framed on what it built, from the caller that owns a
   *  renderer. Absent, the receipt draws no postcard rather than an empty frame. */
  recordShot?(job: JobView): ReactNode;
  /** When a record was made, in the caller's own words — the archive card's provenance stamp and the
   *  dock's meta while it stands open. */
  recordStamp?(job: JobView): string;
  /**
   * THE IDLE DRESSING: the sketch card, built by the caller that owns a renderer and the map.
   *
   * A NODE rather than a list of ideas, for the same reason every picture on this seam is one — the
   * card's ground is a real capture of the live island. What this component decides is WHERE it may
   * stand: last in an idle rest, nearest the composer, and nowhere else. Absent is the ordinary
   * case rather than a fault: a map with nothing to propose offers no card, and the rest state
   * stands without it.
   */
  sketchbook?: ReactNode;
  /**
   * Words handed to the composer's field from outside it (the sketch card's press), keyed by `seq`
   * so the same words twice still land. It FILLS and focuses; sending stays the user's own press.
   */
  fill?: { text: string; seq: number };
  /** The one live character stands in her own layer outside this tree (`character/CharacterHost`),
   *  in the seat the frame anchors this panel's own corner to. The desk then RESERVES her box rather
   *  than drawing her; without this a lone mount draws its own so the desk still reads whole. */
  hosted?: boolean;
  /**
   * THE PANEL IS DOCKED: it owns a side region of the window whole rather than standing over the map.
   *
   * The CONTENT column is the same column at the same width — what changes is that the plate reaches
   * both edges of the window and grows a control gutter at its inner edge, so the height the caller
   * caps it at is the window's and the record takes the surplus. Its own edges square off against the
   * window's, since a corner rounds nothing where there is no map behind it to round against.
   */
  pinned?: boolean;
  /** Which end of the window it is docked at, which decides the seam, the gutter's edge and what the
   *  side switch offers. Read only while `pinned`. */
  dockSide?: DockSide;
  /**
   * THE BEAT IN THE MIDDLE OF A DOCK CHANGE: the form standing a moment ago is being replaced, so this
   * one is folded onto her button and invisible.
   *
   * It is a STATE rather than an absence because the panel is one element in both forms: unmounted here,
   * the returning form would arrive by cancelling an exit instead of playing an entrance, and what stood
   * on screen was a whole panel that had never unfolded.
   *
   * AND WHETHER IT IS WATCHED DECIDES WHETHER IT MOVES (`shell/use-dock.ts:DockStage.place`). `leaving`
   * is the floating form's exit with the sheet not yet moved, which somebody is looking at; `folded` is
   * that same state under a sheet covering the whole window, where a fold is a motion nobody can see and
   * the frame before it starts is a whole panel painted over the cover.
   */
  away?: 'leaving' | 'folded';
  /** Dock the panel, or set it free again. Absent, the panel draws no dock control at all — a
   *  headless mount (a test, the artifact rig) has no frame for a dock to change the shape of. */
  onTogglePin?(): void;
  /** Move the dock to the other end of the window. Docked only: there is no side to switch while the
   *  panel stands on the frame's grid. */
  onSwitchSide?(): void;
  /** The window is too narrow for the dock (`shell/panel-frame.ts:hasPinRoom`), so the control stands
   *  and refuses rather than going away: a control that vanished would take its own explanation with
   *  it, and the layout would move under the hand that was reaching for it. */
  pinBlocked?: boolean;
}

export function PanelShell({
  view,
  connected,
  ready = true,
  mapName,
  providerName,
  modelName,
  liveConnection,
  running,
  undoDepth,
  filed = NONE_FILED,
  cleared = NONE_FILED,
  otherMap,
  unknownMap,
  openRecord = null,
  now,
  maxHeight,
  onSend,
  onStop,
  onPause,
  onResume,
  onGateAnswer,
  onRetryNow,
  onManage,
  managing = false,
  connectionMeta,
  jobCount,
  onManageDone,
  onClearJobs,
  onDockAct,
  onRecallSteer,
  onRewind,
  onFileAway,
  onDropSuggestion,
  onBannerAction,
  storageNotice,
  onDismissStorage,
  restored = false,
  onSetAside,
  onOpenTicket,
  onCloseRecord,
  onClearRecord,
  onRollBack,
  onRewindAll,
  onKeepGoing,
  onSetupDone,
  onCollapse,
  gateThumb,
  optionThumb,
  lane,
  region = null,
  marking = false,
  gateCells,
  onMarkRegion,
  onClearRegion,
  regionShot,
  recordShot,
  recordStamp,
  sketchbook,
  fill,
  hosted = false,
  pinned = false,
  dockSide = 'left',
  away,
  onTogglePin,
  onSwitchSide,
  pinBlocked = false,
}: PanelShellProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const rootRef = useRef<HTMLElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const jobZoneRef = useRef<HTMLDivElement>(null);
  /**
   * THE WIPE AS AN OWNED VALUE: handed to the plate's `style`, so the variants above animate THIS
   * value, and the knob's carry is derived from the same one (`knobCarry`) — the fold has one driver
   * and the disc cannot run on a second clock. Seeded at the state the first render stands in, since
   * the derived transform is read before Framer's first frame writes it.
   */
  const wipe = useMotionValue(pinned ? WIPE_GROUND : reduced ? WIPE_OPEN : WIPE_SEED);
  const knobX = useTransform(wipe, (clip: string) => knobCarry(clip).x);
  const knobY = useTransform(wipe, (clip: string) => knobCarry(clip).y);
  const knobScale = useTransform(wipe, (clip: string) => knobCarry(clip).scale);
  const [dismissed, setDismissed] = useState<number | null>(null);
  /**
   * THE LOST/PRUNED STORAGE NOTICE, READ RATHER THAN CLEARED: the house rule for a fault banner
   * binds this one too, so its Dismiss demotes exactly like the incident banner's does rather than
   * unmounting the record out from under the very press that answered it. `corrupt` is not tracked
   * here — its Discard genuinely drops the set-aside bytes (the label says so), which is a real
   * answer rather than an acknowledgment, so it keeps clearing the store's own fact.
   *
   * Local, matching the job incident's own `dismissed` above: a fact still true after a remount
   * reads loud again, which is the same tradeoff the incident banner already carries.
   */
  const [dismissedStorage, setDismissedStorage] = useState<'pruned' | 'lost' | null>(null);
  // A RESOLVED NOTICE RE-ARMS THE NEXT ONE: the store only clears `lost`/`pruned` on a save that
  // actually worked, and a fresh failure after that is a fact this mark has never seen, so it must
  // not read as already answered.
  useEffect(() => { if (storageNotice !== 'lost' && storageNotice !== 'pruned') setDismissedStorage(null); }, [storageNotice]);
  /**
   * THE SETUP SCREEN OUTLIVES THE KEY BEING FILED.
   *
   * `connected` turns true the instant `connectKey` files the key — which is the FIRST of the setup
   * screen's three steps, not the last. A zone keyed on `connected` alone swaps to the record
   * mid-flow: the screen unmounts with its draft, and the model step (and everything after it, a
   * refusal included) is unreachable, leaving a filed key, "Ready for orders", and no model chosen.
   * Setup leaves on its OWN word, which is what `onDone` is for.
   */
  const [inSetup, setInSetup] = useState(false);
  /**
   * A KEY GOING AWAY LANDS ON THE REST, NOT ON THE FORM.
   *
   * The keyless rest is the dreaming office, and its triggers are exactly "boot with an empty vault,
   * a key cleared in settings, a corrupt vault". Putting the form up unasked would be the panel
   * demanding a credential before it has said what it is for. Setup is walked into from here, by
   * the Connect verb.
   *
   * ONE EXCEPTION, and it is the dock's own "enter a key" act over a panel that HOLDS one: the
   * caller drops the key and the caret is supposed to land in the field on that same press, so the
   * rest would swallow the second half of an act the panel itself started. `askedForField` is that
   * one press, remembered across the commit the key goes away in.
   *
   * IT NEVER TAKES THE FORM DOWN, and that is the whole of the second half. A refusal is a key
   * ARRIVING and then going away again — the form commits it, the provider says no, the screen drops
   * it — so a rule written as "no key means the rest" folded the form away at the exact moment it had
   * something to say, and the refused face could not be reached in the app at all: the user pasted a
   * bad key, pressed Enter, and landed back in the dreaming office with no word about why. Nothing
   * needs this to force the form DOWN: the rest is where a keyless panel starts, and the two ways a
   * key is dropped from outside the form (settings, a corrupt vault) both happen with it closed.
   */
  const askedForField = useRef(false);
  useEffect(() => { if (!connected) setInSetup((was) => was || askedForField.current); }, [connected]);
  /**
   * AND A HALF-MADE CONNECTION PUTS IT UP UNASKED, which is the one case that is not the user walking
   * in. A key filed with no model to name in the request, or the user's own server with no address,
   * cannot carry an order however the panel is keyed — and the screen that finishes it is this one, at
   * the step that owns what is missing (`SetupScreen`'s own entry reading).
   *
   * IT LATCHES, like the dock's own "enter a key" does, and for the same reason: the form's next step
   * may DROP the key (a refusal is a key arriving and going away again), and a zone keyed on the
   * condition alone would fold the screen away at the moment it had something to say.
   *
   * THE MANAGE CARD OUTRANKS IT, because that is where the model id is typed: standing the form up
   * as the provider row changes would take the repair out of the user's hands mid-press.
   */
  useEffect(() => { if (connected && !ready && !managing) setInSetup(true); }, [connected, ready, managing]);
  const showSetup = inSetup;
  /**
   * THE JOB A KEYLESS SESSION STILL OWES THE USER A WORD ABOUT: the one in the seat where there is
   * one, else the newest settled record. A revoke while a job is PAUSED leaves it in the seat (there
   * was no loop to abort), so reading the settled list alone answered with the wrong job entirely.
   */
  const owedJob = view.current ?? view.jobs[view.jobs.length - 1];
  /**
   * THE KEY WENT AWAY WITH A JOB STANDING, which is the one keyless state that is not a rest.
   *
   * A session holding a job that stopped BECAUSE the credential vanished has news, and the dreaming
   * office would lose it: the work is on the map, the order is unfinished, and the repair is one
   * press. So this state shows the RECORD — the notice plus the held job as a blocked offer, or the
   * live ticket where the loop still has it — and the office waits until the job is put away.
   */
  const keyCleared = owedJob !== undefined
    && keyGone(view, connected, owedJob.errorCls)
    && !filed.has(owedJob.orderSeq);
  /** No key, no form asked for, and nothing owed: the panel's own keyless rest. */
  const showWelcome = !connected && !inSetup && !keyCleared;
  /** Either way the job zone is showing a SCREEN rather than the record. */
  const formOwnsZone = showSetup || showWelcome;
  /**
   * NOTHING HERE IS READY TO TAKE AN ORDER, as one fact — a connection screen, the keyless rest, or
   * the manage card standing over the session. THE COMPOSER IS NOT DRAWN AT ALL IN ANY OF THE THREE.
   *
   * WHAT STANDS AT THE PANEL'S FOOT INSTEAD IS THE SCREEN'S OWN VERB: Connect on the keyless rest,
   * the step's Back/Try again/Done on the connection screen, Done on the manage card. Each of those
   * screens fills the job zone and pins its own foot to the bottom of it, so the bottom of the panel
   * is the one thing the surface is actually asking for.
   *
   * THE MANAGE CARD IS ONE OF THE THREE on the reading of the glass rather than of the wiring: an
   * order given from it would be a real order, but the card fills the zone with the connection being
   * edited and the provider and the model can both be mid-change under the pointer.
   *
   * IT IS ALSO WHAT THE PLATE'S HEIGHT ASKS: a screen with its own foot brings its own height, so the
   * panel hugs it rather than standing at the want a record's column is worth (`panelStyle`).
   */
  const notReady = formOwnsZone || managing;
  /**
   * WHICH STEP THE SETUP SCREEN IS ON, carried the one hop from the job zone to the desk.
   *
   * The dock says what the session is doing, and a session with no key is not doing anything the
   * projection can express — so the screen reports its own step and the card wears it. Without this
   * the dock said "Not connected / a key wakes me" over a confirmed provider and a chosen model, and
   * a refused key left the card calm while the note under the field carried the whole refusal.
   */
  const [setupFace, setSetupFace] = useState<SetupFace | null>(null);
  /**
   * The suggestion ghost the user has waved away, by its own text.
   *
   * IT IS THE PANEL'S OWN BUSINESS, like the banner's dismissal beside it: `view.suggestion` is a
   * PROJECTION off the log (the newest `suggest_reply` call), so there is nothing for a caller to
   * clear and nothing to append — a refusal is not a session fact. Without it Escape did nothing at
   * all, and the next EMPTY Enter then sent the very prediction that had just been refused, since an
   * empty submit falls through to the standing suggestion. A fresh order nulls the projection, which
   * is what lets this be keyed on the text rather than on an identity the projection does not carry.
   */
  const [droppedGhost, setDroppedGhost] = useState<string | null>(null);
  /**
   * The composer's field holds words.
   *
   * IT IS THE PANEL'S BUSINESS BECAUSE TWO ZONES SHARE ONE PRESS: typed words at a gate cancel the
   * call and become guidance, so the ask card's Approve steps down to a neutral fill while there is
   * a sentence to send. The composer reports the FACT and keeps the text, which is what keeps a
   * keystroke from re-rendering the record above it with a new string every time.
   */
  const [drafting, setDrafting] = useState(false);
  /**
   * WHETHER THE PAST-JOBS LIST STANDS OPEN, lifted here rather than left inside `HistoryStrip`.
   *
   * Opening a record REPLACES the strip in the tree (the `opened` branch below never mounts it), so
   * a flag the strip owned itself would forget it had been open the instant the press that opened
   * the record lands: Back puts the job zone back to the ordinary rest state with the list
   * collapsed again, costing a press per record read. This component is the one thing that survives
   * that swap, so it is where the fact has to live. `closeRecord` below is what forces it back open,
   * matching the artifact's own Back handler ("list reopened").
   */
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeRecord = onCloseRecord
    ? () => { setHistoryOpen(true); onCloseRecord(); }
    : undefined;

  // The window's box and the interface's scale, as one value: the cap is a css expression against
  // both, so either moving changes the panel's own height with no commit of its own behind it.
  const viewport = useViewportEpoch();

  /** A thoughts box stands open in the ticket, which stands the follow down (see `useFollowNewest`). */
  const [readingThoughts, setReadingThoughts] = useState(false);

  /**
   * WHICH ANSWERED-ASK DECKS STAND FANNED OPEN, by their first ask's gateId. VIEW STATE and nothing
   * else — the deck is a presentation of entries the log already holds — lifted here rather than
   * left inside `AskDeck` because the panel's height tween keys on the record's shape and a fold it
   * cannot see is a height jump. Boots collapsed (a fresh look at the record starts from the pile),
   * and the next order's record starts collapsed too.
   */
  const [openDecks, setOpenDecks] = useState<ReadonlySet<string>>(NO_DECKS);
  const currentOrderSeq = view.current?.orderSeq;
  useEffect(() => { setOpenDecks(NO_DECKS); }, [currentOrderSeq]);

  /**
   * THE COMPOSER'S SQUARE ASKS THE CARD'S OWN QUESTION.
   *
   * A stop is destructive — it ends the run and the record then offers to take its edits back — and
   * the take-back law binds every press that is, wherever it stands. A square that stopped outright
   * while the dock's stop asked first would be the same verb with two different safeties, the
   * quieter one on the control nearest the hand. So the square reports its press as this nonce and
   * `DeskHeader` raises ITS confirm, which keeps one question, one wording and one retract.
   */
  const [stopAsks, setStopAsks] = useState(0);

  /** The composer's own focus verb, for the terminal banner's "New order" — the one control that
   *  points at the field this component owns, so the press is answered here. */
  const focusComposer = useRef<(() => void) | null>(null);

  // `view` is the memoized projection, so a new object IS a change to what the record shows.
  // A form is read from the top down, and its first line is what scrolling to the foot would hide —
  // so neither the setup screen nor the manage card follows anything.
  // THE DECK IS PART OF THE SHAPE THE FOLLOW WATCHES: a fold changes the record the way a verdict
  // landing does, but through view state the projection cannot carry, so it is keyed here — a
  // reader pinned at the foot stays with the newest entry through a fan or a restack, and one
  // scrolled up is left exactly where they are (the follow stands down unstuck).
  useFollowNewest(
    jobZoneRef, view, `${viewport}|${[...openDecks].sort().join(',')}`,
    !formOwnsZone && !managing && !readingThoughts,
  );

  // The one pose the phase cannot express: a job finishing well leaves the session at `idle`, which
  // is also where it sits an hour later and where a restored log opens.
  const celebrate = useCelebrateEdge(view);

  const rolledBack = useMemo(() => rolledBackSeqs(view.jobs, undoDepth), [view.jobs, undoDepth]);
  // The dock's own clock, running only while a face is counting.
  const ticked = useSecondClock(TICKING.has(view.phase) && now === undefined);
  const clock = now ?? ticked;
  const incident = trouble(view);
  // A dismissed fault DEMOTES rather than leaving: the trouble stands either way, and `standing` is
  // which dress it wears. `showTrouble` is therefore "there is a fault to report at all".
  const showTrouble = incident !== null;
  const standingTrouble = incident !== null && incident.seq === dismissed;
  const route = composerRoute(view.phase);
  const isRunning = running ?? !AT_REST.has(view.phase);

  /**
   * A HELD JOB OFFERED BACK AS A CARD, in the two states where the panel is not standing INSIDE the
   * hold, or null.
   *
   *   restored + paused — the session was FOUND holding a job. Nobody in this page paused it, so the
   *     screen's news is "here is what was under way", not the live ticket of a run in progress.
   *   key-cleared       — the credential went away under a job that had already written to the map.
   *     The hold cannot be lifted from here at all, so the offer is BLOCKED: the reason line and the
   *     repair are the card, and no Resume is drawn.
   *
   * A JOB THE LOOP STILL HAS IS NOT AN OFFER, key or no key: it is running, its own live ticket is
   * the record, and a card asking whether to resume it would describe a state the session is not in.
   * The abort a revoke fires lands at the loop's next await, so that window is reachable.
   *
   * The `note` is read off the plan and only off the plan: how much of the work is already on the
   * map is a thing the panel can only say where the job filed stages to count.
   */
  const offered = keyCleared
    ? (AT_REST.has(view.phase) ? owedJob : undefined)
    : restored && view.phase === 'paused' ? view.current
      : undefined;
  const heldOffer = offered === undefined ? null : {
    job: offered,
    blocked: keyCleared,
    note: offered.plan && offered.plan.doneCount > 0
      ? t('agent3.ticket_stages_done', { n: offered.plan.doneCount, m: offered.plan.stages.length })
      : undefined,
  };

  /** A banner press, with the dismissal and the filing the panel answers ITSELF folded in before the
   *  rest travel to the caller (which owns the runner, the vault and the log). */
  const bannerAction = (action: BannerActionId): void => {
    // BOTH WAYS OF PUTTING A TROUBLE DOWN DEMOTE IT: dismissing says "I have read this", and
    // setting the job aside answers it by filing the record the fault is about.
    if (action === 'dismiss' || action === 'set-aside') setDismissed(incident?.seq ?? null);
    if (action === 'new-order') { focusComposer.current?.(); return; }
    // THE THREE CONNECTION REPAIRS OPEN THE SCREEN THIS FILE OWNS, each at its own step. `fix-key`
    // goes through the dock's own act, which is the one press that drops the refused key and lands
    // the caret in the field on the commit that brings the field with it.
    if (action === 'fix-key') { openKeyEntry(); onBannerAction?.(action); return; }
    if (action === 'change-provider' || action === 'edit-endpoint') {
      setSetupEntry(action === 'change-provider' ? 'chooser' : 'endpoint');
      setInSetup(true);
    }
    // THE MODEL IS THE SETTINGS CARD'S, not the connection screen's: setup files a default and never
    // asks, so the model row this press points at only exists behind the gear. The caller owns that
    // card's open state, so the press travels rather than being answered here.
    if (action === 'set-aside' && incident) onFileAway?.(incident.seq);
    onBannerAction?.(action);
  };

  /** What the composer says, and whether it is off, while a fault stands unrepaired. */
  const blockedComposer = keyCleared ? COMPOSER_BLOCKED['key-cleared']
    : incident && !standingTrouble ? COMPOSER_BLOCKED[incident.cls]
      : undefined;

  /** Put a HELD job away. A job still in the current seat has to be SETTLED first (`onSetAside`); a
   *  job that has already settled is simply filed. The test is the seat, not whether the offer is
   *  blocked: a key revoked while a job was paused reaches this blocked AND still in the seat, and
   *  filing it there would leave the session holding a hold with nothing showing it. */
  const setAside = heldOffer === null ? undefined
    : heldOffer.job === view.current
      ? (onSetAside ?? undefined)
      : (onFileAway ? (seq: number) => onFileAway(seq) : undefined);

  /**
   * THE GATE FAMILY'S CARDS, open and answered alike.
   *
   * AN ANSWERED ASK GOES ON STANDING. A gate is a line of the record rather than a modal, so the card
   * stays where it was with its verdict on it and the job's next ops arrive in the ticket above.
   *
   * AND A HELD ASK SHOWS NO CONTROLS, BUT IT DOES STAND. `view.gate` is the question that can still
   * BE answered — the projection publishes it only at `phase === 'gated'`, so a paused session
   * withholds it and `loop.ts:existingGateId` re-enters the same gate on resume. An ask that is
   * neither answered nor the published one is therefore being HELD: it keeps its card and its
   * summary and says it is held (`HeldNote`), rather than offering a button that would reach no
   * waiting loop (the reload-answered-into-the-void defect) OR rendering nothing at all, which left
   * a reload mid-approval with no trace that a question was waiting.
   *
   * WHICH MEMBER OF THE FAMILY A CARD IS, IS READ OFF WHAT THE ASK OFFERED. A plan scope is the plan
   * gate; an ask carrying OPTIONS is the pick; an ask carrying QUICK ANSWERS is a question, and its
   * answers plus the composer are the whole reply (there is no call to approve, which is why the
   * card drops the Approve/Don't pair — the same test the card itself makes); everything else is the
   * tool gate.
   */
  const asks = view.current?.asks ?? [];
  const cardFor = (ask: AskRecord): ReactNode => {
    const answerable = view.gate?.gateId === ask.gateId;
    const answer = (a: 'allow' | 'skip') => onGateAnswer(ask.gateId, a);
    const inWords = (words: string) => onGateAnswer(ask.gateId, 'words', words);
    if (ask.options) {
      const pick = optionAskFrom(ask, optionThumb ? (option) => optionThumb(option) : undefined);
      return pick ? (
        <OptionPick
          key={ask.gateId}
          ask={pick}
          answerable={answerable}
          onPick={(index) => { inWords(pick.cards[index]?.cap ?? ''); }}
          onDecline={() => answer('skip')}
        />
      ) : null;
    }
    if (ask.scope === 'plan') {
      return (
        <PlanGate
          key={ask.gateId}
          ask={ask}
          demoted={drafting}
          answerable={answerable}
          onAnswer={answer}
        />
      );
    }
    const thumb = gateThumb?.(ask);
    return (
      <GateBlock
        key={ask.gateId}
        ask={ask}
        {...(thumb !== undefined && thumb !== null ? { thumb } : {})}
        {...(ask.quickAnswers ? { quick: ask.quickAnswers, actions: false, onQuick: inWords } : {})}
        demoted={drafting}
        answerable={answerable}
        onAnswer={answer}
      />
    );
  };
  /**
   * THE ANSWERED ASKS STAND AS A DECK, and the grouping is PER RUN OF CONSECUTIVE
   * answered asks rather than per job: a deck stands exactly where its cards sat, so the record's
   * trail never has a card teleported past another entry. The two readings coincide in every state
   * the loop can reach — one gate is open at a time and a new ask always appends, so the answered
   * asks are one consecutive run ahead of (at most) the standing one — but the run form is the one
   * that stays honest if that ever changes. The STANDING ask never stacks: it needs attention, and
   * it keeps its full card after the pile.
   */
  const askCards = deckRuns(asks).map((run) => {
    if (!run.deck) return cardFor(run.ask);
    const deckId = run.asks[0]!.gateId;
    return (
      <AskDeck
        key={`deck-${deckId}`}
        asks={run.asks}
        open={openDecks.has(deckId)}
        onOpenChange={(next) => setOpenDecks((prev) => {
          const set = new Set(prev);
          if (next) set.add(deckId); else set.delete(deckId);
          return set;
        })}
      >
        {run.asks.map(cardFor)}
      </AskDeck>
    );
  });
  const hasAsk = askCards.some((card) => card !== null);

  /**
   * THE HOLD'S CONTROLS BELONG AFTER THE CARD THAT PRODUCED IT (the artifact's own `tact` block).
   *
   * A pause taken at a plain step boundary has nothing between the ticket and its answer, so Resume
   * and Stop sit at the ticket's own foot where the work stopped. A hold that a SKIPPED gate
   * produced does: the answered ask stands under the ticket wearing its verdict, and leaving the
   * verbs at the foot above it would offer the answer before the question. The row moves below.
   */
  const holdAfterAsk = ON_HOLD.has(view.phase) && hasAsk && heldOffer === null;

  /**
   * A PAST RECORD OPENED IS A STATE, not a card added to the record: it covers the job zone, the
   * strip and the standing receipt included, and the dock says what the panel is doing. `openRecord`
   * naming a job that is no longer in the view (it was cleared, the session was replaced) resolves
   * to nothing, which is the same state as never having opened one.
   */
  const opened = openRecord === null || view.current
    ? undefined
    : view.jobs.find((job) => job.orderSeq === openRecord);

  /** The settled record standing as a card, and which card that is. */
  const settled = opened ? null : terminal(view, filed, heldOffer?.job);
  /**
   * THE PAST JOBS ARE THE ONES THAT ARE PAST. A record standing as a card in the zone is what the
   * desk is talking about right now, so listing it in the fold above as well says one job twice; the
   * artifact's own settle pushes the history row as the card LEAVES. Filing it, or the next order,
   * is what moves it into the list.
   *
   * A CLEARED RECORD IS IN NEITHER PLACE. Clearing files it too, so it already has no card; dropping
   * it here is what makes the removal a removal rather than a card becoming a row.
   *
   * AND NEITHER IS THE JOB BEING OFFERED BACK. A key-cleared job has SETTLED (its incident ended it)
   * while its card is the screen's whole news, so without this it stood as the blocked offer and as
   * a past-jobs row at once — one job, said twice, one of them claiming it is over.
   */
  const past = view.jobs.filter((job) => (
    job !== settled?.job && job !== heldOffer?.job && !cleared.has(job.orderSeq)
  ));

  /**
   * WHY THE SETTLED CARD'S OWN TAKE-BACK IS REFUSED, or undefined where it is not.
   *
   * THE RECEIPT READS THE SAME GUARD THE ROWS DO. An undo pops the OPEN map's stack whatever record
   * asked for it, and the standing card is the most reachable ask of the lot: a session is not
   * cleared by a map change, so a job run on map A leaves its receipt standing over map B with a
   * live Rewind aimed at B's undo stack. Refused the way the rows refuse it — the control ABSENT
   * (a control that refuses must not answer the pointer) with the notice below saying why.
   */
  const settledBlocked = settled && (otherMap?.has(settled.job.orderSeq) === true
    ? 'other-map'
    : unknownMap?.has(settled.job.orderSeq) === true ? 'unknown-map' : undefined);

  /**
   * THE STANDING NOTICE, or none. It reads over whatever the record is SHOWING — the list and the
   * settled card alike, since a session whose one record is the card in front of the user would
   * otherwise get the refusal with nothing to explain it. It says the SHARPER of the two facts where
   * both are present: a record proven to be another map's is a stronger thing to report than one
   * that merely says nothing.
   */
  const noticed = settled ? [...past, settled.job] : past;
  const noticeCls: BannerClass | null = !formOwnsZone && !managing && !opened
    ? noticed.some((job) => otherMap?.has(job.orderSeq) === true) ? 'other-map'
      : noticed.some((job) => unknownMap?.has(job.orderSeq) === true) ? 'unknown-map'
        : null
    : null;

  /**
   * THE STORAGE NOTICE, which is the one banner that is not about a job at all.
   *
   * It stands above the record wherever the record stands, because it is true of the whole session:
   * a run under way is unaffected by a save that failed, and the user's answer to it is the same
   * either way. `lost`/`pruned` stay MOUNTED once answered (the store only clears them itself, on
   * the next clean save) and wear the same standing dress the incident banner does; `corrupt` still
   * unmounts through the store, since Discard is answered by the bytes actually going.
   */
  const storageCls: BannerClass | null = formOwnsZone || managing || opened || storageNotice == null
    ? null
    : storageNotice === 'corrupt' ? 'storage-corrupt'
      : storageNotice === 'lost' ? 'storage-full' : 'storage-pruned';
  const standingStorage = (storageNotice === 'lost' || storageNotice === 'pruned')
    && dismissedStorage === storageNotice;

  /**
   * THE FLOOR IS WAIVED FOR ONE SHAPE: a rest state whose whole record is the closed past-jobs row.
   * The row is 40px, the floor is 72, and the difference showed as a dead strip under it — the
   * artifact waives it by exactly this test (`.zJob:has(> .dd:only-child)`, its dropdown card being
   * in the float layer rather than in the zone).
   *
   * A STANDING TERMINAL CARD IS NOT THAT SHAPE, so the waiver waits for the record to be FILED,
   * which is the same state the artifact waives it in.
   */
  /**
   * AN IDLE REST WEARS THE SKETCH CARD, and every idle rest but one.
   *
   * A rest is a panel with nothing standing and nothing owed: no job in flight, no settled record
   * waiting to be read, no question, no incident, and no screen over the zone. The state's own NEWS
   * (a past-jobs row, an other-map banner) keeps the first word and the card stands LAST, nearest
   * the composer — so the composer-adjacent region reads the same in every rest that carries it.
   *
   * The resume offer is the one rest without it, and it is excluded here BY CONSTRUCTION rather than
   * by name: it stands on a job the session is still holding, so `view.current` is set.
   */
  const dressed = sketchbook !== undefined && !formOwnsZone && !managing && !opened
    && !view.current && !settled && !hasAsk && !showTrouble
    // AND NOTHING COMPETES WITH A STANDING WARNING: the corrupt notice and its two verbs are the
    // whole content of that state, so the rest's own dressing waits until it has been answered.
    && storageCls !== 'storage-corrupt';

  const rowOnly = !formOwnsZone && !managing && !view.current && !hasAsk && !showTrouble
    && !settled && !opened && noticeCls === null && past.length > 0 && !dressed;

  /** THE MARKING STATE HAS NO RECORD AT ALL, so the floor has nothing to hold up: the zone is
   *  empty and the 72px would stand as a blank band between the desk and the composer. */
  const zoneEmpty = rowOnly || marking;

  /**
   * The shade may only cover what SCROLLS AWAY, which `scroll-fade` derives from the live scroll
   * geometry on scroll, resize and mutation. That is also what survives the panel's own height
   * tween: the tween changes the zone's box every frame, so a reading taken mid-tween is re-measured
   * on the next one instead of latching a fade over a record that is all showing.
   *
   * AND IT STARTS UNDER THE STICKY ORDER LINE, not at the zone's top edge (`stickyBand`): a running
   * ticket parks its order on its own opaque backing while the rest of it scrolls beneath, so the
   * band the line occupies is standing still. A shade over it dimmed the one line meant to stay
   * readable and spent its whole ramp above the place content actually disappears.
   */
  const fade = useScrollFade(jobZoneRef, 'y', { offsetAt: stickyBand });

  // What can change the panel's HEIGHT without the record itself growing: the setup screen swapping
  // in, a banner landing, a gate opening, a note queueing. The view's own identity carries the rest.
  // THE CAP IS PART OF THE SHAPE: the largest height change the app makes is a MODE SWITCH, which
  // moves the room the frame has for the panel (367 to 159 own px, measured) and nothing inside it.
  // An ask SETTLING changes the card's own height (its buttons leave, a chip lands), so the asks
  // enter the key by verdict rather than by count.
  // A deck fanning open or restacking moves the record's height the same way a verdict landing
  // does, so the fanned set is part of the shape the height tween watches.
  const askShape = `${asks.map((ask) => `${ask.gateId}${ask.verdict ?? ''}`).join('|')}~${[...openDecks].sort().join(',')}`;
  const shape = `${maxHeight ?? ''}:${String(showSetup)}:${String(showWelcome)}:${setupFace?.step ?? ''}:${String(managing)}:${showTrouble}:${askShape}:${view.queuedSteers.length}:${String(zoneEmpty)}:${settled?.job.orderSeq ?? ''}:${opened?.orderSeq ?? ''}:${String(marking)}:${String(dressed)}`;
  // A DOCKED PLATE HAS NO HEIGHT TO TWEEN: its height is the WINDOW rather than its content, so there
  // is no change of shape for a tween to carry. Left running, the plate was still growing from the
  // floating panel's height while the sheet slid off it, and the strip of ground it had not reached
  // yet showed the page through the bottom of the window.
  useHeightTween(rootRef, `${shape}|${String(view.jobs.length)}|${view.phase}`, reduced || pinned, viewport);

  // THE CARRIAGE IS HANDED TO THE CHARACTER'S HOST, which is where the gesture is driven: the whole
  // floating form travels as one box, so the knob on its corner and the character at its desk cannot be
  // anywhere but where the panel is (`character/seat.ts:placeCarried`).
  useEffect(() => {
    setPanelCarriage(plateRef.current);
    return () => setPanelCarriage(null);
  }, []);

  /**
   * ESCAPE PEELS ONE LAYER PER PRESS, and this is its last rung: an open menu goes first (`FloatMenu`
   * catches the key at the window in capture and stops it there, so this never sees it), the
   * composer's ghost and then its own field second (it stops the press when it consumes one), and a
   * BARE panel folds.
   *
   * Bound to the panel rather than to the window, which is what makes the press AIMED. Escape at the
   * map means "put down whatever I am holding" (`kit/commands.ts`), and a panel that folded on that
   * one would be answering a key pressed somewhere else. Consumed here on the way out, so the same
   * press cannot also disarm a brush.
   */
  const escapeFolds = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    // MARKING IS A LAYER, SO IT PEELS FIRST: the map is holding the pencil, and a press that folded
    // the panel instead would leave the brush armed with the surface that armed it gone.
    if (marking && onMarkRegion) {
      e.stopPropagation();
      onMarkRegion();
      return;
    }
    if (!onCollapse) return;
    e.stopPropagation();
    onCollapse();
  };

  /**
   * THE REGION ATTACHMENT'S TWO NODES, built here because the SEATING is layout (the well's leading
   * token, the send cluster) while the picture inside them is the caller's.
   *
   * THE CHIP STANDS ONLY WHERE THE FIELD IS LIVE, and not during the marking itself.
   *
   * Three reasons, and the last one is measured. The chip is the COMPOSER's context token, and while
   * the map holds the pencil there is no composer; both its verbs are redundant there (its body
   * re-opens the marking that is already open, and its cross would destroy the stroke the hand is
   * mid-way through making); and the field it docks beside is ~60px narrower for it, which clips
   * the one placeholder that has no shorter form to swap to. The desk carries the confirmation
   * instead: its sub-line moves to "the paint is down" the moment a stroke lands.
   *
   * Behind any NOT-READY face it goes for a plainer reason: the composer has nowhere to send
   * anything there, and the chip's verbs point at a map the user is not being asked about.
   */
  const regionButton = onMarkRegion
    ? <RegionButton bounds={region} marking={marking} onPress={onMarkRegion} />
    : null;
  const regionChip = region && !notReady && !marking && onMarkRegion && onClearRegion
    ? (
      <RegionChip
        bounds={region}
        {...(regionShot ? { vignette: regionShot(region, CHIP_VIGNETTE.width, CHIP_VIGNETTE.height) } : {})}
        onMark={onMarkRegion}
        onClear={onClearRegion}
      />
    )
    : null;

  const keyField = () => rootRef.current?.querySelector<HTMLElement>('[data-testid="setup-key-input"]');

  /**
   * ONE PRESS, ONE FIELD. "Enter a key" over a panel that HOLDS one has two halves — the caller drops
   * the key, which is what mounts the setup screen, and the caret then goes in the field — and the
   * second half cannot run in the same commit as the first, because the field is not in the tree yet
   * (focus aimed there in that commit lands on `BODY`). The press is remembered and answered on the
   * commit that brings the field with it.
   */
  const [wantKeyField, setWantKeyField] = useState(false);
  /** Which step the connection screen opens on, when a repair pill is what opened it. It KEYS the
   *  screen below, so a pill pressed while the form already stands re-opens it at the step the pill
   *  names rather than leaving the user on the one they were on. */
  const [setupEntry, setSetupEntry] = useState<SetupEntry>('key');
  askedForField.current = wantKeyField;
  useEffect(() => {
    if (!wantKeyField || !showSetup) return;
    keyField()?.focus();
    setWantKeyField(false);
  }, [wantKeyField, showSetup]);

  // "Shorten the order" points at the composer, which is this file's own child: the act is answered
  // by putting the caret where the shorter order goes. Queried off the panel root rather than held as
  // a second ref, so the composer keeps its own field private.
  /**
   * OPEN THE CONNECTION SCREEN AT THE KEY FIELD, in one press. Returns whether the CALLER still owes
   * the other half — dropping the key it holds, which is what mounts the screen at all.
   *
   * Shared by the dock's "Enter a key" act and the banner's "Fix key" pill, which are one move said
   * from two places: over a panel with no key the screen is already standing (or is one `setInSetup`
   * away) and the caret goes straight in, and over a panel that HOLDS one the field is not in the
   * tree yet, so the press is remembered and answered on the commit that brings it.
   */
  function openKeyEntry(): boolean {
    setSetupEntry('key');
    if (showSetup) { keyField()?.focus(); return false; }
    setWantKeyField(true);
    // Over the KEYLESS rest the act is the Connect verb said from elsewhere: the form is what it
    // points at, and there is no key for a caller to drop first.
    if (showWelcome || !connected) { setInSetup(true); return false; }
    return true;
  }

  const dockAct = (act: DockActId) => {
    if (act === 'fix-key') {
      if (openKeyEntry()) onDockAct?.(act);
      return;
    }
    // THE ADDRESS IS THIS FILE'S OWN SCREEN, the same door the banner's pill opens: the connection
    // screen at its endpoint step, over whatever the panel was showing.
    if (act === 'edit-endpoint') { setSetupEntry('endpoint'); setInSetup(true); return; }
    if (act === 'edit-model') { onDockAct?.(act); return; }
    if (act !== 'new-order') { onDockAct?.(act); return; }
    rootRef.current
      ?.querySelector<HTMLElement>('[data-testid="composer"] input, [data-testid="composer"] textarea')
      ?.focus();
  };

  /**
   * THE DOCK CONTROLS ARE THE PANEL'S OWN CHROME, and they cost the panel's content no layout at all:
   * the card is the same card at the same width in both modes and the desk row is the same
   * three-column desk it is with no dock in the app. What they change is the shape of the PANEL, which
   * is why they are not on the card — the card is the session's own face.
   *
   * FREE, THE CONTROL IS A DISC ON THE PLATE'S TOP-RIGHT CORNER (`atoms.tsx:PIN_KNOB`, which carries
   * why that corner and why its top is the plate's own top edge). It floats: half of it over the map,
   * half on the paper, and the half on the paper reaches no further in than the plate's own padding.
   *
   * DOCKED, THEY ARE A FILE OF TWO AT THE RIGHT, IN BOTH DOCK MODES — same spot whether the panel
   * hugs the left or the right window edge, so the hand that docks at one side is not hunting for the
   * pair at the other. The dock/undock and the side switch, in that order, because the first is what
   * the second is about. THE PAIR IS CENTRED ON THE DOCK BAND — the card beside it is `DOCK_HEIGHT`
   * tall and starts at the plate's padding, so the file's own height is centred in that, and the two
   * controls read as belonging to the row they stand in rather than as hanging from the plate's
   * corner. Their seat is the desk band's alone (`desk-band`): below the band the content takes the
   * gutter's width.
   */
  const pinLabel = t(pinBlocked ? 'agent3.pin_no_room' : pinned ? 'agent3.pin_undock' : 'agent3.pin_dock');
  const controls = onTogglePin ? (
    <motion.div
      data-testid="desk-pin"
      style={pinned
        ? {
          position: 'absolute',
          top: PANEL_PAD + (DOCK_HEIGHT - DOCK_CHROME_FILE_H) / 2,
          right: PANEL_PAD,
          display: 'flex', flexDirection: 'column', gap: DOCK_CHROME.stack, zIndex: 1,
        }
        : {
          position: 'absolute', top: PANEL_RADIUS, right: -PIN_KNOB_OUT,
          display: 'flex', zIndex: 1,
          // THE KNOB RIDES THE WIPE: the disc is carried on the plate's own clip value (`knobCarry`),
          // since it stands outside the clip that folds the plate's paint away.
          x: knobX, y: knobY, scale: knobScale,
        }}
    >
      {pinned ? (
        <>
          <IconButton
            testId="dock-pin"
            icon={dockSide === 'left' ? 'pw-dock-left' : 'pw-dock-right'}
            label={pinLabel}
            data-act="pin"
            lit
            onClick={onTogglePin}
          />
          {onSwitchSide ? (
            <IconButton
              testId="dock-switch"
              // The glyph shows where the press PUTS the dock, which is the end it is not at.
              icon={dockSide === 'left' ? 'pw-dock-right' : 'pw-dock-left'}
              label={t(dockSide === 'left' ? 'agent3.dock_switch_right' : 'agent3.dock_switch_left')}
              data-act="dock-side"
              onClick={onSwitchSide}
            />
          ) : null}
        </>
      ) : (
        <PinKnob
          testId="dock-pin"
          icon={dockSide === 'left' ? 'pw-dock-left' : 'pw-dock-right'}
          label={pinLabel}
          data-act="pin"
          disabled={pinBlocked}
          onClick={onTogglePin}
        />
      )}
    </motion.div>
  ) : null;

  return (
    // THE CARRIAGE: the plate, the knob on its corner and the character standing at its desk are ONE
    // OBJECT, and this bare wrapper is what makes that true rather than asserted. The plate CLIPS (its
    // own overflow, and the wipe's clip-path), so the knob has to stand outside it; the whole gesture's
    // travel is written HERE, once, and the character is placed at her seat plus the same remainder in
    // the same tick (`character/seat.ts:placeCarried`), so nothing in the form can drift against the
    // rest of it. The plate keeps the height tween and the box.
    <motion.div
      ref={plateRef}
      // THE COVERED BEAT LANDS WITH THE COMMIT. Framer applies even an instant transition on its own
      // next frame, while the swap from docked to free geometry is React's — so for exactly that frame
      // the free plate stood whole and opaque wearing the ground's values, painted over the sheet that
      // is covering the window (measured on the too-narrow auto-undock: a 60ms flash under a busy
      // resize). `visibility` is inline and discrete, so it hides in the same paint as the geometry.
      style={away === 'folded' ? { ...PLATE_HOLDER, visibility: 'hidden' } : PLATE_HOLDER}
      variants={panelVariants}
      // A DOCKED PLATE IS REVEALED, NOT ARRIVED. Its entrance is the sheet of interface sliding off
      // it, which is a motion the plate takes no part in, so it takes none of its own.
      initial={reduced || pinned ? false : 'hidden'}
      // AWAY IS FOLDED, NOT ABSENT, and that is what gives a dock change two honest ends. The panel is
      // ONE element in both forms — React reuses the node, so an unmount here would be an exit the
      // returning form cancels rather than plays, and the floating panel came back standing whole. So
      // the beat in the middle of a dock change is a STATE: folded onto her button, invisible, under a
      // sheet that is covering all of it, and the arrival that follows is the ordinary entrance.
      animate={away ? 'hidden' : pinned ? 'ground' : 'shown'}
      exit="gone"
      transition={pinned || away === 'folded'
        ? REVEALED
        : framerMotion(away === 'leaving' ? 'panel.close' : 'panel.open')}
    >
      <motion.section
        ref={rootRef}
        data-testid="panel-shell"
        variants={plateVariants}
        // The state name comes down from the holder; the CLOCK does not — a `transition` is not
        // inherited — so the same choice is named here, or the revealed plate un-wipes over the slide.
        transition={pinned || away === 'folded'
          ? REVEALED
          : framerMotion(away === 'leaving' ? 'panel.close' : 'panel.open')}
        // The clip is the OWNED value the variants animate, so the knob's carry derives from the same
        // driver the plate paints with.
        style={{
          ...(pinned ? dockedStyle(maxHeight, dockSide) : panelStyle(maxHeight, notReady)),
          clipPath: wipe,
        }}
        onKeyDown={escapeFolds}
      >
        {/* Every glyph under this column is a `<use>` of a symbol in ONE sprite, and this is where that
            sprite is mounted: the panel is its only consumer, and a second copy in the document would
            be a second definition of every id. Hidden, which a `<use>` still resolves. */}
        <IconSprite />

        {pinned ? controls : null}

        {/* THE BUTTONS' SEAT IS THE DESK BAND'S ALONE: docked, the band ends where the file of two
            begins, and everything below it takes the gutter's width. Free the pad is written as 0,
            not removed, so no mode leaves the other's edge behind. */}
        <div
          data-testid="desk-band"
          style={{
            flex: '0 0 auto', display: 'flex', flexDirection: 'column',
            paddingRight: pinned ? DOCK_CHROME_W : 0,
          }}
        >
          <DeskHeader
            view={view}
            // A DESK WITH THE SETUP SCREEN UNDER IT IS A DESK WITH NO CONNECTION TO REPORT, key filed or
            // not: the gear's own surface is what the zone is showing, so the card stands gearless and
            // says the keyless sentence until setup says it is done.
            connected={connected && !showSetup}
            {...(celebrate ? { pose: celebrate } : {})}
            {...(mapName !== undefined ? { mapName } : {})}
            {...(providerName !== undefined ? { providerName } : {})}
            {...(modelName !== undefined ? { modelName } : {})}
            now={clock}
            onPause={onPause}
            onStop={onStop}
            askStop={stopAsks}
            onResume={() => onResume?.()}
            onDockAct={dockAct}
            {...(onRetryNow ? { onRetryNow } : {})}
            {...(onManage ? { onManage } : {})}
            managing={managing}
            {...(connectionMeta !== undefined ? { connectionMeta } : {})}
            {...(opened ? { readingRecord: recordStamp?.(opened) ?? '' } : {})}
            // A LIVE lane means a delegate is working, which is not in the projection and so cannot
            // reach the dock any other way.
            helper={lane !== undefined && lane.done !== true}
            setupFace={showSetup ? setupFace : null}
            {...(marking ? { marking: region ? 'painted' as const : 'blank' as const } : {})}
            {...(gateCells !== undefined ? { gateCells } : {})}
            recordFiled={settled === null && opened === undefined && view.phase === 'idle'}
            heldOffer={heldOffer !== null && !keyCleared}
            storageSetAside={storageNotice === 'corrupt'}
            unsaved={storageNotice === 'lost'}
            {...(hosted
              // THE DESK'S SEAT, EMPTY, handed to the one live character standing outside this tree: she
              // is placed `fixed` from its measured rect, so what the desk owes her is a box in the right
              // place rather than a mount. The ref goes null with the panel, which is what walks her back
              // to the block she was pressed in.
              ? { characterSlot: <div ref={setDeskSeat} style={{ position: 'absolute', inset: 0 }} /> }
              : {})}
          />
        </div>

        <div
          ref={jobZoneRef}
          data-testid="panel-job-zone"
          style={{ ...JOB_ZONE_STYLE, minHeight: jobZoneFloor(maxHeight, zoneEmpty), ...fade }}
        >
          {marking ? null : showSetup ? (
            <SetupScreen
              key={setupEntry}
              entry={setupEntry}
              onDone={() => { setInSetup(false); onSetupDone?.(); }}
              onFace={setSetupFace}
              // THE MODEL IS CHOSEN ON THE MANAGE CARD AND NOWHERE ELSE, so a connection whose endpoint
              // named no model is handed there rather than left saying so. The form steps aside for it:
              // the card stands in the same zone, and Done brings the connection screen back if the
              // model is still missing.
              {...(onManage ? { onManage: () => { setInSetup(false); onManage(); } } : {})}
              // BACK RETURNS TO THE REST THE FORM WAS WALKED INTO FROM: the keyless office with no
              // credential held, the connected idle with one. The panel stays standing — a step back
              // is not the panel being put away, and putting it away is the character's own press.
              onLeave={() => setInSetup(false)}
            />
          ) : showWelcome ? (
            <DreamOffice
              // The prototype's own Connect handler: the press lands on her (one squash), and she
              // rises out of the sleeping rest as the key screen does — both the character's own
              // verbs, which gate themselves (asleep only, reduced motion skips).
              onConnect={() => {
                const hero = getCharacterHandle();
                hero?.acknowledge();
                hero?.wake();
                setInSetup(true);
              }}
              pinned={pinned}
            />
          ) : managing ? (
            <ManageScreen
              // WHAT THE PRESS WOULD CLEAR, which is not how many records the session holds: clearing
              // is a MARK (`store.clearRecord`), and this component already filters those out of the
              // list. Counting the jobs themselves left "Clear jobs (3)" standing over an emptied
              // history with the `disabled={jobCount === 0}` guard never firing and the press
              // answering with silence.
              jobCount={jobCount ?? view.jobs.filter((job) => !cleared.has(job.orderSeq)).length}
              stoppable={isRunning || view.phase === 'retrying' || view.phase === 'gated'}
              parkable={view.phase === 'retrying'}
              {...(onManageDone ? { onDone: onManageDone } : {})}
              {...(onClearJobs ? { onClearJobs } : {})}
              onStopJob={onStop}
              onSetAside={onPause}
              {...(liveConnection ? { liveConnection } : {})}
            />
          ) : opened ? (
            /* THE OPENED RECORD COVERS THE ZONE. It is what the panel is showing, so the strip it was
               opened from and the newest receipt both stand down; Back puts them back. A record whose
               product was WORDS reopens as the paper it was, with the same archive foot. */
            isAnswerJob(opened) ? (
              <AnswerPaper
                job={opened}
                past
                {...(closeRecord ? { onBack: closeRecord } : {})}
                {...(onClearRecord ? { onClear: onClearRecord } : {})}
              />
            ) : (
              <ArchiveCard
                job={opened}
                rolledBack={rolledBack.has(opened.orderSeq)}
                {...(recordStamp ? { stamp: recordStamp(opened) } : {})}
                {...(closeRecord ? { onBack: closeRecord } : {})}
                {...(onClearRecord ? { onClear: onClearRecord } : {})}
              />
            )
          ) : (
            <>
              {storageCls && (
                /* THE CORRUPT NOTICE HAS TWO DIFFERENT ANSWERS and they must not collapse into one:
                   Discard lets the set-aside bytes go (the store's own verb), while Export writes them
                   out for a bug report and leaves the notice exactly where it was. `lost`/`pruned`
                   have one answer, and it demotes rather than dropping the store's own fact. */
                <Banner
                  cls={storageCls}
                  standing={standingStorage}
                  onAction={(action) => {
                    if (action === 'dismiss') {
                      if (storageCls === 'storage-corrupt') onDismissStorage?.();
                      else if (storageNotice === 'lost' || storageNotice === 'pruned') setDismissedStorage(storageNotice);
                    } else onBannerAction?.(action);
                  }}
                />
              )}
              {noticeCls && (
                <Banner cls={noticeCls} onAction={() => { /* dismiss is the notice's own, and the
                  notice is a standing fact rather than an event: it comes back with the list. */ }} />
              )}
              {/* THE KEY-CLEARED NOTICE STANDS WITH ITS CARD, above rather than below: the banner says
                  what happened and the blocked offer under it says what the job is now waiting for, so
                  the two are one statement read top-down. Every other fault's banner is the record's
                  newest news and stands at its foot. */}
              {keyCleared && (
                <Banner
                  cls={AT_REST.has(view.phase) ? 'key-cleared' : 'key-clearing'}
                  standing={standingTrouble}
                  onAction={bannerAction}
                />
              )}
              {heldOffer && (
                <ResumeCard
                  order={heldOffer.job.orderText}
                  pausemark={pausedWhere(heldOffer.job, t)}
                  {...(heldOffer.note ? { note: heldOffer.note } : {})}
                  {...(heldOffer.blocked ? { blocked: t('agent3.ticket_key_returns') } : {})}
                  {...(heldOffer.blocked
                    ? { onFixKey: () => bannerAction('fix-key') }
                    : onResume ? { onResume } : {})}
                  {...(setAside ? { onSetAside: () => setAside(heldOffer.job.orderSeq) } : {})}
                />
              )}
              <HistoryStrip
                jobs={past}
                rolledBack={rolledBack}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                {...(otherMap ? { otherMap } : {})}
                {...(unknownMap ? { unknownMap } : {})}
                {...(undoDepth !== undefined ? { undoDepth } : {})}
                busy={isRunning}
                {...(onOpenTicket ? { onOpen: onOpenTicket } : {})}
                {...(onRollBack ? { onRollBack } : {})}
              />
              {/* THE LIVE TICKET, unless the hold is being OFFERED rather than stood in: the offer
                  card takes its place, and the two together would be one job said twice. */}
              {view.current && !heldOffer && (
                <JobTicket
                  job={view.current}
                  live
                  held={HELD.has(view.phase)}
                  streaming={view.current.saysStreaming === true}
                  thinking={view.phase === 'thinking'}
                  paused={ON_HOLD.has(view.phase)}
                  {...(lane ? { lane } : {})}
                  {...(view.current.region && regionShot
                    ? { regionVignette: regionShot(view.current.region, TICKET_VIGNETTE.width, TICKET_VIGNETTE.height) }
                    : {})}
                  busy={isRunning}
                  {...(onRewind ? { onRewind } : {})}
                  // THE HOLD'S VERBS STAND AFTER THE CARD THAT PRODUCED THE HOLD. With an ask between
                  // the ticket and the answer (a skip the loop held on), the ticket's own foot would
                  // put Resume ABOVE the question it answers, so the row moves below the cards.
                  {...(onResume && !holdAfterAsk ? { onResume } : {})}
                  {...(holdAfterAsk ? {} : { onStop })}
                  onThoughtsOpenChange={setReadingThoughts}
                />
              )}
              {/* THE SETTLED RECORD, in whichever grammar the job earned: a build gets the receipt
                  (done, at the cap, or compressed to a settle under a standing question), a stopped
                  job gets the stop card, and a job whose product was words gets the answer paper. */}
              {settled?.shape === 'paper' && (
                <AnswerPaper
                  key={settled.job.orderSeq}
                  job={settled.job}
                  {...(onFileAway ? { onFileAway } : {})}
                />
              )}
              {settled?.shape === 'stop' && (
                <StopCard
                  /* KEYED BY RECORD, so the next job's card is a NEW card. Without it React reuses the
                     instance and its own state travels: a rewind confirm left standing on one receipt
                     came back open over the next one, aimed at a job the user never asked about. */
                  key={settled.job.orderSeq}
                  job={settled.job}
                  rolledBack={rolledBack.has(settled.job.orderSeq)}
                  {...(undoDepth !== undefined ? { undoDepth } : {})}
                  // A key revoked mid-ask, a stop landing on a standing question: the ask goes with
                  // the job, and this is where the record of it survives.
                  unanswered={settled.job.asks.some((ask) => ask.verdict === 'unanswered')}
                  {...(clockOf(view, settled.job) !== null ? { clock: clockOf(view, settled.job)! } : {})}
                  {...(onRewindAll && !settledBlocked ? { onRewindAll: () => onRewindAll(settled.job) } : {})}
                  {...(onFileAway ? { onFileAway } : {})}
                />
              )}
              {/* AND THE ORDER THE TROUBLE IS ABOUT, standing under its own banner. It carries no
                  verbs: the banner below holds the repair and the way to put the job away. */}
              {settled?.shape === 'stalled' && (
                <IncidentCard
                  key={settled.job.orderSeq}
                  job={settled.job}
                  stamps={jobStamps(settled.job, t)}
                />
              )}
              {settled?.shape === 'receipt' && (
                <FlipTicket
                  key={settled.job.orderSeq}
                  job={settled.job}
                  compact={settled.job.question === true}
                  rolledBack={rolledBack.has(settled.job.orderSeq)}
                  {...(undoDepth !== undefined ? { undoDepth } : {})}
                  {...(recordShot && settled.job.question !== true ? { postcard: recordShot(settled.job) } : {})}
                  {...(recordStamp ? { archiveStamp: recordStamp(settled.job) } : {})}
                  {...(onRewind && !settledBlocked ? { onRewind } : {})}
                  {...(onRewindAll && !settledBlocked ? { onRewindAll: () => onRewindAll(settled.job) } : {})}
                  {...(onKeepGoing ? { onKeepGoing: () => onKeepGoing(settled.job) } : {})}
                  // A STANDING QUESTION FILES ITSELF: answering it, or the next order, is what puts
                  // the record away, so the compact settle offers no File it away of its own.
                  {...(onFileAway && settled.job.question !== true ? { onFileAway } : {})}
                />
              )}
              {askCards}
              {holdAfterAsk && (onResume !== undefined || onStop !== undefined) && (
                <div data-testid="hold-actions" style={HOLD_ACTIONS_STYLE}>
                  {onResume !== undefined && (
                    <button
                      type="button"
                      data-testid="hold-resume"
                      onClick={onResume}
                      style={RESUME_PRIMARY}
                    >
                      {t('agent3.action_resume')}
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="hold-stop"
                    onClick={onStop}
                    style={{ ...windowPill('danger', false, 'plate'), boxShadow: 'none' }}
                  >
                    {t('agent3.action_stop')}
                  </button>
                </div>
              )}
              {showTrouble && !keyCleared && (
                <Banner
                  cls={incident.cls}
                  {...(modelName !== undefined ? { model: modelName } : {})}
                  standing={standingTrouble}
                  onAction={bannerAction}
                />
              )}
              {/* LAST, nearest the composer: whatever the rest's own news is, the region under the
                  user's hand reads the same. Docked, the zone is the window tall, so "nearest" has to
                  be enforced: the seat takes the zone's slack ABOVE it (`margin-top: auto`, which a
                  zone that scrolls resolves to 0 by itself). Free the plate hugs its content, so the
                  margin is written as 0 and the card simply stands last. */}
              {dressed && (
                <div
                  data-testid="sketch-seat"
                  style={{
                    flex: '0 0 auto', display: 'flex', flexDirection: 'column',
                    marginTop: pinned ? 'auto' : 0,
                  }}
                >
                  {sketchbook}
                </div>
              )}
            </>
          )}
        </div>

        {/* THE QUEUE, and every note in it (`SteerQueue`). The zone stands whether or not one is
            queued: a row that appeared here would shorten the record under the pointer reading it. */}
        <SteerQueue steers={view.queuedSteers} {...(onRecallSteer ? { onRecall: onRecallSteer } : {})} />

        {/* NOT WHILE A SCREEN OWNS THE ZONE (`notReady`): the composer is absent, and the screen's
            own action row is what stands at the panel's foot. */}
        {notReady ? null : (
        <Composer
          route={route}
          running={isRunning}
          marking={marking}
          {...(regionButton ? { regionButton } : {})}
          {...(regionChip ? { regionChip } : {})}
          // A settled job's standing QUESTION: the field is where the answer goes, and the one card
          // whose whole purpose is a question offers no other way to give one.
          answering={settled?.job.question === true}
          // THE ONE INSTRUCTION AN UNREPAIRED FAULT LEAVES, and only while the notice is still LOUD:
          // demoting it is the user saying they have read it, and a composer that stayed off after
          // that would be a fault with no way past it. A key that is actually gone is not dismissible,
          // so that one holds whatever the banner is wearing.
          {...(blockedComposer ? { blocked: blockedComposer } : {})}
          suggestion={view.suggestion === droppedGhost ? null : view.suggestion}
          onSend={onSend}
          // The square asks before it stops, and it asks on the card (see `stopAsks`).
          onStop={() => setStopAsks((n) => n + 1)}
          {...(onResume ? { onResume } : {})}
          onDropSuggestion={() => {
            setDroppedGhost(view.suggestion);
            onDropSuggestion?.();
          }}
          onDraftChange={setDrafting}
          {...(fill ? { fill } : {})}
          focusRef={focusComposer}
        />
        )}
      </motion.section>
      {/* AFTER the plate in paint order, since the tab overlaps it: the part inside the padding covers
          the plate's own outline, which is what makes the two read as one sheet. */}
      {pinned ? null : controls}
    </motion.div>
  );
}
