/*
 * Idle card cycling through proposals derived from the open map. Sketch geometry uses the live map
 * capture's cell frame. A mask reveal preserves dashed lines as they draw. The component owns one rAF
 * loop while mounted; reduced motion shows the first completed sketch. Selecting a proposal fills and
 * focuses the composer without sending it.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotionConfig } from 'framer-motion';

import { seaFrame } from '../../../view/map2d/capture/thumbnail';
import { WATER_COLOR } from '../../../core/model/palette';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { INK, INSET, PLATE, PLATE_INK, TRACK, rgbaOf } from '../../design/tokens';
import { cursors, font, radii } from '../../design/styles';
import { roleFont, LINE_HEIGHT } from '../../design/text-weight';
import { ActionButton } from '../../primitives/ActionButton';
import { LoadingDots } from '../../primitives/LoadingDots';
import { cueCharacter } from '../character/intent';
import { Icon } from '../parts/sprite';
import { MapShot } from '../parts/map-shot';
import { edge, POSTCARD } from '../panel-skin';
import type { SketchArt, SketchIdea } from './propose';
import { GARNISH, RITUALS, SCRIBBLE_BADGE_MS, SKETCH, type Beat } from './sketch-motion';
import { LOADING_DOT, SCALE } from '../../shell/units';
import { MASK_KEEP } from '../../design/drawing-palette';
import { useEffectEvent } from '../../primitives/use-effect-event';

/** Full-width card thumbnail size in CSS pixels. */
const THUMB = { width: POSTCARD.width, height: 172 } as const;

/** The tracing-paper wash over the live map, strong enough that the dashed proposal reads as a plan over it. */
const WASH = rgbaOf(PLATE, 0.45);

/** The pencil. Measures are shares of the picture's width so line weight holds across map sizes; `MIN_*` floors keep figures visible on small maps. */
const PENCIL = rgbaOf(INK, 0.8);
const PENCIL_SOFT = rgbaOf(INK, 0.5);
const STROKE_SHARE = 0.0095;
const DASH_SHARE = { on: 0.029, off: 0.0224 } as const;
/** A pip is a mark on a tree, not a drawing of one: it reads at this share however small the tree. */
const PIP_SHARE = 0.017;
const MIN_STROKE = 0.6;
const MIN_DASH = 1.4;
/** How much wider than the line the mask's reveal stroke is, so a round cap is never clipped. */
const MASK_BLEED_SHARE = 1.5;

/** What the built thing would look like, under the dashes: the road's own pale band, the pond's own
 *  water, the deck's shadow. No colour is invented for a sketch. */
const GHOST_BAND = TRACK;
const GHOST_DECK = rgbaOf(INK, 0.35);

const CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  border: edge,
  borderRadius: radii.md,
  padding: 9,
  cursor: cursors.clickable,
  boxShadow: 'none',
};

const THUMB_STYLE: CSSProperties = {
  display: 'block',
  position: 'relative',
  height: THUMB.height,
  borderRadius: radii.md - 4,
  overflow: 'hidden',
  border: edge,
  background: WATER_COLOR,
};

const CAP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 7,
  minHeight: 38,
};

/** A quadratic curve's length, near enough for a dash pattern: the mean of the control polygon and
 *  the chord. Computed rather than measured, so the draw-in needs no live SVG geometry. */
function curveLength(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const poly = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y);
  return (poly + Math.hypot(c.x - a.x, c.y - a.y)) / 2;
}

