/**
 * Character.tsx — the one-character system. ONE instance stands app-wide, in the one seat the frame
 * declares for her (`seat.ts`), whether the panel is open or shut; this component owns only its own
 * choreography, ported from the normative prototype's `makeCharacter`/`setPose`/`setBadge` onto
 * `poses.ts`'s data table.
 *
 * THE RECORDED GOTCHA: a badge swap-out plays `fill:'forwards'` so it holds `scale(0)` after it
 * finishes; swapping the badge again before that hold is released re-asserts `scale(0)` on the
 * INCOMING badge unless every animation already on the badge element is canceled first. `setBadge`
 * below cancels `badgeEl.getAnimations()` at the top of every swap-in for exactly this reason —
 * do not remove it because "nothing is animating there right now".
 *
 * SCHEDULING DEVIATES FROM THE PROTOTYPE IN ONE RESPECT: the prototype's `schedule(fn, at)` always
 * goes through `setTimeout`, even for `at:0` (so a same-tick badge or track start is still one
 * microtask away). Here, `at <= 0` runs its callback SYNCHRONOUSLY instead — the same end state,
 * reachable without a caller having to flush a timer queue for the overwhelmingly common
 * zero-delay case (every pose but the two one-shots badges/tracks at their own pose's start).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { characterArt } from '../../../assets/agent/agent-art';
import { INSET, PLATE, PLATE_INK, TRACK } from '../../design/tokens';
import { edge } from '../tokens';
import { Icon, type IconId } from '../icons';
import { DREAM } from '../sketchbook/sketch-motion';
import { Badge, type BadgeId } from './badges';
import { EYE_DOTS, lashWidth, lidBox } from './face';
import { CURVES, MICRO, POSE_DWELL, POSES, PRESS_SQUASH, PUFF, WAKE_BEAT, type BodyPart, type PoseKeyframe, type PoseName, type PoseTimer, type PoseTrack } from './poses';
import { amplitude, framerMotion, seconds } from '../motion';
import { cursors } from '../../design/styles';

export interface CharacterHandle {
  el: HTMLDivElement;
  parts: Record<BodyPart, HTMLDivElement>;
  puff(): void;
  /**
   * The shoulder badge, swapped by a SURFACE rather than by a pose.
   *
   * The idle dressing needs it (she wears the note while the pencil moves) and the dressing lives in
   * the panel's lazy chunk, one layer away from this component. The pose's own badge is restored by
   * the next pose change, which is what makes a garnish safe to play over any of them.
   */
  setBadge(id: BadgeId | null): void;
  /**
   * The Connect-press wake beat (`poses.ts:WAKE_BEAT`), for the press that wakes her: she rises out
   * of the sleeping rest as the key screen lands. Plays only while she is WEARING `sleeping` — a
   * Connect press over an awake character plays nothing — and reduced motion skips it whole.
   */
  wake(): void;
  /** Her press squash (`poses.ts:PRESS_SQUASH`), for a surface whose press she cannot hear herself
   *  (the keyless rest's Connect). Her own click plays the same one. */
  acknowledge(): void;
}

let liveHandle: CharacterHandle | null = null;

/**
 * THE DREAM BADGE, published rather than passed.
 *
 * It is the sleeping screen's own plume and it stands OUTSIDE the pose — a sibling of `.flip`, per
 * the artifact — because the plume is the only thing on that screen that does NOT move, which is
 * what makes a 2.8-degree twitch of the body legible at all. A badge inside the pose would twitch
 * with her. The disconnected screen is in the lazy panel chunk and the character is one eager layer
 * outside it, so the fact travels the same way a surface pose does (`surface-pose.ts`).
 *
 * Three states in one primitive, so a caller setting the same thing twice notifies nobody:
 * `'off'` (no dream badge at all), `'zzz'` (she is sleeping), or the glyph of the order she is
 * dreaming.
 */
export type DreamBadge = 'off' | 'zzz' | IconId;

let dreamBadge: DreamBadge = 'off';
const dreamListeners = new Set<() => void>();

