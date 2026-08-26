/**
 * poses.ts — the one character's choreography, transcribed AS DATA from the normative
 * prototype's `POSES`/`MICRO`/`MORPH`/`CURVES` tables (`const POSES = {...}` and its
 * neighbours). `Character.tsx` is the one reader: it walks a `PoseSpec`'s `enter`/`seq`/`loops` tracks through the Web
 * Animations API exactly as the prototype's `makeCharacter`/`setPose` do, on `flip`/`pose`/`body`
 * — the three nested transform layers the prototype's DOM carries (flip for the asking mirror,
 * pose for the momentary lean/hop, body for the ambient sway/rock).
 *
 * `poseForPhase` is the SessionPhase → PoseName mapping: `celebrating` and `noted` are ONE-SHOTS
 * a caller triggers explicitly (a fresh `jobEnd(done)` edge, a note landing) and are therefore
 * never returned here — `SessionPhase` itself carries no member for either, so the shell observes
 * the edge instead of reading a phase value for it.
 *
 * THREE MORE POSES ARE OUTSIDE THE PHASE MAPPING FOR A DIFFERENT REASON: `keylean` and `pleased`
 * portray the SETUP screen, which stands in the job zone while the session has no phase worth
 * portraying (a keyless desk reads `sleeping` from the mapping), and `watching` portrays the map
 * holding the pencil. Each is passed in by the surface that owns the moment.
 */
import type { SessionPhase } from '../../../agent/core/project-view';
import type { BadgeId } from './badges';

export type PoseName =
  | 'idle' | 'thinking' | 'working' | 'asking' | 'celebrating'
  | 'paused' | 'trouble' | 'sleeping' | 'noted'
  | 'keylean' | 'pleased' | 'watching';

/** The three nested transform layers `Character.tsx` animates. Prototype: `.flip`/`.pose`/`.body`. */
export type BodyPart = 'flip' | 'pose' | 'body';

export interface PoseKeyframe {
  transform?: string;
  opacity?: number;
  offset?: number;
}

/** One WAAPI `.animate()` call: which part, when it starts (ms after the pose's own timers are
 *  armed, default 0), how long, on which curve. `puffAt` (seq only) fires the dust-puff effect
 *  that many ms after this track's OWN start. */
export interface PoseTrack {
  part: BodyPart;
  at?: number;
  dur: number;
  easing: string;
  keyframes: PoseKeyframe[];
  puffAt?: number;
  /** ADDITIVE, for a gesture that plays OVER a standing loop on the same part. A replacing animation
   *  takes the loop's own value off the element for as long as it runs and hands it back at the end,
   *  which reads as two hitches around a 120ms flick; `composite: 'add'` composes with it instead, so
   *  the breath goes on underneath. Every ambient micro-gesture is one of these. */
  composite?: CompositeOperation;
}

export interface PoseTimer {
  every: number;
  jitter?: number;
  run: 'blink' | 'earflick';
}

export interface BadgeTick {
  every: number;
  rotateBy: number;
  dur: number;
  easing: string;
}

export interface PoseSpec {
  /** The badge shown while this pose holds, or null for none. */
  badge: BadgeId | null;
  /** The pop-in curve `Character.tsx` gives the badge (default: the plain pop). */
  badgeCurve?: 'boing';
  /** Delay (ms) before the badge appears — a one-shot's badge lands mid-flight, not at pose start. */
  badgeAt?: number;
  /** A one-shot's badge time-out (ms), after which it clears itself. */
  badgeOutAt?: number;
  /** Whether this pose holds the eyelids down for its whole duration (sleeping only). */
  lids: boolean;
  /** Plays once, `fill:'forwards'`, when the pose is entered. */
  enter?: PoseTrack[];
  /** A one-shot's ordered beats, each `fill:'forwards'`. */
  seq?: PoseTrack[];
  /** Plays with `iterations:Infinity` for as long as the pose holds. */
  loops?: PoseTrack[];
  /** Ambient micro-gestures (blink, ear-flick) armed on a jittered interval while the pose holds. */
  timers?: PoseTimer[];
  /** `working`'s spinning-refresh badge: rotates the badge's own spin layer on a fixed beat. */
  badgeTick?: BadgeTick;
  /** A one-shot pose: plays its `seq` once, then settles to `settleTo` at `settleAt` ms. */
  oneShot?: boolean;
  settleTo?: PoseName;
  settleAt?: number;
  /** The reduced-motion still frame: the `pose` part's resting transform, applied with no
   *  animation at all. */
  static: string;
  /** The reduced-motion still badge, when it differs from `badge` (the two one-shots keep their
   *  badge showing at rest instead of clearing it). */
  staticBadge?: BadgeId;
}

