/**
 * A finger's horizontal swipe across a tips card turns it: the card's reel and words follow the finger
 * and, let go far or fast enough, the turn plays on from where they stand; otherwise they spring back.
 * A drag decides its direction once it has travelled `SWIPE_LOCK`, so a vertical one stays the words'
 * scroll and a tap stays a tap.
 */
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { animate, type AnimationPlaybackControls } from 'framer-motion';
import { framerMotion } from '../../design/motion';

/** The custom property a card's swiping parts are offset by, in card px; the reel's parts slide what
 *  their frames show by it, the words move by it. */
export const SWIPE_VAR = '--tour-swipe';
/** Marks a part of the card shown that follows the finger. */
export const SWIPE_PART_ATTR = 'data-tour-swipe';

/** How far a press travels, in window px, before it is a drag along one axis. */
export const SWIPE_LOCK = 8;
/** A release turns past this share of the card's width, bounded to these window px. */
const TURN_SHARE = 0.22;
const TURN_LEAST = 48;
const TURN_MOST = 120;
/** A release this fast, in window px per ms, the way of the drag turns from any distance past the lock. */
export const SWIPE_FLICK = 0.45;
/** How long a release's speed is read over, in ms. */
const FLICK_WINDOW = 90;
/** How far the parts follow a drag towards no card, as a share of the finger's travel. */
const EDGE_GIVE = 0.3;
/** The parts fade as they follow, by `FADE_MOST` of their opacity once `FADE_TRAVEL` card px along, so
 *  the frame's ground shows through as it does when a card turns. */
const FADE_TRAVEL = 160;
const FADE_MOST = 0.6;

/** Stands `el` `px` card px along a swipe; a filter, since the turn's own fade owns its opacity. */
function stand(el: HTMLElement, px: number): void {
  el.style.setProperty(SWIPE_VAR, `${px}px`);
  el.style.filter = px === 0 ? '' : `opacity(${1 - FADE_MOST * Math.min(1, Math.abs(px) / FADE_TRAVEL)})`;
}

/** Whether a drag of `dx` window px, let go at `speed` px per ms, across a card `width` px wide, turns
 *  it: forward for a drag to the left, back for one to the right. */
export function swipeTurns(dx: number, speed: number, width: number): boolean {
  const reach = Math.min(TURN_MOST, Math.max(TURN_LEAST, width * TURN_SHARE));
  return Math.abs(dx) >= reach || (Math.abs(dx) > SWIPE_LOCK && speed * Math.sign(dx) >= SWIPE_FLICK);
}

type Drag = { id: number; x0: number; y0: number; state: 'pending' | 'drag' | 'off'; trail: { x: number; t: number }[] };

/**
 * The handlers and style for a card's screen. `enabled` holds in touch mode on a card the visitor can
 * turn; `forward`, `backward` say whether there is a card that way; `zoom` is the card's own. Under
 * `reduced` motion the parts do not follow, and a release only turns.
 */
export function useSwipeTurn({ enabled, forward, backward, zoom, reduced, onNext, onBack }: {
  enabled: boolean; forward: boolean; backward: boolean; zoom: number; reduced: boolean; onNext: () => void; onBack: () => void;
}): { style: CSSProperties; onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void; onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void } {
  const drag = useRef<Drag | null>(null);
  const back = useRef<AnimationPlaybackControls | null>(null);
  /** The current card's following parts: those not leaving a turn already made. */
  const parts = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`[${SWIPE_PART_ATTR}]`)].filter((el) => !el.closest('[data-leaving]'));
  const offset = (root: HTMLElement, px: number) => { for (const el of parts(root)) stand(el, px); };
  /** Where the parts stand for a finger `dx` window px along, with give towards no card. */
  const follow = (dx: number) => ((dx < 0 ? forward : backward) ? dx : dx * EDGE_GIVE) / zoom;

  const end = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.state !== 'drag') return;
    const root = e.currentTarget;
    const dx = e.clientX - d.x0;
    const recent = d.trail.filter((p) => e.timeStamp - p.t <= FLICK_WINDOW);
    const from = recent[0] ?? d.trail[0]!;
    const speed = e.timeStamp > from.t ? (e.clientX - from.x) / (e.timeStamp - from.t) : 0;
    const turns = !cancelled && swipeTurns(dx, speed, root.getBoundingClientRect().width) && (dx < 0 ? forward : backward);
    if (turns) {
      // The parts leave from where the finger left them; the card arriving starts from its own place.
      if (dx < 0) onNext(); else onBack();
      return;
    }
    if (reduced) return;
    const shown = parts(root);
    const at = parseFloat(shown[0]?.style.getPropertyValue(SWIPE_VAR) || '0') || 0;
    back.current = animate(at, 0, {
      ...framerMotion('tour.card.swipe'),
      onUpdate: (v) => { for (const el of shown) stand(el, v); },
      onComplete: () => { for (const el of shown) stand(el, 0); },
    });
  };

  return {
    // The browser keeps the vertical pan for the words' scroll and leaves the horizontal one to the card.
    style: enabled ? { touchAction: 'pan-y' } : {},
    onPointerDown: (e) => {
      if (!enabled || e.isPrimary === false || drag.current) return;
      drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, state: 'pending', trail: [{ x: e.clientX, t: e.timeStamp }] };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId || d.state === 'off') return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (d.state === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_LOCK) return;
        if (Math.abs(dy) >= Math.abs(dx)) { d.state = 'off'; return; }
        d.state = 'drag';
        back.current?.stop();
        // Held by the card, the press ends there: the control it began on is not pressed.
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      d.trail.push({ x: e.clientX, t: e.timeStamp });
      if (d.trail.length > 12) d.trail.shift();
      if (!reduced) offset(e.currentTarget, follow(dx));
    },
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
  };
}