export function setDreamBadge(next: DreamBadge): void {
  if (next === dreamBadge) return;
  dreamBadge = next;
  for (const listener of dreamListeners) listener();
}

function subscribeDream(listener: () => void): () => void {
  dreamListeners.add(listener);
  return () => { dreamListeners.delete(listener); };
}

function useDreamBadge(): DreamBadge {
  return useSyncExternalStore(subscribeDream, () => dreamBadge, () => 'off' as const);
}

/** The one live Character instance, for `seat.ts` to place. Null before the first mount
 *  and after the (one, app-wide) instance unmounts. */
export function getCharacterHandle(): CharacterHandle | null {
  return liveHandle;
}

const BADGE_SWAP_OUT_MS = 110;
const BADGE_SWAP_GAP_MS = 60;
/** The new badge popping in with overshoot, from its own declaration (`panel.badge.pop`) rather
 *  than a number typed beside the animate call. The ask bubble's longer 420ms boing is a different
 *  landing weight and stays a pose transition, declared in `poses.ts` alongside the rest of it. */
const BADGE_POP_IN_MS = seconds('panel.badge.pop') * 1000;

/**
 * SHE IS THE ASSISTANT'S OWN CONTROL, where a caller hands her the press: the block she stands on
 * draws no art of its own, and once the panel is open it stands behind her, so a press aimed at the
 * drawing is the one that has to answer.
 *
 * HER HOVER IS THE HOUSE ONE (`design/styles.ts:pressable`'s growth, read through her own
 * declaration), which is what the five blocks she stands beside take — one growth, one spring, one
 * feel across the whole row. HER PRESS IS HER OWN: a character answers a press as a body, so the
 * click plays the prototype's squash on her body part (`poses.ts:PRESS_SQUASH`, additive so the
 * breath goes on underneath) rather than the generic control shrink.
 *
 * IT RIDES THE ROOT, which is free for it: the pose machine writes its tracks on the three parts
 * below (`flip`/`pose`/`body`), the puff is appended to the layer beside her and is placed in layout
 * coordinates, and her own placement is `left`/`top`. Framer drops a scale under reduced motion, the
 * same as it does for the blocks.
 */
export interface CharacterPress {
  onPress(): void;
  /** Whether the panel she opens is standing, for the block below to agree with. */
  open: boolean;
}

/** How far she grows under a pointer: her declaration's own amplitude, which reads the shared hover
 *  (`panel.character.hover` is `pressable`'s growth), so the row cannot answer at two sizes. */
const HOVER = { scale: 1 + (amplitude('panel.character.hover') ?? 0) };