export const CURVES = {
  snap: 'cubic-bezier(.2,1.5,.4,1)',
  pop: 'cubic-bezier(.3,1.9,.45,1)',
  boing: 'cubic-bezier(.25,2.4,.45,.9)',
  out: 'cubic-bezier(.2,.8,.3,1)',
  inn: 'cubic-bezier(.55,0,.8,.4)',
  ease: 'ease-in-out',
  beat: 'cubic-bezier(.4,0,.6,1)',
} as const;

export const POSES: Record<PoseName, PoseSpec> = {
  idle: {
    badge: null, lids: false,
    loops: [
      { part: 'body', dur: 3000, easing: CURVES.ease, keyframes: [
        { transform: 'scaleY(1)' }, { transform: 'scaleY(1.015)', offset: .5 }, { transform: 'scaleY(1)' }] },
    ],
    timers: [
      { every: 6000, jitter: 1500, run: 'blink' },
      { every: 13000, jitter: 4000, run: 'earflick' },
    ],
    static: '',
  },
  thinking: {
    badge: 'idea', lids: false,
    enter: [
      { part: 'pose', dur: 460, easing: CURVES.snap, keyframes: [
        { transform: 'rotate(0deg)' }, { transform: 'rotate(-2.5deg)', offset: .22 }, { transform: 'rotate(6deg)' }] },
    ],
    loops: [
      { part: 'body', dur: 1200, easing: CURVES.ease, keyframes: [
        { transform: 'rotate(-1.5deg)' }, { transform: 'rotate(1.5deg)', offset: .5 }, { transform: 'rotate(-1.5deg)' }] },
    ],
    timers: [{ every: 7000, jitter: 2000, run: 'blink' }],
    static: 'rotate(6deg)',
  },
  working: {
    badge: 'refresh', lids: false,
    loops: [
      { part: 'pose', dur: 420, easing: CURVES.beat, keyframes: [
        { transform: 'translateY(3px) scale(1.05,.94)' },
        { transform: 'translateY(-2px) scale(.97,1.04)', offset: .45 },
        { transform: 'translateY(3px) scale(1.05,.94)' }] },
      { part: 'body', dur: 840, easing: CURVES.ease, keyframes: [
        { transform: 'rotate(-1.6deg)' }, { transform: 'rotate(1.6deg)', offset: .5 }, { transform: 'rotate(-1.6deg)' }] },
    ],
    badgeTick: { every: 420, rotateBy: 90, dur: 150, easing: CURVES.snap },
    static: 'translateY(1px)',
  },
  asking: {
    badge: 'ask', badgeCurve: 'boing', lids: false,
    enter: [
      { part: 'flip', dur: 480, easing: CURVES.snap, keyframes: [
        { transform: 'scaleX(1)' }, { transform: 'scaleX(-1)', offset: .4 }, { transform: 'scaleX(1)' }] },
      { part: 'pose', at: 480, dur: 340, easing: CURVES.out, keyframes: [
        { transform: 'none' }, { transform: 'rotate(3.5deg) translateY(1px)' }] },
    ],
    loops: [
      { part: 'body', at: 820, dur: 2000, easing: CURVES.ease, keyframes: [
        { transform: 'translateY(0)' }, { transform: 'translateY(1.5px) rotate(.8deg)', offset: .5 }, { transform: 'translateY(0)' }] },
    ],
    timers: [{ every: 5200, jitter: 1200, run: 'blink' }],
    static: 'rotate(3.5deg) translateY(1px)',
  },
  celebrating: {
    badge: 'spark', badgeAt: 390, lids: false, oneShot: true, settleTo: 'idle', settleAt: 1350,
    seq: [
      { part: 'pose', at: 0, dur: 150, easing: CURVES.inn, keyframes: [
        { transform: 'none' }, { transform: 'translateY(3px) scale(1.1,.88)' }] },
      { part: 'pose', at: 150, dur: 240, easing: CURVES.out, keyframes: [
        { transform: 'translateY(3px) scale(1.1,.88)' }, { transform: 'translateY(-17px) scale(.9,1.12)' }] },
      { part: 'pose', at: 390, dur: 180, easing: CURVES.inn, keyframes: [
        { transform: 'translateY(-17px) scale(.9,1.12)' }, { transform: 'translateY(2px) scale(1.12,.86)' }], puffAt: 170 },
      { part: 'pose', at: 570, dur: 200, easing: CURVES.out, keyframes: [
        { transform: 'translateY(2px) scale(1.12,.86)' }, { transform: 'translateY(-7px) scale(.96,1.05)' }] },
      { part: 'pose', at: 770, dur: 160, easing: CURVES.inn, keyframes: [
        { transform: 'translateY(-7px) scale(.96,1.05)' }, { transform: 'translateY(1px) scale(1.06,.93)' }], puffAt: 150 },
      { part: 'pose', at: 930, dur: 300, easing: CURVES.snap, keyframes: [
        { transform: 'translateY(1px) scale(1.06,.93)' }, { transform: 'none' }] },
    ],
    static: '', staticBadge: 'spark',
  },
  paused: {
    badge: 'pause', lids: false,
    enter: [
      { part: 'pose', dur: 600, easing: CURVES.out, keyframes: [
        { transform: 'none' }, { transform: 'translateY(4px) rotate(-2.5deg) scaleY(.97)' }] },
    ],
    loops: [
      { part: 'body', at: 600, dur: 3400, easing: CURVES.ease, keyframes: [
        { transform: 'scaleY(1)' }, { transform: 'scaleY(.982) translateY(1px)', offset: .38 },
        { transform: 'scaleY(.982) translateY(1px)', offset: .55 }, { transform: 'scaleY(1)' }] },
    ],
    timers: [{ every: 9000, jitter: 2500, run: 'blink' }],
    static: 'translateY(4px) rotate(-2.5deg) scaleY(.97)',
  },
  trouble: {
    badge: 'exclaim', lids: false,
    enter: [
      { part: 'pose', dur: 520, easing: CURVES.out, keyframes: [
        { transform: 'none' },
        { transform: 'translate(-9px,-5px) scale(.96,1.06)', offset: .25 },
        { transform: 'translate(-3px,0) scale(1.05,.95)', offset: .45 },
        { transform: 'translateX(-5px)', offset: .62 },
        { transform: 'translateX(-1px)', offset: .78 },
        { transform: 'translateX(-3px) rotate(-2deg)' }] },
    ],
    loops: [
      { part: 'body', at: 520, dur: 110, easing: 'linear', keyframes: [
        { transform: 'translateX(-.6px)' }, { transform: 'translateX(.6px)', offset: .5 }, { transform: 'translateX(-.6px)' }] },
    ],
    static: 'translateX(-3px) rotate(-2deg)',
  },
  sleeping: {
    badge: 'zzz', lids: true,
    enter: [
      { part: 'pose', dur: 900, easing: CURVES.out, keyframes: [
        { transform: 'none' }, { transform: 'translateY(7px) rotate(-4deg) scaleY(.94)' }] },
    ],
    loops: [
      // THE SLEEPING BREATH IS TWO-AXIS, and the 1% narrowing is what makes it read as a chest rather
      // than a vertical stretch: at 72px of art the rise is 2.8px against 1.9px for a scaleY-only
      // 1.03.
      { part: 'body', at: 900, dur: 3600, easing: CURVES.ease, keyframes: [
        { transform: 'scale(1,1)' }, { transform: 'scale(.99,1.045)', offset: .5 }, { transform: 'scale(1,1)' }] },
    ],
    static: 'translateY(7px) rotate(-4deg) scaleY(.94)',
  },
  // THE KEY-ENTRY PAIR. Since B-below the provider ROW under the field carries the verdict; these
  // DOUBLE it as reaction garnish and never carry it alone, which is why the reading one wears no
  // badge at all. A REFUSED KEY IS `trouble`: the hop back and the worried tremble is the one face
  // the panel has for something going wrong, and a second droop with the same exclaim beside it was
  // one gesture said twice.
  keylean: {
    badge: null, lids: false,
    enter: [
      { part: 'pose', dur: 520, easing: CURVES.snap, keyframes: [
        { transform: 'none' }, { transform: 'rotate(-2.5deg)', offset: .22 }, { transform: 'rotate(9deg) translateY(1px)' }] },
    ],
    loops: [
      { part: 'body', at: 520, dur: 2600, easing: CURVES.ease, keyframes: [
        { transform: 'scaleY(1)' }, { transform: 'scaleY(1.012)', offset: .5 }, { transform: 'scaleY(1)' }] },
    ],
    timers: [{ every: 5200, jitter: 1400, run: 'blink' }],
    static: 'rotate(9deg) translateY(1px)',
  },
  // A HOLDING pose, not a one-shot: the confirmation stands until the gate moves the screen on, so
  // there is no `settleTo` and the spark stays lit while the provider is confirmed.
  pleased: {
    badge: 'spark', badgeAt: 300, badgeCurve: 'boing', lids: false,
    enter: [
      { part: 'pose', at: 0, dur: 140, easing: CURVES.inn, keyframes: [
        { transform: 'none' }, { transform: 'translateY(3px) scale(1.08,.9)' }] },
      { part: 'pose', at: 140, dur: 220, easing: CURVES.out, keyframes: [
        { transform: 'translateY(3px) scale(1.08,.9)' }, { transform: 'translateY(-12px) scale(.94,1.08)' }] },
      { part: 'pose', at: 360, dur: 260, easing: CURVES.snap, keyframes: [
        { transform: 'translateY(-12px) scale(.94,1.08)' }, { transform: 'translateY(-2px)' }] },
    ],
    loops: [
      { part: 'body', at: 620, dur: 2400, easing: CURVES.ease, keyframes: [
        { transform: 'scaleY(1)' }, { transform: 'scaleY(1.02)', offset: .5 }, { transform: 'scaleY(1)' }] },
    ],
    static: 'translateY(-2px)', staticBadge: 'spark',
  },
  // The mirror of `keylean`: she turns AWAY from the panel, toward the map, for the one state where
  // the map holds the pencil and the panel is only watching.
  watching: {
    badge: null, lids: false,
    enter: [
      { part: 'pose', dur: 520, easing: CURVES.snap, keyframes: [
        { transform: 'none' }, { transform: 'rotate(2deg)', offset: .22 }, { transform: 'rotate(-8deg) translateX(-2px)' }] },
    ],
    loops: [
      { part: 'body', at: 520, dur: 2600, easing: CURVES.ease, keyframes: [
        { transform: 'scaleY(1)' }, { transform: 'scaleY(1.012)', offset: .5 }, { transform: 'scaleY(1)' }] },
    ],
    timers: [{ every: 5200, jitter: 1400, run: 'blink' }],
    static: 'rotate(-8deg) translateX(-2px)',
  },
  noted: {
    badge: 'note', badgeAt: 60, badgeOutAt: 950, lids: false, oneShot: true, settleTo: 'idle', settleAt: 1150,
    seq: [
      { part: 'body', at: 0, dur: 90, easing: CURVES.out, keyframes: [
        { transform: 'none' }, { transform: 'scaleY(1.045)' }] },
      { part: 'pose', at: 90, dur: 260, easing: CURVES.snap, keyframes: [
        { transform: 'none' }, { transform: 'rotate(4deg) translateY(2px)', offset: .45 }, { transform: 'none' }] },
      { part: 'body', at: 350, dur: 180, easing: CURVES.out, keyframes: [
        { transform: 'scaleY(1.045)' }, { transform: 'none' }] },
    ],
    static: '', staticBadge: 'note',
  },
};

