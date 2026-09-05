/*
 * camera.tsx — the camera page's 3D figure: a DEMO in the 2D demos' own grammar, over a recording
 * of the real 3D renderer. One hidden scene (`canvas/map3d/capture`) photographs the visitor's
 * island along a continuous camera path walking EVERY 3D gesture the page teaches (the drag that
 * turns, the drag that tilts, the wheel's dolly, the sideways scroll that also turns, the pan) and
 * plays it back with the shipped cursor performing each gesture in lockstep: the pointer's travel
 * and the view's swing are one frame index, so hand and picture can never disagree. The gesture's
 * own chip (the hint bar's tokens) and a phase caption ride under the film and change with it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { captureCard3dAngles } from '../../../export/render-preview-bridge';
import type { CameraAngle } from '../../../../../../canvas/map3d/capture';
import type { GridState } from '../../../../../../core/model/types';
import { isMotionReduced } from '../../../../../../canvas/map2d/motion-state';
import { useKeybinds } from '../../../../../../core/runtime/keybindings';
import { useT } from '../../../../../../i18n/context';
import { resolveTokenSpecs, type TokenSpec } from '../../../../../hints/catalogue';
import { HintTokens } from '../../../../../hints/tokens';
import { LoadingDots } from '../../../../../primitives/LoadingDots';
import { PLATE_INK } from '../../../../../design/tokens';
import { figureCaption } from '../caption';
import { drawCursorImg } from '../demo-cursor';
import { useInView } from '../use-in-view';
import { useShownMap } from './share';
import { PreviewFrame } from './PreviewFrame';

/** The path's resting pose; each phase moves ONE thing away from it and back is played by the
 *  ping-pong, so neighbouring phases always join without a jump. */
const BASE_AZ = 60;
const BASE_EL = 40;
const BASE_DIST = 0.9;

/** Playback pace. The film is dense (see the phase frame counts) so this rate reads as motion. */
const FRAME_MS = 50;

/** Where the performing hand travels over one phase, in fractions of the picture box. */
type HandPath = (k: number) => { x: number; y: number };

interface Phase {
  frames: number;
  labelKey: string;
  tokens: readonly TokenSpec[];
  /** The camera at progress k (0..1) through this phase. */
  angle: (k: number) => CameraAngle;
  hand: HandPath;
}

const orbitDrag: readonly TokenSpec[] = [
  { kind: 'mouse', button: 'right', mark: 'drag' }, { kind: 'sep', sep: 'or' }, { kind: 'mouse', button: 'middle', mark: 'drag' },
];
const wheelScroll: readonly TokenSpec[] = [{ kind: 'mouse', button: 'wheel', mark: 'scroll' }];
const wheelSideways: readonly TokenSpec[] = [{ kind: 'mouse', button: 'wheel', mark: 'hscroll' }];
const leftDrag: readonly TokenSpec[] = [{ kind: 'mouse', button: 'left', mark: 'drag' }];

/** Every gesture the page teaches, in the order the film performs them. Each phase starts where
 *  the previous one ended (the moved axis returns via a small closing sweep where needed). */
const PHASES: readonly Phase[] = [
  // Turn: right-drag (or middle-drag, the stated equivalent) left to right, azimuth with the hand.
  {
    frames: 26, labelKey: 'help.camera.fig_orbit', tokens: orbitDrag,
    angle: (k) => ({ az: BASE_AZ - 55 + 110 * k, el: BASE_EL, dist: BASE_DIST }),
    hand: (k) => ({ x: 0.22 + 0.56 * k, y: 0.6 }),
  },
  // Tilt: the same drag upward, elevation climbing; azimuth stays where the turn ended.
  {
    frames: 12, labelKey: 'help.camera.fig_tilt', tokens: orbitDrag,
    angle: (k) => ({ az: BASE_AZ + 55, el: BASE_EL + 26 * k, dist: BASE_DIST }),
    hand: (k) => ({ x: 0.78, y: 0.6 - 0.3 * k }),
  },
  // Dolly: the wheel pulls the camera in and back out; the pointer stands still over the island.
  {
    frames: 18, labelKey: 'help.camera.fig_dolly', tokens: wheelScroll,
    angle: (k) => ({ az: BASE_AZ + 55, el: BASE_EL + 26, dist: BASE_DIST - 0.42 * Math.sin(Math.PI * k) }),
    hand: () => ({ x: 0.52, y: 0.45 }),
  },
  // Turning again, this time by a SIDEWAYS scroll (or a touchpad twist): the view swings back
  // while the pointer never moves, which is exactly what tells the two turn inputs apart.
  {
    frames: 14, labelKey: 'help.camera.fig_hturn', tokens: wheelSideways,
    angle: (k) => ({ az: BASE_AZ + 55 - 70 * k, el: BASE_EL + 26, dist: BASE_DIST }),
    hand: () => ({ x: 0.52, y: 0.45 }),
  },
  // Pan: left-drag carries the view sideways, the target sliding with the hand.
  {
    frames: 16, labelKey: 'help.camera.fig_pan', tokens: leftDrag,
    angle: (k) => ({ az: BASE_AZ - 15, el: BASE_EL + 26, dist: BASE_DIST, tx: 14 * k }),
    hand: (k) => ({ x: 0.66 - 0.36 * k, y: 0.5 }),
  },
];

