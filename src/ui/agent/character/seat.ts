/**
 * seat.ts — the one live character's TWO SEATS, and the one piece of arithmetic that places her in
 * either of them.
 *
 * SHE HAS A FOLDED BOX AND A DESK SEAT. Both are placed by the frame — her box below the mode row, the
 * desk's seat at the plate's own padding beside the dock band (`shell/panel-frame.ts`) — so the
 * distance between them is a consequence of the grid rather than a number anyone picked. A seat is an
 * EMPTY BOX she is placed against rather than mounted in: she positions herself `fixed` from its
 * measured rect, which is what lets her stand over the panel she is standing on, so this is where a
 * measured rect becomes her `left`/`top`/`width`.
 *
 * AND FREE, SHE DOES NOT TRAVEL BETWEEN THEM — THE PANEL SHE IS PART OF DOES. One
 * object, one displacement: the whole floating form collapses onto her button and unfolds off it, and
 * her place INSIDE it never changes. `placeCarried` is that made structural — one number, both halves
 * written from it in one tick, so the offset between her and the panel is the difference of two seats
 * and cannot drift by a frame.
 *
 * A CHANGE OF DOCK IS NOT A CROSSING AT ALL. The floating panel and the docked ground are different
 * layers, so she does not travel between them: she leaves with the form she is part of and arrives
 * with the one that replaces it (`fadeCharacter`), and the seat changes while she is not on screen.
 *
 * THE DESK'S SEAT REGISTERS ITSELF, because the two live on opposite sides of the panel's lazy
 * boundary: `CharacterHost` is eager and the desk arrives with the panel. So the desk hands its box
 * in (`setDeskSeat`) and the host WATCHES for it — the arrival of the seat is what starts her step,
 * and its departure is what sends her back, rather than a flag the mount can race.
 *
 * THE PLACEMENT IS LAYER-RELATIVE, and that is what makes it survive an ancestor that breaks it.
 *
 * A `fixed` box resolves its `left`/`top` against the nearest ancestor carrying a transform or a
 * filter, and only against the viewport where there is none. The app has one such ancestor for real:
 * the boot splash's hand-off plane (`App.tsx`, `translateY(4vh)` while the splash stands). Under it,
 * writing a slot's viewport rect straight onto her `top` seated her the whole transform below her
 * seat — measured at 1280x800: slot at y 266.5, her box at 300.5 — and nothing put her right
 * afterwards, because the plane's removal moves the slot and her by the same 4vh and the error is
 * invariant under it. Subtracting the layer's own rect makes every placement layer-relative, so it is
 * correct under any ancestor transform and STAYS correct when one goes away.
 */
import { getCharacterHandle } from './Character';
import { CHARACTER_SEAT } from '../../shell/panel-frame';

function layerOrigin(el: HTMLElement): { left: number; top: number } {
  const layer = el.parentElement;
  if (!layer) return { left: 0, top: 0 };
  const r = layer.getBoundingClientRect();
  return { left: r.left, top: r.top };
}

/** The same reading, for whoever places something else in the layer FROM a measured viewport rect
 *  (the chip at her shoulder, which is placed against her own box). */
export function toLayerSpace(
  el: HTMLElement | null, box: { left: number; top: number },
): { left: number; top: number } {
  if (!el) return box;
  const origin = layerOrigin(el);
  return { left: box.left - origin.left, top: box.top - origin.top };
}

let deskBox: HTMLElement | null = null;
const watchers = new Set<() => void>();

/** The desk's own seat, handed in by the panel as a ref callback: the element while the desk stands,
 *  `null` the moment it goes. */
export function setDeskSeat(el: HTMLElement | null): void {
  if (deskBox === el) return;
  deskBox = el;
  watchers.forEach((tell) => tell());
}

/** The desk's seat where one is standing. A stable identity, so it can be read as a store snapshot. */
export function deskSeat(): HTMLElement | null {
  return deskBox;
}

/** Told whenever the desk's seat arrives or goes, which is what her step is timed off. */
export function watchDeskSeat(tell: () => void): () => void {
  watchers.add(tell);
  return () => { watchers.delete(tell); };
}