/**
 * THE CONNECT-PRESS WAKE BEAT (prototype: the `connect` handler's own frames). Pressing Connect on
 * the keyless rest, she rises OUT of the sleeping rest as the key screen lands: the first frame IS
 * the sleeping still, so there is no jump, the .62 frame passes neutral with a slight stretch, and
 * the landing is plain `none` on the overshoot curve.
 *
 * NO FILL AND OUTSIDE THE POSE MACHINE, both load-bearing: the key screen's rest (`idle`) drives no
 * pose-part track, so the beat plays out under it, and anything that moves the pose inside the beat
 * (a fast paste bringing `keylean` in) starts a newer animation on the same part and takes over —
 * the wake yields by construction. `Character.tsx`'s `wake` verb is the one player.
 */
export const WAKE_BEAT: PoseTrack = {
  part: 'pose', dur: 620, easing: CURVES.snap, keyframes: [
    { transform: 'translateY(7px) rotate(-4deg) scaleY(.94)' },
    { transform: 'translateY(-3px) rotate(1deg) scaleY(1.03)', offset: .62 },
    { transform: 'none' },
  ],
};

/**
 * Her acknowledgement when she is pressed: one springy squash in place (prototype `PRESS_SQUASH` /
 * `heroAcknowledge`). ADDITIVE for the ear-flick's reason — the breath loops on the same part and
 * property. `Character.tsx`'s `acknowledge` verb is the one player.
 */