export function Character({ pose, size, press }: { pose: PoseName; size: number; press?: CharacterPress }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const spinRef = useRef<HTMLDivElement>(null);
  const lidLRef = useRef<HTMLDivElement>(null);
  const lidRRef = useRef<HTMLDivElement>(null);

  const [shownBadge, setShownBadge] = useState<BadgeId | null>(null);
  const reduced = useReducedMotionConfig() === true;
  const dream = useDreamBadge();
  /** The live pose effect's own `setBadge`, so the published handle can reach it. Re-pointed on
   *  every effect run; the handle itself is built once. Same arrangement for the two press verbs,
   *  which read the effect's own `reduced`. */
  const badgeVerb = useRef<(id: BadgeId | null) => void>(() => {});
  const wakeVerb = useRef<() => void>(() => {});
  const ackVerb = useRef<() => void>(() => {});

  // Engine state, alive for the component's whole life — `applyPose` (re-created each effect
  // run) always starts by draining whatever these hold from the previous run.
  const anims = useRef<Animation[]>([]);
  /** The infinite loops that are STANDING, by the declaration that started them (see `keepLoops`). */
  const loops = useRef<Map<PoseTrack, Animation>>(new Map());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** The pose she is actually WEARING, and when it landed: a gesture is not cut short of its own
   *  length (`POSE_DWELL`). */
  const worn = useRef<PoseName | null>(null);
  const wornAt = useRef(0);
  /** Which motion setting the worn pose was built for: a change of it re-poses her outright, since
   *  the reduced still frame and the animated pose are two different renderings of one state. */
  const wornReduced = useRef<boolean | null>(null);
  const currentBadge = useRef<BadgeId | null>(null);
  const badgeAngle = useRef(0);

  /** The dust under the feet when a jump lands. Placed in LAYOUT coordinates (`offsetLeft`, not a
   *  measured rect): mid-squash the rect is not where the feet are. That makes the host layer's own
   *  freedom from `transform` a REQUIREMENT rather than a preference — a transformed ancestor
   *  becomes the offset parent's containing block and the puffs land off the character. */
  function puff() {
    const el = rootRef.current;
    const layer = el?.parentElement;
    if (!el || !layer) return;
    const cx = el.offsetLeft + el.offsetWidth / 2;
    const by = el.offsetTop + el.offsetHeight - 8;
    ([[-1, -12], [0, 0], [1, 12]] as const).forEach(([i, sx], k) => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', width: '9px', height: '9px', borderRadius: '50%',
        background: INSET, border: `1px solid ${TRACK}`, pointerEvents: 'none',
        left: `${cx + sx * (el.offsetWidth / 80) - 4}px`,
        top: `${by - (i === 0 ? -2 : 4)}px`,
      });
      layer.appendChild(d);
      if (!reduced && typeof d.animate === 'function') {
        d.animate(
          [
            { transform: 'translate(0,0) scale(.6)', opacity: .9 },
            { transform: `translate(${i * 10}px,${i === 0 ? 3 : -5}px) scale(1)`, opacity: 0 },
          ],
          { duration: PUFF.dur, easing: CURVES.out, delay: k * PUFF.stagger, fill: 'forwards' },
        );
      }
      setTimeout(() => d.remove(), PUFF.clearAfter);
    });
  }

  // Publish the one live handle for `useCharacterMorph`. Runs once per mount; the app is expected
  // to mount exactly one Character, so the last-mounted instance's cleanup clearing the slot is
  // safe rather than a race.
  useEffect(() => {
    if (!rootRef.current || !flipRef.current || !poseRef.current || !bodyRef.current) return undefined;
    const handle: CharacterHandle = {
      el: rootRef.current,
      parts: { flip: flipRef.current, pose: poseRef.current, body: bodyRef.current },
      puff,
      setBadge: (id) => badgeVerb.current(id),
      wake: () => wakeVerb.current(),
      acknowledge: () => ackVerb.current(),
    };
    liveHandle = handle;
    return () => { if (liveHandle === handle) liveHandle = null; };
  }, []);

  useEffect(() => {
    const partEls: Record<BodyPart, HTMLDivElement | null> = {
      flip: flipRef.current, pose: poseRef.current, body: bodyRef.current,
    };

    /** Everything the pose that is leaving owns, EXCEPT its loops: those are reconciled against the
     *  arriving pose's own declarations (`keepLoops`), so a breath both poses declare goes on
     *  breathing rather than restarting from nothing. */
    function clearAll() {
      anims.current.forEach((a) => a.cancel());
      anims.current = [];
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
      (Object.keys(partEls) as BodyPart[]).forEach((k) => { const el = partEls[k]; if (el) el.style.transform = ''; });
    }
    /**
     * THE STANDING LOOPS, HELD APART FROM EVERYTHING ELSE AND KEYED ON THEIR OWN DECLARATION.
     *
     * A loop is the breath: it has no beginning anyone is meant to see, and it must outlive this
     * effect's own re-runs (the pose asked for moves several times a second — see the dwell below),
     * so it is not in `anims` and `clearAll` does not touch it. This is its owner: a pose landing
     * cancels the loops the leaving pose declared and starts the ones the arriving pose does.
     *
     * IDENTITY IS THE TEST, and the tracks are module constants (`POSES`), so a track already running
     * is one already correct: a pose re-applied — a one-shot settling back to the pose it interrupted
     * — keeps its breath rather than starting a new one halfway through the old one's cycle.
     */
    function keepLoops(next: readonly PoseTrack[]) {
      for (const [track, anim] of [...loops.current]) {
        if (next.includes(track) && anim.playState === 'running') continue;
        anim.cancel();
        loops.current.delete(track);
      }
      for (const tr of next) {
        if (loops.current.has(tr)) continue;
        schedule(() => {
          const el = partEls[tr.part];
          if (!el || typeof el.animate !== 'function') return;
          loops.current.set(tr, el.animate(tr.keyframes as Keyframe[], {
            duration: tr.dur, easing: tr.easing, iterations: Infinity,
            ...(tr.composite ? { composite: tr.composite } : {}),
          }));
        }, tr.at ?? 0);
      }
    }
    /** `at <= 0` runs synchronously — see the file header. */
    function schedule(fn: () => void, at: number) {
      if (at <= 0) { fn(); return; }
      timers.current.push(setTimeout(fn, at));
    }
    function play(
      part: BodyPart, dur: number, easing: string, keyframes: PoseKeyframe[],
      opts?: { iterations?: number; fill?: FillMode; composite?: CompositeOperation },
    ) {
      const el = partEls[part];
      if (!el || typeof el.animate !== 'function') return;
      const a = el.animate(keyframes as Keyframe[], {
        duration: dur, easing, iterations: opts?.iterations ?? 1, fill: opts?.fill ?? 'none',
        ...(opts?.composite ? { composite: opts.composite } : {}),
      });
      // A finished forwards-filled animation is REPLACEABLE: the browser auto-removes it as soon
      // as any newer animation targets the same property, HOWEVER that one composites — so the
      // dream board's additive resettle swept the sleeping slump off her and she slept bolt
      // upright. A pose's settled frame is a hold, not a leak; the next pose's `clearAll` ends it.
      if ((opts?.fill === 'forwards' || opts?.fill === 'both') && typeof a.persist === 'function') a.persist();
      anims.current.push(a);
    }
    function setLids(down: boolean) {
      const t = down ? 'scaleY(1)' : 'scaleY(0)';
      if (lidLRef.current) lidLRef.current.style.transform = t;
      if (lidRRef.current) lidRRef.current.style.transform = t;
    }
    function blink() {
      setLids(true);
      schedule(() => { if (!POSES[pose]?.lids) setLids(false); }, 130);
    }
    function micro(name: PoseTimer['run']) {
      if (name === 'blink') { blink(); return; }
      const m = MICRO[name];
      play(m.part, m.dur, m.easing, m.keyframes, { ...(m.composite ? { composite: m.composite } : {}) });
    }
    function armTimer(t: PoseTimer) {
      const wait = t.every + Math.random() * (t.jitter ?? 0);
      schedule(() => { micro(t.run); armTimer(t); }, wait);
    }
    function setBadge(id: BadgeId | null, curve?: 'boing', delay = 0) {
      if (id === currentBadge.current) return;
      const badgeEl = badgeRef.current;
      const showNew = () => {
        // Cancel whatever is still on the badge before this pop-in plays: a running pop-in, or a
        // finished-but-forwards-filled swap-out still holding scale(0).
        if (badgeEl && typeof badgeEl.getAnimations === 'function') {
          badgeEl.getAnimations().forEach((a) => a.cancel());
        }
        currentBadge.current = id;
        badgeAngle.current = 0;
        if (spinRef.current) spinRef.current.style.transform = '';
        setShownBadge(id);
        if (!badgeEl) return;
        if (!id) { badgeEl.style.transform = 'scale(0)'; return; }
        badgeEl.style.transform = 'scale(1)';
        if (reduced || typeof badgeEl.animate !== 'function') return;
        const kf: PoseKeyframe[] = curve === 'boing'
          ? [{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: .55 }, { transform: 'scale(.95)', offset: .8 }, { transform: 'scale(1)' }]
          : [{ transform: 'scale(0)' }, { transform: 'scale(1.18)', offset: .6 }, { transform: 'scale(1)' }];
        badgeEl.animate(kf as Keyframe[], { duration: curve === 'boing' ? 420 : BADGE_POP_IN_MS, easing: 'linear' });
      };
      if (currentBadge.current && !reduced && badgeEl && typeof badgeEl.animate === 'function') {
        badgeEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(0)' }], { duration: BADGE_SWAP_OUT_MS, easing: CURVES.inn, fill: 'forwards' });
        schedule(showNew, BADGE_SWAP_OUT_MS + BADGE_SWAP_GAP_MS + delay);
      } else {
        schedule(showNew, delay);
      }
    }
    function tickBadge(spec: { every: number; rotateBy: number; dur: number; easing: string }) {
      const tick = () => {
        badgeAngle.current += spec.rotateBy;
        const spinEl = spinRef.current;
        if (spinEl && typeof spinEl.animate === 'function') {
          const from = spinEl.style.transform || 'rotate(0deg)';
          spinEl.style.transform = `rotate(${badgeAngle.current}deg)`;
          spinEl.animate([{ transform: from }, { transform: `rotate(${badgeAngle.current}deg)` }], { duration: spec.dur, easing: spec.easing });
        }
        timers.current.push(setTimeout(tick, spec.every));
      };
      timers.current.push(setTimeout(tick, spec.every));
    }

    function applyPose(name: PoseName) {
      const p = POSES[name];
      worn.current = name;
      wornAt.current = Date.now();
      clearAll();
      setLids(!!p.lids);
      setBadge(p.badge, p.badgeCurve, p.badgeAt ?? 0);
      if (p.badgeOutAt) schedule(() => setBadge(null), p.badgeOutAt);
      if (reduced) {
        keepLoops([]);
        if (poseRef.current) poseRef.current.style.transform = p.static || '';
        if (p.staticBadge) setBadge(p.staticBadge);
        if (p.oneShot && p.settleTo) schedule(() => applyPose(p.settleTo!), 900);
        return;
      }
      (p.enter ?? []).forEach((tr) => schedule(() => play(tr.part, tr.dur, tr.easing, tr.keyframes, { fill: 'forwards' }), tr.at ?? 0));
      (p.seq ?? []).forEach((tr) => schedule(() => {
        play(tr.part, tr.dur, tr.easing, tr.keyframes, { fill: 'forwards' });
        if (tr.puffAt != null) schedule(puff, tr.puffAt);
      }, tr.at ?? 0));
      keepLoops(p.loops ?? []);
      (p.timers ?? []).forEach(armTimer);
      if (p.badgeTick) tickBadge(p.badgeTick);
      if (p.oneShot && p.settleTo) schedule(() => applyPose(p.settleTo!), p.settleAt ?? 0);
    }

    badgeVerb.current = (id: BadgeId | null) => setBadge(id);
    /*
     * THE WAKE BEAT PLAYS OUTSIDE THE POSE MACHINE (not through `play`, so not in `anims`): the key
     * screen landing runs `applyPose('idle')`, whose `clearAll` cancels everything the sleep pose
     * owned — the beat has to survive that to be seen at all, and `idle` drives no pose-part track
     * of its own so nothing replaces it. No fill, so at its end the part is back on the landing
     * pose's own value, and any NEWER pose-part animation (a fast paste bringing `keylean` in)
     * takes over mid-beat — the wake yields by construction, exactly as the prototype's does.
     */
    wakeVerb.current = () => {
      if (reduced || worn.current !== 'sleeping') return;
      const el = partEls.pose;
      if (!el || typeof el.animate !== 'function') return;
      el.animate(WAKE_BEAT.keyframes as Keyframe[], { duration: WAKE_BEAT.dur, easing: WAKE_BEAT.easing });
    };
    ackVerb.current = () => {
      if (reduced) return;
      const el = partEls.body;
      if (!el || typeof el.animate !== 'function') return;
      el.animate(PRESS_SQUASH.keyframes as Keyframe[], {
        duration: PRESS_SQUASH.dur, easing: PRESS_SQUASH.easing,
        ...(PRESS_SQUASH.composite ? { composite: PRESS_SQUASH.composite } : {}),
      });
    };

    /*
     * ONE GESTURE AT A TIME, WHATEVER THE PHASE DOES. The pose asked for here is derived from the
     * session, which moves several times a second inside a single turn, and a pose is a gesture with
     * a length: adopting each one as it arrived cancelled every animation on her and started the next
     * entrance from nothing, seven times a second (`POSE_DWELL` carries the measurement). So a pose
     * that arrives inside the worn one's own window is REMEMBERED — this effect re-runs per change and
     * the wait is re-derived from when the worn pose landed, so the deadline does not move and the
     * newest pose is the one that lands on it.
     *
     * The pose she is already wearing is not re-applied at all, and neither is the first one delayed.
     */
    let pending: ReturnType<typeof setTimeout> | undefined;
    if (worn.current !== pose || wornReduced.current !== reduced) {
      // NO DWELL UNDER REDUCED MOTION, and none for the first pose: the dwell exists to protect a
      // gesture from being cut short, and a reduced rendering is a still frame with no gesture in it.
      const wait = worn.current === null || reduced ? 0 : POSE_DWELL - (Date.now() - wornAt.current);
      wornReduced.current = reduced;
      if (wait <= 0) applyPose(pose);
      else pending = setTimeout(() => applyPose(pose), wait);
    }
    // ONLY THE WAIT IS UNDONE HERE. This effect re-runs on every pose the session asks for, and the
    // gesture she is WEARING has to survive those: tearing her animations down per run would cancel
    // the very entrance the dwell above exists to protect. What ends an animation is the next pose
    // landing (`applyPose` opens with `clearAll`) or the character leaving the page (below).
    return () => { if (pending !== undefined) clearTimeout(pending); };
  }, [pose, reduced]);

  useEffect(() => () => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    loops.current.forEach((a) => a.cancel());
    loops.current.clear();
    // StrictMode's dev-only remount runs this cleanup and then every effect again ON THE SAME
    // INSTANCE, whose refs survive — so `worn` would still claim the pose is standing over an
    // engine this just drained, and she booted into a still (lids down, no slump, no breath)
    // until the first pose change. Cleared, the re-run re-applies the pose it finds.
    worn.current = null;
    wornReduced.current = null;
  }, []);

  return (
    <motion.div
      ref={rootRef}
      data-testid="pw-character"
      data-pose={pose}
      {...(press
        ? {
          onClick: () => { ackVerb.current(); press.onPress(); },
          whileHover: HOVER,
          transition: framerMotion('panel.character.hover'),
          // The block underneath carries the label and the focus ring for a keyboard, so the drawing
          // is not a second control in the reading order.
          'aria-hidden': true,
        }
        : {})}
      style={{
        width: size,
        position: 'relative',
        ...(press ? { pointerEvents: 'auto' as const, cursor: cursors.clickable } : null),
      }}
    >
      <div ref={flipRef} data-part="flip" style={{ width: '100%', height: '100%', position: 'relative' }}>
        <div ref={poseRef} data-part="pose" style={{ width: '100%', height: '100%', position: 'relative', transformOrigin: '50% 92%' }}>
          <div ref={bodyRef} data-part="body" style={{ width: '100%', height: '100%', position: 'relative', transformOrigin: '50% 88%' }}>
            <img draggable={false} src={characterArt('base')} alt="" style={{ width: '100%', display: 'block' }} />
            <div ref={lidLRef} data-part="lid-l" style={lidStyle('l', size)} />
            <div ref={lidRRef} data-part="lid-r" style={lidStyle('r', size)} />
            <div
              ref={badgeRef}
              data-part="badge"
              style={{
                ...BADGE_BOX,
                transform: 'scale(0)',
                transformOrigin: '50% 60%',
                // The dream plume takes the shoulder while it stands: two badges on one shoulder
                // would be the pose's zzz and the dream's own, drawn over each other.
                opacity: dream === 'off' ? 1 : 0,
              }}
            >
              <div ref={spinRef} data-part="badge-spin" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {shownBadge != null && <Badge id={shownBadge} />}
              </div>
            </div>
          </div>
        </div>
      </div>
      {dream !== 'off' && <DreamPlume glyph={dream === 'zzz' ? null : dream} reduced={reduced} />}
    </motion.div>
  );
}