let carriage: HTMLElement | null = null;

/** The panel's CARRIAGE, handed in the same way: the box that holds the whole floating form and takes
 *  the gesture's travel for all of it. No watchers — nothing is timed off it, and the writes below
 *  reach for it at the moment they run. */
export function setPanelCarriage(el: HTMLElement | null): void {
  carriage = el;
}

/** Where a placement put her, in the layer's own space. Her HEIGHT is not here: the placement sets a
 *  width and lets the art decide, so only the drawing can answer for it. */
export interface SeatedAt { left: number; top: number; width: number }

/**
 * Where a placement in `slot` WOULD put her, without moving her: her width is the box less the seat's
 * own pad, and the art decides her height. Silent until a Character has mounted, so an unwired mount
 * costs nothing.
 *
 * IT IS ASKED FOR AGAIN WHENEVER THE ROOM MOVES. A seat is placed by the frame, which follows the
 * window and the user's UI zoom, so a placement made once at mount goes stale: a resize left her
 * standing beside her own seat (measured at 1280x800 -> 1024x768: the slot moved 15 x 34 px and she
 * did not). `CharacterHost` owns that watch.
 *
 * The box is the SEAT, not a reading of where she is now: mid-gesture she is the seat plus whatever the
 * collapse still has to travel, and the chip at her shoulder is placed from this.
 */
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

/**
 * THE GESTURE'S TRAVEL, in the panel's own px, plus the scale it is read in her layer at.
 *
 * `left`/`top` are the offset that puts the panel's own seat onto her FOLDED box — the whole floating
 * form's displacement when it is collapsed, which is the same displacement she has, since she is part
 * of it. Declared in FRAME px, because that is the space the carriage's transform is applied in (it is
 * inside the frame's page zoom); `scale` is the real px per frame px, which is what her own layer —
 * which stands outside that zoom — multiplies by.
 */
export interface CarryStep { left: number; top: number; scale: number }

/** How far ALONG the gesture the one object is: 0 folded onto her button, 1 the panel standing at
 *  rest. Module state, so a gesture interrupted half way retargets from where the form actually is
 *  rather than from an end, and so a re-placement between gestures lands both halves at the point the
 *  last one reached. */
let carriedAt = 0;
let carriedStep: CarryStep = { left: 0, top: 0, scale: 1 };
/** What the carriage is displaced by right now, in its own px: what `restingSeat` takes back out. */
let shift = { x: 0, y: 0 };

/**
 * A SEAT INSIDE THE CARRIAGE, WITH THE COLLAPSE TAKEN BACK OUT OF IT.
 *
 * The desk's slot travels with the form it is part of, so its measured rect carries whatever the
 * gesture has displaced the carriage by. Read raw, that rect made the remaining travel shrink every
 * frame it was read — the panel folded a diminishing series and stopped half way, with the character
 * (whose own box is outside the carriage) walking the whole distance away from it.
 */
export function restingSeat(seat: SeatedAt | null): SeatedAt | null {
  if (!seat) return null;
  const scale = seatScale(seat);
  return { ...seat, left: seat.left - shift.x * scale, top: seat.top - shift.y * scale };
}

/** Where the gesture stands. */
export function carriedAlong(): number {
  return carriedAt;
}

/** A placement at the point the gesture has reached, which is what a re-placement IS: the room moved,
 *  and the one object is still exactly as folded as it was. */
export function parkCharacter(seat: SeatedAt | null): SeatedAt | null {
  if (seat) placeCarried(seat, carriedStep, carriedAt);
  return seat;
}

/**
 * THE ONE OBJECT PLACED: the panel's carriage and the character, from ONE number, in ONE tick.
 *
 * She and the panel are one thing in the floating form, and this is the whole of what makes that true
 * rather than asserted. The carriage takes the collapse's remaining travel as a transform and she is
 * placed at her seat plus the SAME remaining travel, so her offset inside the panel is the difference
 * of the two seats and nothing else — a constant, at every frame of every gesture, by arithmetic
 * rather than by two clocks agreeing. Two animations of the same length on the same curve are not
 * this: one runs on the compositor and one through layout, and what a viewer sees is her drifting
 * across the desk she is supposed to be sitting at.
 *
 * SHE IS PLACED AND NEVER TRANSITIONED. The travel is the gesture's, and it is already being carried;
 * a transition of her own on top of it would be a second clock on the one move.
 */
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