/** Ramanujan's ellipse perimeter. */
function ellipseLength(rx: number, ry: number): number {
  const h = ((rx - ry) ** 2) / ((rx + ry) ** 2);
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** One drawn element of a figure: its own `d`, and how long that path is. */
interface Stroke { d: string; len: number; width: number; ink: string }

/** The drawing's own measures at the size this picture is: `u` is the frame's width in cells. */
function pencil(u: number) {
  return {
    stroke: Math.max(MIN_STROKE, u * STROKE_SHARE),
    dash: `${Math.max(MIN_DASH, u * DASH_SHARE.on)} ${Math.max(MIN_DASH, u * DASH_SHARE.off)}`,
    pip: u * PIP_SHARE,
  };
}

function strokesOf(art: SketchArt, u: number): Stroke[] {
  const { stroke, pip: pipR } = pencil(u);
  if (art.shape === 'lane') {
    const d = `M ${art.from.x} ${art.from.y} Q ${art.via.x} ${art.via.y} ${art.to.x} ${art.to.y}`;
    return [{ d, len: curveLength(art.from, art.via, art.to), width: stroke, ink: PENCIL }];
  }
  if (art.shape === 'pond') {
    // The ellipse as a two-arc path, so one code path draws every figure and one mask reveals it.
    const d = `M ${art.cx - art.rx} ${art.cy}`
      + ` A ${art.rx} ${art.ry} 0 1 1 ${art.cx + art.rx} ${art.cy}`
      + ` A ${art.rx} ${art.ry} 0 1 1 ${art.cx - art.rx} ${art.cy} Z`;
    return [{ d, len: ellipseLength(art.rx, art.ry), width: stroke, ink: PENCIL }];
  }
  if (art.shape === 'bridge') {
    const deck = `M ${art.x} ${art.y} h ${art.w} v ${art.h} h ${-art.w} Z`;
    const out: Stroke[] = [{ d: deck, len: 2 * (art.w + art.h), width: stroke, ink: PENCIL }];
    for (const [a, b] of art.approach) {
      out.push({
        d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
        len: Math.hypot(b.x - a.x, b.y - a.y),
        width: stroke * 0.85,
        ink: PENCIL_SOFT,
      });
    }
    return out;
  }
  return art.pips.map((tree) => {
    const r = Math.max(tree.r, pipR);
    return {
      d: `M ${tree.x - r} ${tree.y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`,
      len: 2 * Math.PI * r,
      width: stroke * 0.8,
      ink: tree.standing ? PENCIL : PENCIL_SOFT,
    };
  });
}

/** The pale shape of the thing itself, under the dashes. Absent for a grove: a stand of trees has no
 *  one silhouette, and its pips carry their own weight. */
function ghostOf(art: SketchArt, u: number): { node: ReactNode; to: number } | null {
  if (art.shape === 'lane') {
    return {
      node: (
        <path
          d={`M ${art.from.x} ${art.from.y} Q ${art.via.x} ${art.via.y} ${art.to.x} ${art.to.y}`}
          fill="none"
          stroke={GHOST_BAND}
          // The pavement the lane proposes, drawn no thinner than the pencil tracing it: a band
          // narrower than its own dashes reads as nothing at all.
          strokeWidth={Math.max(art.width, pencil(u).stroke * 1.8)}
          strokeLinecap="round"
        />
      ),
      to: SKETCH.ghostAlpha.band,
    };
  }
  if (art.shape === 'pond') {
    return {
      node: <ellipse cx={art.cx} cy={art.cy} rx={art.rx} ry={art.ry} fill={WATER_COLOR} />,
      to: SKETCH.ghostAlpha.fill,
    };
  }
  if (art.shape === 'bridge') {
    return {
      node: <rect x={art.x} y={art.y} width={art.w} height={art.h} rx={0.4} fill={GHOST_DECK} />,
      to: SKETCH.ghostAlpha.fill,
    };
  }
  return null;
}

/** Plays a WAAPI one-shot where the environment has one, and writes the end state either way. */
function play(el: Element | null | undefined, frames: Keyframe[], beat: Beat, extra?: KeyframeAnimationOptions): void {
  if (!el || typeof el.animate !== 'function') return;
  el.animate(frames, { duration: beat.dur, easing: beat.easing, delay: beat.delay ?? 0, fill: 'forwards', ...extra });
}

/** The map with one figure drawn on it, keyed by the idea so each proposal draws in on mount; `wiping` fades it out in place. */
function SketchPaper({ idea, wiping, still, mapVersion }: {
  idea: SketchIdea; wiping: boolean; still: boolean; mapVersion?: string | number;
}) {
  const template = useEditorStore((s) => s.gridState?.template);
  const maskBase = useId();
  const figureRef = useRef<SVGGElement>(null);
  const ghostRef = useRef<SVGGElement>(null);
  const revealRefs = useRef<(SVGPathElement | null)[]>([]);
  // The picture is composed with the template centred and the surplus filled with sea, so the
  // overlay's own viewBox is that composition and a cell lands where the capture put it.
  const sea = template ? seaFrame(template.width, template.height, THUMB.width / THUMB.height) : null;
  const strokes = strokesOf(idea.art, sea?.width ?? 1);
  const ghost = ghostOf(idea.art, sea?.width ?? 1);
  const dash = pencil(sea?.width ?? 1).dash;

  // The instance is keyed by its idea, so the figure draws once per idea and again when it stills.
  const draw = useEffectEvent(() => {
    const ghostEl = ghostRef.current;
    if (still) {
      revealRefs.current.forEach((el) => { if (el) el.style.strokeDashoffset = '0'; });
      if (ghostEl && ghost) ghostEl.style.opacity = String(ghost.to);
      return;
    }
    strokes.forEach((stroke, i) => {
      const el = revealRefs.current[i];
      if (!el) return;
      el.style.strokeDashoffset = String(stroke.len);
      const beat = idea.art.shape === 'grove' ? SKETCH.pip : SKETCH.draw;
      play(el, [{ strokeDashoffset: stroke.len }, { strokeDashoffset: 0 }], {
        ...beat, delay: (beat.delay ?? 0) + (beat.stagger ?? 0) * i,
      });
    });
    if (ghostEl && ghost) {
      ghostEl.style.opacity = '0';
      play(ghostEl, [{ opacity: 0 }, { opacity: ghost.to }], SKETCH.ghost);
    }
  });
  useEffect(() => { draw(); }, [still]);

  useEffect(() => {
    if (!wiping || still) return;
    play(figureRef.current, [{ opacity: 1 }, { opacity: 0 }], SKETCH.wipe);
  }, [wiping, still]);

  return (
    <span style={THUMB_STYLE} data-testid="sketch-thumb">
      <MapShot
        box={undefined}
        width={THUMB.width}
        height={THUMB.height}
        whole
        // The picture and the proposals are of one map. The grid is mutated in place, so without a
        // version the first capture would stand for the map's whole life and a lane read off a
        // map the photograph predates would be drawn on the wrong ground.
        {...(mapVersion !== undefined ? { version: mapVersion } : {})}
        placeholder={(
          <span style={{
            display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center',
          }}
          >
            <LoadingDots color={PLATE_INK} size={LOADING_DOT * SCALE} />
          </span>
        )}
      />
      <span
        data-testid="sketch-wash"
        style={{ position: 'absolute', inset: 0, background: WASH, pointerEvents: 'none' }}
      />
      <svg
        data-testid="sketch-figure"
        data-kind={idea.kind}
        viewBox={sea ? `0 0 ${sea.width} ${sea.height}` : '0 0 1 1'}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <defs>
          {strokes.map((stroke, i) => (
            <mask key={i} id={`${maskBase}-${i}`}>
              <path
                ref={(el) => { revealRefs.current[i] = el; }}
                d={stroke.d}
                fill="none"
                stroke={MASK_KEEP}
                strokeWidth={stroke.width * MASK_BLEED_SHARE}
                strokeLinecap="round"
                strokeDasharray={`${stroke.len} ${stroke.len}`}
                strokeDashoffset={still ? 0 : stroke.len}
              />
            </mask>
          ))}
        </defs>
        <g ref={figureRef} transform={sea ? `translate(${sea.dx} ${sea.dy})` : undefined}>
          {ghost && (
            <g ref={ghostRef} style={{ opacity: still ? ghost.to : 0 }}>{ghost.node}</g>
          )}
          {strokes.map((stroke, i) => (
            <path
              key={i}
              d={stroke.d}
              fill="none"
              stroke={stroke.ink}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeDasharray={dash}
              mask={`url(#${maskBase}-${i})`}
            />
          ))}
        </g>
      </svg>
    </span>
  );
}

interface SketchbookProps {
  /** What the open map offers, in the order the card cycles them. Empty renders nothing. */
  ideas: readonly SketchIdea[];
  /** Hand the standing order to the composer. Fills the field; never sends. */
  onOrder(text: string): void;
  /** The reading the caller took the proposals at, so the photograph is of the same map they were
   *  read from (`MapShot`'s own `version`). */
  mapVersion?: string | number;
}

export function Sketchbook({ ideas, onOrder, mapVersion }: SketchbookProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [beat, setBeat] = useState(0);
  const [wiping, setWiping] = useState(false);
  const capRef = useRef<HTMLSpanElement>(null);

  const idea = ideas.length > 0 ? ideas[beat % ideas.length]! : null;
  const words = idea
    ? { cap: t(idea.capKey, { dir: t(idea.dirKey), ...idea.params }), order: t(idea.orderKey, { dir: t(idea.dirKey), ...idea.params }) }
    : null;

  /**
   * The one engine. A single rAF loop off one clock: which idea is up is `beat`, the wipe lands
   * `cycle - erase` before the next one, and the ritual sits inside the hold. Reduced motion runs
   * none of it — the still below is what stands instead — and one idea alone needs no rotation, so
   * the loop is not started at all for it (it would wipe a card with nothing to replace it).
   */
  useEffect(() => {
    if (reduced || ideas.length < 2) return undefined;
    const t0 = performance.now();
    let frame = 0;
    let at = -1;
    let wiped = false;
    let ritualled = false;
    const tick = () => {
      const now = performance.now() - t0;
      const b = Math.floor(now / SKETCH.cycle);
      if (b !== at) {
        // The first beat is the card arriving, which the builder already drew: she takes up the
        // pencil from the second on.
        if (at >= 0) scribble();
        at = b; wiped = false; ritualled = false;
        setWiping(false);
        setBeat(b);
      }
      const into = now - b * SKETCH.cycle;
      if (!ritualled && into >= SKETCH.ritual) {
        ritualled = true;
        if (b % SKETCH.ritualEvery === SKETCH.ritualEvery - 1) ritual();
      }
      if (!wiped && into >= SKETCH.erase) { wiped = true; setWiping(true); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, ideas.length]);

  /** The caption fades out, changes, then fades in (`sketchEngine.swapCap`); `capText` holds the shown words apart from the decided ones. It stands still on first paint and under reduced motion. */
  const first = useRef(true);
  const [capText, setCapText] = useState(words?.cap ?? '');
  // `words` derives from `beat`; the swap plays once per beat.
  const swapCaption = useEffectEvent(() => {
    if (!words) return;
    if (reduced || first.current) {
      first.current = false;
      setCapText(words.cap);
      return;
    }
    const el = capRef.current;
    if (!el || typeof el.animate !== 'function') { setCapText(words.cap); return; }
    const swapIn = () => {
      setCapText(words.cap);
      play(el, [{ opacity: 0, transform: `translateY(${SKETCH.capRise}px)` }, { opacity: 1, transform: 'none' }], SKETCH.capIn);
    };
    const out = el.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: SKETCH.capOut.dur, easing: SKETCH.capOut.easing, fill: 'forwards' },
    );
    out.onfinish = swapIn;
  });
  useEffect(() => { swapCaption(); }, [beat, reduced]);

  if (!idea || !words) return null;

  return (
    // Vertical clearance keeps the shared focus ring inside the scrolling zone.
    <div data-testid="sketchbook" style={{ display: 'flex', flexDirection: 'column', padding: '6px 0' }}>
      <ActionButton
        type="button"
        interaction="actionTap"
        fill={PLATE}
        hoverFill={INSET}
        data-testid="sketch-card"
        data-kind={idea.kind}
        title={words.order}
        onClick={() => onOrder(words.order)}
        style={CARD_STYLE}
      >
        <SketchPaper
          key={beat % ideas.length}
          idea={idea}
          wiping={wiping}
          still={reduced}
          {...(mapVersion !== undefined ? { mapVersion } : {})}
        />
        <span style={CAP_STYLE}>
          <span style={{ flex: '0 0 auto', color: INK, paddingTop: 2 }}><Icon id="pw-note" size={14} /></span>
          <span
            ref={capRef}
            data-testid="sketch-caption"
            style={{ ...roleFont('label'), fontFamily: font.family, color: INK, lineHeight: LINE_HEIGHT.snug }}
          >
            {capText}
          </span>
        </span>
      </ActionButton>
    </div>
  );
}

/** She takes up the pencil: the note badge, a lean over the page, and the hand's own rhythm. */
function scribble(): void {
  cueCharacter({ kind: 'garnish', moves: GARNISH.scribble, badge: { id: 'note', ms: SCRIBBLE_BADGE_MS } });
}

/** One small thing between sketches, in turn. Never two at once, never a show. */
let nextRitual = 0;
function ritual(): void {
  const name = RITUALS[nextRitual % RITUALS.length]!;
  nextRitual++;
  cueCharacter({ kind: 'garnish', moves: GARNISH[name] });
}