const TOTAL_FRAMES = PHASES.reduce((n, p) => n + p.frames, 0);

/** Frame index → its phase and the progress through it. */
function phaseAt(at: number): { phase: Phase; k: number } {
  let i = at;
  for (const phase of PHASES) {
    if (i < phase.frames) return { phase, k: phase.frames > 1 ? i / (phase.frames - 1) : 1 };
    i -= phase.frames;
  }
  const last = PHASES[PHASES.length - 1]!;
  return { phase: last, k: 1 };
}

function cameraPath(): CameraAngle[] {
  const frames: CameraAngle[] = [];
  for (let at = 0; at < TOTAL_FRAMES; at++) {
    const { phase, k } = phaseAt(at);
    frames.push(phase.angle(k));
  }
  return frames;
}

/** One recording per subject map, cached while the help stays open. */
let recording: { state: GridState; frames: Promise<HTMLImageElement[]> } | null = null;

function recordFor(state: GridState): Promise<HTMLImageElement[]> {
  if (!recording || recording.state !== state) {
    recording = { state, frames: captureCard3dAngles(state, cameraPath(), 320).catch(() => []) };
  }
  return recording.frames;
}

/** The recording, performed: the shipped pan cursor walks each gesture while the view answers it,
 *  forward and back on a loop, the gesture chip and caption switching with the phase. Under
 *  reduced motion the film holds a mid-turn frame and the cursor rests. */
export function Camera3dPreview() {
  const t = useT();
  const overrides = useKeybinds((s) => s.overrides);
  const state = useShownMap();
  const [frames, setFrames] = useState<HTMLImageElement[]>([]);
  const still = useRef(isMotionReduced());
  const [at, setAt] = useState(0);
  const cursorEl = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // The 3D captures wait for the reader to approach: the film is the page's most expensive figure.
  const inView = useInView(hostRef);
  useEffect(() => {
    if (!state || !inView) return undefined;
    let live = true;
    void recordFor(state).then((imgs) => {
      if (!live) return;
      setFrames(imgs);
      if (still.current) setAt(Math.floor(PHASES[0]!.frames / 2));
    });
    return () => { live = false; };
  }, [state, inView]);
  useEffect(() => {
    if (still.current || frames.length < 2) return undefined;
    let i = 0;
    const span = frames.length * 2 - 2;
    const timer = setInterval(() => {
      i = (i + 1) % span;
      setAt(i < frames.length ? i : span - i);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [frames]);
  useEffect(() => {
    if (cursorEl.current) drawCursorImg(cursorEl.current, 'move');
  }, [frames]);
  const { phase, k } = phaseAt(at);
  const dragTokens = useMemo(() => resolveTokenSpecs(phase.tokens, overrides), [phase, overrides]);
  const frame = frames[at] ?? null;
  const hand = phase.hand(k);
  return (
    <div ref={hostRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
      <PreviewFrame height={250}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {frame
            ? <img src={frame.src} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 10, display: 'block' }} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 420, height: 240 }}><LoadingDots color={PLATE_INK} /></div>}
          {frame && (
            <div
              ref={cursorEl}
              aria-hidden
              style={{ position: 'absolute', left: `${hand.x * 100}%`, top: `${hand.y * 100}%`, width: 0, height: 0, pointerEvents: 'none' }}
            />
          )}
        </div>
      </PreviewFrame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {dragTokens && <HintTokens tokens={dragTokens} />}
        <div style={figureCaption({ role: 'chip', padding: '3px 12px', nowrap: true })}>{t(phase.labelKey)}</div>
      </div>
    </div>
  );
}
