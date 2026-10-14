/* The app-wide character's drawing; her choreography is `pose-engine.ts`, her placement `seat.ts`. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { amplitude, cssMotion, framerMotion, seconds } from '../../design/motion';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { characterArt } from '../../../assets/agent/agent-art';
import { PLATE, PLATE_INK } from '../../design/tokens';
import { BREATH_FILL, BREATH_RIM, LID_LASH_INK, LID_SKIN } from '../../design/drawing-palette';
import { edge } from '../panel-skin';
import { Icon, type IconId } from '../parts/sprite';
import { DREAM } from '../sketchbook/sketch-motion';
import { Badge, type BadgeId } from './badges';
import { EYE_DOTS, lashWidth, lidBox } from './eyes';
import type { BodyPart, PoseName } from './poses';
import { onCharacterCue, useCharacterIntent } from './intent';
import { PoseEngine } from './pose-engine';
import { cursors } from '../../design/styles';
import { useUiPreview } from '../../design/preview';

/** The live character's element and parts, for the seat module to place. */
export interface CharacterHandle {
  el: HTMLDivElement;
  parts: Record<BodyPart, HTMLDivElement>;
}

let liveHandle: CharacterHandle | null = null;

/** The one live character, for `seat.ts` to place; null before her first mount and after she goes. */
export function getCharacterHandle(): CharacterHandle | null {
  return liveHandle;
}

/** The new badge popping in with overshoot, from its own declaration. */
const BADGE_POP_IN_MS = seconds('panel.badge.pop') * 1000;

/** Where a caller hands her the press: she is the assistant's own control over the block below. */
interface CharacterPress {
  onPress(): void;
  /** Whether the panel she opens is standing, for the block below to agree with. */
  open: boolean;
}

/** How far she grows under a pointer: the shared hover growth, read through her own declaration. */
const HOVER = { scale: 1 + (amplitude('panel.character.hover') ?? 0) };

/**
 * The character. Her pose comes from the caller; surfaces drive her through `intent.ts`. A pictured
 * mount (a Help figure's panel) draws her and listens to no surface, so a figure never acts on the
 * live character's channel.
 */
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
  const pictured = useUiPreview();
  const live = useCharacterIntent();
  const dream = pictured ? 'off' : live.dream;
  const engine = useRef<PoseEngine | null>(null);
  const asked = useRef({ pose, reduced });
  asked.current = { pose, reduced };

  // One engine for her life; StrictMode's remount builds a fresh one over the same parts.
  useEffect(() => {
    const parts = [rootRef, flipRef, poseRef, bodyRef, badgeRef, spinRef, lidLRef, lidRRef].map((r) => r.current);
    if (parts.some((el) => el === null)) return undefined;
    const [root, flip, poseEl, body, badge, spin, lidL, lidR] = parts as HTMLDivElement[];
    const built = new PoseEngine(
      { root: root!, flip: flip!, pose: poseEl!, body: body!, badge: badge!, spin: spin!, lids: [lidL!, lidR!] }, setShownBadge, BADGE_POP_IN_MS,
    );
    engine.current = built;
    built.wear(asked.current.pose, asked.current.reduced);
    const handle: CharacterHandle | null = pictured ? null : { el: root!, parts: { flip: flip!, pose: poseEl!, body: body! } };
    if (handle) liveHandle = handle;
    const off = pictured ? () => {} : onCharacterCue((cue) => {
      if (cue.kind === 'wake') built.wake();
      else if (cue.kind === 'acknowledge') built.acknowledge();
      else built.garnish(cue.moves, cue.badge);
    });
    return () => {
      off();
      built.dispose();
      engine.current = null;
      if (handle && liveHandle === handle) liveHandle = null;
    };
  }, [pictured]);

  useEffect(() => { engine.current?.wear(pose, reduced); }, [pose, reduced]);

  return (
    <motion.div
      ref={rootRef}
      data-testid="pw-character"
      data-pose={pose}
      {...(press
        ? {
          onClick: () => { engine.current?.acknowledge(); press.onPress(); },
          whileHover: HOVER,
          transition: framerMotion('panel.character.hover'),
          // The block underneath carries the label and the focus ring, so the drawing is not a second control.
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
                // The dream plume takes the shoulder while it stands.
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

/** One closed-eye lid over its eye (`face.ts` derives it); `border-box` keeps the lash inside the stated oval. */
function lidStyle(side: 'l' | 'r', size: number): CSSProperties {
  const box = lidBox(EYE_DOTS[side]);
  return {
    position: 'absolute',
    left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`,
    boxSizing: 'border-box',
    borderRadius: '50%', background: LID_SKIN,
    borderBottom: `${lashWidth(size)}px solid ${LID_LASH_INK}`,
    transform: 'scaleY(0)', transformOrigin: '50% 20%', transition: cssMotion('character.blink.lid', ['transform']),
  };
}

/** The badge box, shared by the pose's own badge and the dream plume: the same shoulder, so the one
 *  stands exactly where the other did. */
const BADGE_BOX: CSSProperties = {
  position: 'absolute', top: '-8%', right: '-10%', width: '44%', height: '40%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/**
 * The sleeper's plume: the zzz, the dreamed order's glyph and one breath. It sits outside the pose and
 * the badge machine. The glyph's disc stays mounted so its transition has a previous state.
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