/** The scale her layer reads the panel's px in: her drawn width against the seat's declared one, which
 *  is the frame's own page zoom measured rather than threaded. */
export function seatScale(seat: SeatedAt): number {
  return seat.width / (CHARACTER_SEAT.w - CHARACTER_SEAT.pad * 2);
}

/** How far the collapse still has to travel, and at what scale: remembered with the number above, so a
 *  re-placement between gestures reads the same travel the last frame of the last one did. */
export function setCarry(at: number, step: CarryStep = carriedStep): void {
  carriedAt = at;
  carriedStep = step;
}

/**
 * How far past her own size the arrival goes, as a share of the travel it is arriving over. A third:
 * enough to read as weight landing rather than as a box settling, and not so much that a character the
 * size of a thumbnail appears to bounce.
 */
const POP_PAST = 1 / 3;

/**
 * HER OWN ARRIVAL AND DEPARTURE AT A CHANGE OF FORM: a zoom with weight in it (`panel.character.pop`).
 *
 * THE TWO FORMS LIVE ON DIFFERENT LAYERS and neither pretends to be the other, so there is nothing for
 * her to cross — she goes from the one that is being replaced and comes to the one replacing it, and
 * that hand-off is hers rather than a wrapper's. Free, she has no beat of her own at all: the panel she
 * is part of carries her (`placeCarried`).
 *
 * A WAAPI ANIMATION RATHER THAN A CSS TRANSITION, because a transition needs a painted frame at the
 * old value to interpolate from: coming back she is arriving from invisible, and the inline style that
 * holds her placement has to hold the DESTINATION values from the same frame it is written. So the
 * keyframes name both ends and no fill is needed.
 *
 * THE SCALE IS ON HER ROOT AND NOTHING ELSE IS. Her poses are transforms on the parts INSIDE it and the
 * dust under her feet is placed against her PARENT in layout coordinates, so neither can be reached by
 * a transform here.
 *
 * Silent where there is no character or no engine to animate with — the destination is written either
 * way, which is the reduced-motion answer too.
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
  // ARRIVING, SHE PASSES HER OWN SIZE AND COMES BACK TO IT; LEAVING, SHE DOES NOT. A departure has no
  // mark to land on, so it goes straight down and out — the overshoot is what says the arrival is
  // staying, and one on the way out would say she was about to come back.
  //
  // A KEYFRAME'S EASING GOVERNS THE INTERVAL THAT STARTS AT IT, which is what lets the approach and
  // the settle take different shapes without the two being multiplied by a third at the animation
  // level: the option's own easing is linear, and each segment carries its own.
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

/** Her presence written outright, with no beat: the reduced-motion answer, and the answer for a frame
 *  in which nothing about the form she is part of has changed. */
export function showCharacter(to: 0 | 1): void {
  const hero = getCharacterHandle();
  if (!hero) return;
  hero.el.style.opacity = String(to);
  hero.el.style.transform = 'none';
}

/**
 * THE GESTURE'S TRAVEL, measured: the offset that puts the panel's own seat onto her FOLDED box.
 *
 * Both boxes are the frame's own placements, so what this reads is a consequence of the grid rather
 * than a number anyone picked — the panel's left edge is the block rows' margin and her box is centred
 * on the block she stands in, and the difference between them is the whole of the travel. Returned in
 * the panel's px, with the scale her own layer reads it at (see `CarryStep`).
 */
export function carryStep(seat: SeatedAt, folded: SeatedAt): CarryStep {
  const scale = seatScale(seat);
  return {
    left: (folded.left - seat.left) / scale,
    top: (folded.top - seat.top) / scale,
    scale,
  };
}
