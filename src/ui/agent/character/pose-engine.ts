/*
 * The character's choreography as Web Animations on her parts. A badge swap cancels the badge's
 * running animations before the next one mounts, because a finished `fill: 'forwards'` exit would
 * otherwise hold the incoming badge at scale(0). Zero-delay steps run synchronously.
 */
import { INSET, TRACK } from '../../design/tokens';
import type { BadgeId } from './badges';
import type { Garnish } from './intent';
import {
  CURVES, MICRO, POSE_DWELL, POSES, PRESS_SQUASH, PUFF, WAKE_BEAT,
  type PoseKeyframe, type PoseName, type PoseTimer, type PoseTrack,
} from './poses';

export interface PoseParts {
  root: HTMLElement;
  flip: HTMLElement;
  pose: HTMLElement;
  body: HTMLElement;
  badge: HTMLElement;
  spin: HTMLElement;
  lids: readonly HTMLElement[];
}

/** Timers the engine schedules on, injectable for a test's clock. */
export interface PoseClock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const REAL_CLOCK: PoseClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

const BADGE_SWAP_OUT_MS = 110;
const BADGE_SWAP_GAP_MS = 60;
/** The ask badge's longer boing is a different landing weight from the ordinary pop. */
const BADGE_BOING_MS = 420;
/** How long a blink holds the lids down. */
const BLINK_MS = 130;
/** How long a reduced one-shot stands before it settles. */
const REDUCED_SETTLE_MS = 900;

export class PoseEngine {
  private anims: Animation[] = [];
  /** Standing loops by the declaration that started them, kept across re-applies of the same track. */
  private loops = new Map<PoseTrack, Animation>();
  private timers: unknown[] = [];
  private pending: unknown;
  private worn: PoseName | null = null;
  private wornAt = 0;
  private wornReduced: boolean | null = null;
  private badge: BadgeId | null = null;
  private badgeAngle = 0;
  /** The badge a garnish shows over the pose's own, until its timer restores it. */
  private garnishBadge: unknown;
  private reduced = false;

  constructor(
    private readonly parts: PoseParts,
    /** Tells the renderer which badge to mount. */
    private readonly onBadge: (id: BadgeId | null) => void,
    /** The ordinary badge pop's length, in ms. */
    private readonly popMs: number,
    private readonly clock: PoseClock = REAL_CLOCK,
  ) {}

  /** The pose she is wearing. */
  get wearing(): PoseName | null { return this.worn; }

  /**
   * Asks for a pose. One gesture at a time: a pose asked for inside the worn one's dwell lands when
   * the dwell ends, the newest asked winning; the first pose and every reduced one land at once.
   */
  wear(pose: PoseName, reduced: boolean): void {
    this.reduced = reduced;
    if (this.pending !== undefined) { this.clock.clear(this.pending); this.pending = undefined; }
    if (this.worn === pose && this.wornReduced === reduced) return;
    const wait = this.worn === null || reduced ? 0 : POSE_DWELL - (this.clock.now() - this.wornAt);
    this.wornReduced = reduced;
    if (wait <= 0) this.apply(pose);
    else this.pending = this.clock.set(() => { this.pending = undefined; this.apply(pose); }, wait);
  }

  /** Connect's rise, played outside the pose machine so the pose that lands under it cannot cancel it. */
  wake(): void {
    if (this.reduced || this.worn !== 'sleeping') return;
    this.animate(this.parts.pose, WAKE_BEAT.keyframes, { duration: WAKE_BEAT.dur, easing: WAKE_BEAT.easing });
  }

  /** The press squash, additive so the breath goes on underneath. */
  acknowledge(): void {
    if (this.reduced) return;
    this.animate(this.parts.body, PRESS_SQUASH.keyframes, {
      duration: PRESS_SQUASH.dur, easing: PRESS_SQUASH.easing,
      ...(PRESS_SQUASH.composite ? { composite: PRESS_SQUASH.composite } : {}),
    });
  }