/** The lid's own skin and lash inks, from the drawing they are painted over. */
const LID_SKIN = '#F9DB99';
const LID_LASH_INK = '#6B5237';

/**
 * One closed-eye lid, placed over the eye it covers (`face.ts` carries the whole derivation).
 *
 * `box-sizing: border-box` is what makes the stated box the OVAL: the lash is a bottom border, and on
 * a content box it would be added below the height and drop the oval's centre by half of itself,
 * which is scale-dependent and is exactly what left a ring of the open eye showing.
 */
function lidStyle(side: 'l' | 'r', size: number): CSSProperties {
  const box = lidBox(EYE_DOTS[side]);
  return {
    position: 'absolute',
    left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`,
    boxSizing: 'border-box',
    borderRadius: '50%', background: LID_SKIN,
    borderBottom: `${lashWidth(size)}px solid ${LID_LASH_INK}`,
    transform: 'scaleY(0)', transformOrigin: '50% 20%', transition: 'transform 70ms ease-out',
  };
}

/** The badge box, shared by the pose's own badge and the dream plume: the same shoulder, so the one
 *  stands exactly where the other did. */
const BADGE_BOX: CSSProperties = {
  position: 'absolute', top: '-8%', right: '-10%', width: '44%', height: '40%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/** The breath bubble's own inks, from the drawing: a paler fill and a much darker rim than the dust
 *  puff's, because this one is a bubble of air read against her shoulder rather than ground kicked up
 *  under her feet. */
const BREATH_FILL = '#EFECE0';
const BREATH_RIM = '#8F8778';

/**
 * The sleeper's plume: the zzz, the dreamed order's glyph in their place, and one breath as they
 * come back.
 *
 * It sits OUTSIDE the pose (see `setDreamBadge`) and is deliberately not routed through `setBadge`:
 * its beat is the dream's own (a fade to the glyph and a spring back), which is a different idiom
 * from the badge machine's swap-out/pop-in and would fight it.
 *
 * THE GLYPH'S DISC STAYS MOUNTED, empty or not, and that is what lets it arrive at all: a span that
 * appears with the glyph has no previous state to transition from, so the whole spring would be spent
 * on the first painted frame. Mounted always, the transition runs on the two properties that change.
 */
function DreamPlume({ glyph, reduced }: { glyph: IconId | null; reduced: boolean }) {
  const puffRef = useRef<HTMLSpanElement>(null);
  const had = useRef<IconId | null>(null);

  useEffect(() => {
    const leaving = had.current !== null && glyph === null;
    had.current = glyph;
    const el = puffRef.current;
    if (!leaving || reduced || !el || typeof el.animate !== 'function') return;
    el.animate(DREAM.puffFrames, {
      duration: DREAM.puff.dur, easing: DREAM.puff.easing, fill: 'both',
    });
  }, [glyph, reduced]);

  return (
    <span data-part="dream-badge" data-dream={glyph ?? 'zzz'} style={BADGE_BOX}>
      <span
        data-part="dream-zzz"
        style={{
          opacity: glyph ? 0 : 1,
          transition: reduced ? 'none' : `opacity ${DREAM.zzzFade.dur}ms ${DREAM.zzzFade.easing}`,
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Badge id="zzz" />
      </span>
      <span
        data-part="dream-glyph"
        data-standing={glyph ? '1' : undefined}
        style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: PLATE, border: edge, borderRadius: '50%', color: PLATE_INK,
          opacity: glyph ? 1 : 0,
          transform: glyph ? 'none' : `scale(${DREAM.glyphFrom})`,
          transition: reduced ? 'none' : [
            `opacity ${DREAM.glyphFade.dur}ms ${DREAM.glyphFade.easing}`,
            `transform ${DREAM.glyphRise.dur}ms ${DREAM.glyphRise.easing}`,
          ].join(', '),
        }}
      >
        {glyph && <Icon id={glyph} size={16} />}
      </span>
      <span
        ref={puffRef}
        data-part="dream-puff"
        style={{
          position: 'absolute', left: -7, bottom: 0, width: 11, height: 11, borderRadius: '50%',
          boxSizing: 'border-box',
          background: BREATH_FILL, border: `1.5px solid ${BREATH_RIM}`, opacity: 0, pointerEvents: 'none',
        }}
      />
    </span>
  );
}