export const PRESS_SQUASH: PoseTrack = {
  part: 'body', dur: 320, easing: 'linear', composite: 'add', keyframes: [
    { transform: 'scale(1,1)', offset: 0 },
    { transform: 'scale(1.12,.86)', offset: .3 },
    { transform: 'scale(.95,1.06)', offset: .62 },
    { transform: 'scale(1,1)', offset: 1 },
  ],
};

/**
 * Ambient one-shot gestures a pose's `timers` fire on a jittered interval. Prototype `MICRO`.
 *
 * ADDITIVE, because the part it plays on is the part the breath loops on: an ear-flick that REPLACED
 * the transform dropped the breath to its rest value for its own 120ms and snapped it back at the end,
 * which is a stutter in a loop that is meant to be uninterrupted. Same rule the dreaming office's
 * twitch already follows.
 */
export const MICRO: Record<'earflick', PoseTrack> = {
  earflick: { part: 'body', dur: 120, easing: CURVES.out, composite: 'add', keyframes: [
    { transform: 'rotate(0deg)' }, { transform: 'rotate(2deg)', offset: .5 }, { transform: 'rotate(0deg)' }] },
};

/**
 * HOW LONG A POSE IS WORN BEFORE ANOTHER ONE MAY LAND, in ms.
 *
 * A pose is a GESTURE, and a gesture cut short of its own length reads as a convulsion: the
 * session's phase is derived from the streaming parts, so it moves several times a second inside one
 * turn (a tool call appearing reads as `executing`, the text after it as `streaming`), and a pose
 * landing on every move restarts the entrance several times a second (measured live at a 140ms
 * input: 142 restarts in 20 seconds).
 *
 * So a pose asked for inside this window is REMEMBERED rather than worn, and the newest one lands when
 * the window closes — one gesture at a time, whatever the phase does. It is a little longer than the
 * longest entrance in the table (`thinking`, 460ms) so the entrance that is playing is never the thing
 * that is interrupted.
 */