  /** Plays one-shots over the worn pose, and shows a badge for a while where one is named. */
  garnish(moves: readonly Garnish[], badge?: { id: BadgeId; ms: number }): void {
    if (badge) {
      if (this.garnishBadge !== undefined) this.clock.clear(this.garnishBadge);
      this.setBadge(badge.id);
      this.garnishBadge = this.clock.set(() => {
        this.garnishBadge = undefined;
        this.setBadge(this.worn ? POSES[this.worn].badge : null);
      }, badge.ms);
    }
    if (this.reduced) return;
    for (const move of moves) {
      this.animate(this.parts[move.part], move.keyframes as PoseKeyframe[], {
        duration: move.dur, easing: move.easing, delay: move.delay ?? 0, fill: 'none',
        ...(move.composite ? { composite: move.composite } : {}),
      });
    }
  }

  /** The dust under her feet when a jump lands, placed in layout coordinates beside her. */
  puff(): void {
    const el = this.parts.root;
    const layer = el.parentElement;
    if (!layer) return;
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
      if (!this.reduced && typeof d.animate === 'function') {
        d.animate(
          [
            { transform: 'translate(0,0) scale(.6)', opacity: 0.9 },
            { transform: `translate(${i * 10}px,${i === 0 ? 3 : -5}px) scale(1)`, opacity: 0 },
          ],
          { duration: PUFF.dur, easing: CURVES.out, delay: k * PUFF.stagger, fill: 'forwards' },
        );
      }
      this.timers.push(this.clock.set(() => d.remove(), PUFF.clearAfter));
    });
  }

  /** Ends every animation and timer; the next pose asked for is applied afresh. */
  dispose(): void {
    this.clearAll();
    for (const anim of this.loops.values()) anim.cancel();
    this.loops.clear();
    if (this.pending !== undefined) this.clock.clear(this.pending);
    if (this.garnishBadge !== undefined) this.clock.clear(this.garnishBadge);
    this.pending = undefined;
    this.garnishBadge = undefined;
    this.worn = null;
    this.wornReduced = null;
  }

  private apply(name: PoseName): void {
    const p = POSES[name];
    this.worn = name;
    this.wornAt = this.clock.now();
    this.clearAll();
    this.setLids(!!p.lids);
    if (this.garnishBadge === undefined) this.setBadge(p.badge, p.badgeCurve, p.badgeAt ?? 0);
    if (p.badgeOutAt) this.schedule(() => this.setBadge(null), p.badgeOutAt);
    if (this.reduced) {
      this.keepLoops([]);
      this.parts.pose.style.transform = p.static || '';
      if (p.staticBadge) this.setBadge(p.staticBadge);
      if (p.oneShot && p.settleTo) this.schedule(() => this.apply(p.settleTo!), REDUCED_SETTLE_MS);
      return;
    }
    (p.enter ?? []).forEach((tr) => this.schedule(() => this.play(tr, { fill: 'forwards' }), tr.at ?? 0));
    (p.seq ?? []).forEach((tr) => this.schedule(() => {
      this.play(tr, { fill: 'forwards' });
      if (tr.puffAt != null) this.schedule(() => this.puff(), tr.puffAt);
    }, tr.at ?? 0));
    this.keepLoops(p.loops ?? []);
    (p.timers ?? []).forEach((t) => this.armTimer(t));
    if (p.badgeTick) this.tickBadge(p.badgeTick);
    if (p.oneShot && p.settleTo) this.schedule(() => this.apply(p.settleTo!), p.settleAt ?? 0);
  }

  /** Everything the leaving pose owns except its loops, which `keepLoops` reconciles. */
  private clearAll(): void {
    this.anims.forEach((a) => a.cancel());
    this.anims = [];
    this.timers.forEach((t) => this.clock.clear(t));
    this.timers = [];
    for (const part of ['flip', 'pose', 'body'] as const) this.parts[part].style.transform = '';
  }

  /** Cancels the leaving pose's loops and starts the arriving pose's; a loop both declare keeps running. */
  private keepLoops(next: readonly PoseTrack[]): void {
    for (const [track, anim] of [...this.loops]) {
      if (next.includes(track) && anim.playState === 'running') continue;
      anim.cancel();
      this.loops.delete(track);
    }
    for (const tr of next) {
      if (this.loops.has(tr)) continue;
      this.schedule(() => {
        const anim = this.animate(this.parts[tr.part], tr.keyframes, {
          duration: tr.dur, easing: tr.easing, iterations: Infinity,
          ...(tr.composite ? { composite: tr.composite } : {}),
        });
        if (anim) this.loops.set(tr, anim);
      }, tr.at ?? 0);
    }
  }

  private schedule(fn: () => void, at: number): void {
    if (at <= 0) { fn(); return; }
    this.timers.push(this.clock.set(fn, at));
  }

  private play(tr: PoseTrack, opts: { fill?: FillMode }): void {
    const anim = this.animate(this.parts[tr.part], tr.keyframes, {
      duration: tr.dur, easing: tr.easing, fill: opts.fill ?? 'none',
      ...(tr.composite ? { composite: tr.composite } : {}),
    });
    if (!anim) return;
    // A finished forwards fill is replaceable: the browser removes it once a newer animation targets
    // the property, however that one composites. A pose's settled frame is a hold; the next pose ends it.
    if (opts.fill === 'forwards' && typeof anim.persist === 'function') anim.persist();
    this.anims.push(anim);
  }

  /** Starts an animation where the element can run one. */
  private animate(el: HTMLElement, keyframes: readonly PoseKeyframe[], opts: KeyframeAnimationOptions): Animation | null {
    return typeof el.animate === 'function' ? el.animate(keyframes as Keyframe[], opts) : null;
  }

  private setLids(down: boolean): void {
    for (const lid of this.parts.lids) lid.style.transform = down ? 'scaleY(1)' : 'scaleY(0)';
  }

  private micro(name: PoseTimer['run']): void {
    if (name === 'blink') {
      this.setLids(true);
      this.schedule(() => { if (!(this.worn && POSES[this.worn].lids)) this.setLids(false); }, BLINK_MS);
      return;
    }
    const m = MICRO[name];
    this.play(m, {});
  }

  private armTimer(t: PoseTimer): void {
    const wait = t.every + Math.random() * (t.jitter ?? 0);
    this.schedule(() => { this.micro(t.run); this.armTimer(t); }, wait);
  }

  private setBadge(id: BadgeId | null, curve?: 'boing', delay = 0): void {
    if (id === this.badge) return;
    const el = this.parts.badge;
    const showNew = () => {
      if (typeof el.getAnimations === 'function') el.getAnimations().forEach((a) => a.cancel());
      this.badge = id;
      this.badgeAngle = 0;
      this.parts.spin.style.transform = '';
      this.onBadge(id);
      if (!id) { el.style.transform = 'scale(0)'; return; }
      el.style.transform = 'scale(1)';
      if (this.reduced || typeof el.animate !== 'function') return;
      const kf: PoseKeyframe[] = curve === 'boing'
        ? [{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: 0.55 }, { transform: 'scale(.95)', offset: 0.8 }, { transform: 'scale(1)' }]
        : [{ transform: 'scale(0)' }, { transform: 'scale(1.18)', offset: 0.6 }, { transform: 'scale(1)' }];
      el.animate(kf as Keyframe[], { duration: curve === 'boing' ? BADGE_BOING_MS : this.popMs, easing: 'linear' });
    };
    if (this.badge && !this.reduced && typeof el.animate === 'function') {
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(0)' }], { duration: BADGE_SWAP_OUT_MS, easing: CURVES.inn, fill: 'forwards' });
      this.schedule(showNew, BADGE_SWAP_OUT_MS + BADGE_SWAP_GAP_MS + delay);
    } else {
      this.schedule(showNew, delay);
    }
  }

  private tickBadge(spec: { every: number; rotateBy: number; dur: number; easing: string }): void {
    const tick = () => {
      this.badgeAngle += spec.rotateBy;
      const spin = this.parts.spin;
      if (typeof spin.animate === 'function') {
        const from = spin.style.transform || 'rotate(0deg)';
        spin.style.transform = `rotate(${this.badgeAngle}deg)`;
        spin.animate([{ transform: from }, { transform: `rotate(${this.badgeAngle}deg)` }], { duration: spec.dur, easing: spec.easing });
      }
      this.timers.push(this.clock.set(tick, spec.every));
    };
    this.timers.push(this.clock.set(tick, spec.every));
  }
}

