/**
 * Places the live character against folded and desk seat boxes. Positions are relative to the
 * character layer because transformed ancestors change the containing block for fixed descendants.
 * Floating gestures apply one shared progress value to the panel carriage and character.
 */
import { getCharacterHandle } from './Character';
import { CHARACTER_SEAT } from '../../shell/panel-frame';

function layerOrigin(el: HTMLElement): { left: number; top: number } {
  const layer = el.parentElement;
  if (!layer) return { left: 0, top: 0 };
  const r = layer.getBoundingClientRect();
  return { left: r.left, top: r.top };
}

let deskBox: HTMLElement | null = null;
const watchers = new Set<() => void>();

/** Registers the desk seat element across the panel's lazy boundary. */
export function setDeskSeat(el: HTMLElement | null): void {
  if (deskBox === el) return;
  deskBox = el;
  watchers.forEach((tell) => tell());
}

/** Returns the currently registered desk seat. */
export function deskSeat(): HTMLElement | null {
  return deskBox;
}

/** Subscribes to desk-seat registration changes. */
export function watchDeskSeat(tell: () => void): () => void {
  watchers.add(tell);
  return () => { watchers.delete(tell); };
}

let carriage: HTMLElement | null = null;

/** Registers the floating panel carriage that receives collapse travel. */
export function setPanelCarriage(el: HTMLElement | null): void {
  carriage = el;
}

/** Character geometry in layer coordinates; height follows the artwork's aspect ratio. */
export interface SeatedAt { left: number; top: number; width: number }

/** Computes layer-relative seated geometry from a live slot measurement without moving the character. */
export function seatBox(slot: HTMLElement | null): SeatedAt | null {
  const hero = getCharacterHandle();
  if (!hero || !slot) return null;
  const r = slot.getBoundingClientRect();
  const origin = layerOrigin(hero.el);
  const pad = CHARACTER_SEAT.pad * (r.width / CHARACTER_SEAT.w);
  return {
    left: r.left + pad - origin.left,
    top: r.top + pad - origin.top,
    width: r.width - pad * 2,
  };
}

/** Gesture travel in panel pixels plus the scale from panel space to the character layer. */
export interface CarryStep { left: number; top: number; scale: number }

/** Shared gesture progress: 0 folded, 1 open. Module state supports interrupted retargeting. */
let carriedAt = 0;
let carriedStep: CarryStep = { left: 0, top: 0, scale: 1 };
/** Current carriage displacement in panel pixels. */
let shift = { x: 0, y: 0 };

/** Removes the active carriage displacement from a measured desk seat. */
export function restingSeat(seat: SeatedAt | null): SeatedAt | null {
  if (!seat) return null;
  const scale = seatScale(seat);
  return { ...seat, left: seat.left - shift.x * scale, top: seat.top - shift.y * scale };
}

/** Where the gesture stands. */
export function carriedAlong(): number {
  return carriedAt;
}

/** Repositions the character while preserving current gesture progress. */
export function parkCharacter(seat: SeatedAt | null): SeatedAt | null {
  if (seat) placeCarried(seat, carriedStep, carriedAt);
  return seat;
}

/** Places the carriage and character from one progress value, with no independent character transition. */
export function placeCarried(seat: SeatedAt, step: CarryStep, at: number): void {
  const back = 1 - at;
  shift = { x: back * step.left, y: back * step.top };
  if (carriage) {
    carriage.style.transform = back === 0
      ? 'none'
      : `translate(${shift.x}px, ${shift.y}px)`;
  }
  const hero = getCharacterHandle();
  if (!hero) return;
  hero.el.style.transition = '';
  hero.el.style.position = 'fixed';
  hero.el.style.width = `${seat.width}px`;
  hero.el.style.left = `${seat.left + back * step.left * step.scale}px`;
  hero.el.style.top = `${seat.top + back * step.top * step.scale}px`;
}

/** Scale from panel pixels to the character layer, derived from the measured seat width. */
export function seatScale(seat: SeatedAt): number {
  return seat.width / (CHARACTER_SEAT.w - CHARACTER_SEAT.pad * 2);
}

/** Stores current gesture progress and travel for resize-time repositioning. */
export function setCarry(at: number, step: CarryStep = carriedStep): void {
  carriedAt = at;
  carriedStep = step;
}

/** Arrival overshoot as a fraction of the scale-up distance. */
const POP_PAST = 1 / 3;

/**
 * Animates cross-form arrival or departure with WAAPI while destination inline styles remain
 * authoritative. Returns null when no character or animation engine is available.
 */
export function popCharacter(
  to: 0 | 1,
  shape: { total: number; easing: string; land: string; from: number; past: number },
): Animation | null {
  const hero = getCharacterHandle();
  if (!hero) return null;
  hero.el.style.opacity = String(to);
  hero.el.style.transformOrigin = '50% 100%';
  hero.el.style.transform = to === 1 ? 'none' : `scale(${shape.from})`;
  if (typeof hero.el.animate !== 'function') return null;
  const small = { opacity: 0, transform: `scale(${shape.from})` };
  const home = { opacity: 1, transform: 'scale(1)' };
  // Arrivals overshoot; departures leave directly. Each keyframe easing controls its next interval.
  const frames = to === 1
    ? [
      { ...small, easing: shape.easing },
      {
        ...home,
        transform: `scale(${1 + (1 - shape.from) * POP_PAST})`,
        offset: shape.past,
        easing: shape.land,
      },
      home,
    ]
    : [{ ...home, easing: shape.easing }, small];
  return hero.el.animate(frames, { duration: shape.total * 1000, easing: 'linear' });
}

/** Writes visibility immediately for reduced motion and unchanged-form placement. */
export function showCharacter(to: 0 | 1): void {
  const hero = getCharacterHandle();
  if (!hero) return;
  hero.el.style.opacity = String(to);
  hero.el.style.transform = 'none';
}

/** Measures travel from the desk seat to the folded seat in panel pixels. */
export function carryStep(seat: SeatedAt, folded: SeatedAt): CarryStep {
  const scale = seatScale(seat);
  return {
    left: (folded.left - seat.left) / scale,
    top: (folded.top - seat.top) / scale,
    scale,
  };
}