export const POSE_DWELL = 520;

/** The dust three puffs kick up under the feet as a jump lands: how long one takes, how far apart
 *  they are struck, and how long after that the element is taken out of the layer (past the end, so
 *  the last frame is not swept away mid-paint). `Character.tsx:puff` is the one reader. */
export const PUFF = { dur: 340, stagger: 20, clearAfter: 460 };

/**
 * The SessionPhase → PoseName mapping (spec 0.2's state-inventory table). `connected: false` wins
 * outright — a disconnected session shows `sleeping` whatever phase the log last recorded, since
 * there's nothing running to portray. `aborted` settles to `idle` (a stopped session is not mid
 * job and not in trouble). `celebrating`/`noted` are one-shots outside this mapping — see the
 * file header.
 */
export function poseForPhase(phase: SessionPhase, opts: { connected: boolean }): PoseName {
  if (!opts.connected) return 'sleeping';
  switch (phase) {
    case 'idle': return 'idle';
    case 'thinking': case 'streaming': return 'thinking';
    case 'executing': return 'working';
    case 'gated': return 'asking';
    case 'retrying': case 'incident': return 'trouble';
    case 'paused': case 'pausing': return 'paused';
    case 'aborted': return 'idle';
    default: {
      // Exhaustiveness guard: a new SessionPhase member must be mapped above, not silently
      // dropped here as idle.
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
