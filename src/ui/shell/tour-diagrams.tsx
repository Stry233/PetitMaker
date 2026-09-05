/**
 * Animated gesture diagrams for tour steps. Every demonstration uses one phase-locked CSS timeline
 * so the pointer, trail, and scene stay synchronized without React renders. Reduced motion displays
 * the completed gesture state. Only fixed mouse buttons are drawn; rebindable keys remain text.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import { ELEVATION_COLORS, WATER_COLOR } from '../../core/model/constants';
import { CURSORS, CURSOR_SIZE } from '../../core/runtime/cursor-spec';
import { classicCursorArt, CLASSIC_CURSOR_SIZE } from '../../assets/cursors/cursor-art-classic';
import { cursorArt } from '../../assets/cursors/cursor-art';
import { USE_CLASSIC_CURSORS } from '../../assets/cursors/cursor-set';
import { colors, inkTint } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { CSS_CURVES } from './motion/curves';
import { MOTIONS } from './motion/registry';
import type { TourStep, TourStepId } from '../chrome/tour/steps';

/* Timing and travel come from the motion registry. */

const REP = MOTIONS['tour.gesture.drag'].duration;
const CYCLE = MOTIONS['tour.gesture.cycle'].duration;
const EASE = CSS_CURVES[MOTIONS['tour.gesture.drag'].curve];
/** How far the hand carries the map, each way. */
const DRAG = MOTIONS['tour.gesture.drag'].amplitude;
/** Brush travel, longer than pan travel so the painted row remains legible. */
const RUN = MOTIONS['tour.gesture.stroke'].amplitude;
/** How much the wheel beat brings the map closer, as a fraction. */
const ZOOM = MOTIONS['tour.gesture.wheel'].amplitude;
/** How far a left drag slides the 3D scene. */
const SLIDE = MOTIONS['tour.gesture.orbit'].amplitude;

/** Right/middle-drag yaw in degrees. */
const YAW_DEG = 13;
/** Where the flat map stands once it has tipped into the 3D one. */
const TIP_DEG = 46;
/** Shallower 3D angle used where a painted row must remain legible. */
const STAND_DEG = 42;
/** Perspective distance for the miniature 3D scene. */
const PERSPECTIVE = 600;

/* ── The drawing's own measurements ─────────────────────────── */

/** Miniature map dimensions. */
const CARD_W = 240;
const CARD_H = 92;
/** The 3D step's card is narrower: the button it is being switched by stands beside it. */
const V3_W = 204;
const V3_BTN = 34;
const V3_GAP = 10;
/** The card's corner, and the grid drawn inside it. */
const CARD_R = 12;
const GRID = 24;
/** How far the scene's ground extends past the card on each side, so a pan or a turn never drags an
 *  edge into view. */
const BLEED = 40;

/** Diagram height consumed by tour-card placement. */
const DRAW_H = 96;
const TITLE_GAP = 12;
export const TOUR_DIAGRAM_H = DRAW_H + TITLE_GAP;

/** Cursor tile size adjusted so both art sets show a roughly 20 CSS-pixel arrow. */
const CURSOR_PX = USE_CLASSIC_CURSORS ? 22 : 24;
/** Mouse badge dimensions and offset from the cursor tip. */
const BADGE_W = 16;
const BADGE_X = 15;
const BADGE_Y = 14;
/** Press ring position around the cursor body. */
const RIPPLE = 34;
const RIPPLE_X = 7;
const RIPPLE_Y = 9;

const INK = colors.frameDark;
const LIT = colors.accentPrimary;
/** The ground a stroke has just laid. */
const LAID = colors.tileYellow;
const WATER = WATER_COLOR;
const GRASS = ELEVATION_COLORS[0]!;
const HILL = ELEVATION_COLORS[2]!;
const LINE = inkTint(0.12);
const GUIDE = inkTint(0.3);

/* ── The loops ──────────────────────────────────────────────
   Percentages of ONE rep unless the element names the cycle's length instead. A rep rests, presses
   at 5%, drags 9-34%, holds while the wheel beat runs 48-88%, and releases. */

const CLS = {
  /** Every animated element: the clock, the curve and the repeat, in one class. */
  anim: 'pw-tg-anim',
  /** The three whose reduced-motion end state is a transform, tagged so one rule can stand each of
   *  them at the end of its travel. */
  pan: 'pw-tg-pan',
  yaw: 'pw-tg-yaw',
  tilt: 'pw-tg-tilt',
  reach: 'pw-tg-reach',
  /** The trail, whose end state is a drawn line rather than a transform. */
  drawn: 'pw-tg-drawn',
} as const;

const ANIM = {
  dragCursor: 'pw-tg-dragcursor',
  dragTrail: 'pw-tg-dragtrail',
  dragBadge: 'pw-tg-dragbadge',
  scrollBadge: 'pw-tg-scrollbadge',
  wheelRoll: 'pw-tg-wheelroll',
  zoom: 'pw-tg-zoom',
  campan: 'pw-tg-campan',
  slide: 'pw-tg-slide',
  turn: 'pw-tg-turn',
  ripple: 'pw-tg-ripple',
  keyLit: 'pw-tg-keylit',
  keyLit3: 'pw-tg-keylit3',
  badge: 'pw-tg-badge',
  run: 'pw-tg-run',
  trail: 'pw-tg-trail',
  reach: 'pw-tg-walk',
  press: 'pw-tg-press',
  chipRipple: 'pw-tg-chipripple',
  tip: 'pw-tg-tip',
} as const;

/** The four cells a stroke lays, appearing in the order it lays them: staggered starts, one shared
 *  end, so the row stands complete for the rest of the rep. */
const cellAnim = (i: number): string => `pw-tg-cell${i + 1}`;
const CELLS = [0, 1, 2, 3].map((i) => (
  `@keyframes ${cellAnim(i)}{0%,${17 + i * 8}%{opacity:0}${21 + i * 8}%,84%{opacity:1}90%,100%{opacity:0}}`
)).join('');

const SHEET = `
.pw-tg{--pw-tg-rep:${REP}s;--pw-tg-cycle:${CYCLE}s}
.${CLS.anim}{
  animation-duration:var(--pw-tg-rep);
  animation-iteration-count:infinite;
  animation-timing-function:${EASE};
}
@keyframes ${ANIM.keyLit}{0%,5%{opacity:0}10%,80%{opacity:1}86%,100%{opacity:0}}
@keyframes ${ANIM.keyLit3}{0%,1.5%{opacity:0}3.3%,26.5%{opacity:1}29%,100%{opacity:0}}
@keyframes ${ANIM.badge}{
  0%,5%{opacity:0;transform:scale(.5)}
  10%,80%{opacity:1;transform:scale(1)}
  86%,100%{opacity:0;transform:scale(.5)}
}
@keyframes ${ANIM.dragBadge}{
  0%,4%{opacity:0;transform:scale(.5)}
  8%,38%{opacity:1;transform:scale(1)}
  44%,100%{opacity:0;transform:scale(.5)}
}
@keyframes ${ANIM.scrollBadge}{
  0%,50%{opacity:0;transform:scale(.5)}
  56%,86%{opacity:1;transform:scale(1)}
  92%,100%{opacity:0;transform:scale(.5)}
}
@keyframes ${ANIM.ripple}{
  0%,5%{opacity:0;transform:scale(.4)}
  8%{opacity:.9;transform:scale(.6)}
  20%,100%{opacity:0;transform:scale(1.6)}
}
@keyframes ${ANIM.dragCursor}{
  0%,9%{transform:translate(calc(var(--pw-tg-amp) * -1),0)}
  34%,100%{transform:translate(var(--pw-tg-amp),0)}
}
@keyframes ${ANIM.dragTrail}{
  0%,9%{stroke-dashoffset:var(--pw-tg-len)}
  34%,86%{stroke-dashoffset:0}
  92%,100%{stroke-dashoffset:var(--pw-tg-len)}
}
@keyframes ${ANIM.campan}{
  0%,9%{transform:translate(calc(var(--pw-tg-amp) * -1),0)}
  34%,92%{transform:translate(var(--pw-tg-amp),0)}
  98%,100%{transform:translate(calc(var(--pw-tg-amp) * -1),0)}
}
@keyframes ${ANIM.zoom}{
  0%,48%{transform:scale(1)}
  66%,88%{transform:scale(${1 + ZOOM})}
  96%,100%{transform:scale(1)}
}
@keyframes ${ANIM.wheelRoll}{
  0%,52%{transform:translateY(0)}
  58%{transform:translateY(2px)}
  66%{transform:translateY(-2px)}
  74%{transform:translateY(2px)}
  82%,100%{transform:translateY(0)}
}
@keyframes ${ANIM.run}{
  0%,11%{transform:translate(calc(var(--pw-tg-amp) * -1),0)}
  52%,90%{transform:translate(var(--pw-tg-amp),0)}
  91%,100%{transform:translate(calc(var(--pw-tg-amp) * -1),0)}
}
@keyframes ${ANIM.trail}{
  0%,11%{stroke-dashoffset:var(--pw-tg-len)}
  52%,86%{stroke-dashoffset:0}
  91%,100%{stroke-dashoffset:var(--pw-tg-len)}
}
${CELLS}
@keyframes ${ANIM.slide}{
  0%,1%{transform:translate(0,0)}
  3%{transform:translate(${-SLIDE}px,0)}
  11.3%,30%{transform:translate(${SLIDE}px,0)}
  32.5%,100%{transform:translate(0,0)}
}
@keyframes ${ANIM.turn}{
  0%,36.3%{transform:rotate(${-YAW_DEG}deg)}
  44.7%,66.9%{transform:rotate(${YAW_DEG}deg)}
  68.6%,69.7%{transform:rotate(${-YAW_DEG}deg)}
  78%,97%{transform:rotate(${YAW_DEG}deg)}
  99%,100%{transform:rotate(${-YAW_DEG}deg)}
}
@keyframes ${ANIM.reach}{
  0%,6%{transform:translate(0,0)}
  20%,82%{transform:translate(var(--pw-tg-dx),var(--pw-tg-dy))}
  94%,100%{transform:translate(0,0)}
}
@keyframes ${ANIM.press}{0%,22%{opacity:0}26%,78%{opacity:1}84%,100%{opacity:0}}
@keyframes ${ANIM.chipRipple}{
  0%,21%{opacity:0;transform:scale(.4)}
  25%{opacity:.9;transform:scale(.7)}
  38%,100%{opacity:0;transform:scale(1.7)}
}
@keyframes ${ANIM.tip}{
  0%,26%{transform:rotateX(0deg)}
  44%,80%{transform:rotateX(${TIP_DEG}deg)}
  96%,100%{transform:rotateX(0deg)}
}
[data-reduced-motion='1'] .pw-tg [data-rm='end']{opacity:1 !important}
[data-reduced-motion='1'] .pw-tg .${CLS.pan}{transform:translate(var(--pw-tg-amp),0) !important}
[data-reduced-motion='1'] .pw-tg .${CLS.yaw}{transform:rotate(${YAW_DEG}deg) !important}
[data-reduced-motion='1'] .pw-tg .${CLS.tilt}{transform:rotateX(${TIP_DEG}deg) !important}
[data-reduced-motion='1'] .pw-tg .${CLS.drawn}{stroke-dashoffset:0 !important}
[data-reduced-motion='1'] .pw-tg .${CLS.reach}{
  transform:translate(var(--pw-tg-dx),var(--pw-tg-dy)) !important
}
`;

/* ── The parts every drawing is made of ─────────────────────── */

/**
 * The pointer, which is the app's OWN cursor rather than a drawing of one: whichever set the app is
 * wearing (`cursor-set.ts`), at the size this diagram draws it, positioned so the art's HOTSPOT sits
 * exactly on the point the gesture acts at. A hand-drawn arrow beside the real one is a second
 * pointer the visitor has to recognise as the first.
 */
const ARROW = ((): {
  url: string; hotspot: readonly [number, number]; size: number;
} | null => {
  if (USE_CLASSIC_CURSORS) {
    const art = classicCursorArt('select');
    if (art) return { ...art, size: CLASSIC_CURSOR_SIZE };
  }
  const url = cursorArt('select');
  if (!url) return null;
  return { url, hotspot: CURSORS.select.hotspot, size: CURSORS.select.size ?? CURSOR_SIZE };
})();

/** Drawn from its hotspot, so the element's own origin IS the acting pixel and everything else in
 *  the actor is placed against that. */
function Pointer() {
  if (!ARROW) return null;
  const scale = CURSOR_PX / ARROW.size;
  return (
    <img
      data-testid="tour-cursor"
      // Both sets are SVG now, so one URL rasterises as crisp as the card at any screen density.
      src={ARROW.url} alt="" draggable={false}
      width={CURSOR_PX} height={CURSOR_PX}
      style={{
        position: 'absolute',
        left: -ARROW.hotspot[0] * scale,
        top: -ARROW.hotspot[1] * scale,
        display: 'block',
      }}
    />
  );
}

type MouseKey = 'left' | 'right' | 'wheel';

/** One key of a badge, lit for the rep it belongs to. `rep` is which rep of a CYCLE lights it, and a
 *  layer that names one shares the cycle's whole length with its siblings, delayed a rep apart —
 *  which is what makes three buttons three demonstrations instead of one chord. */
interface KeyLayer {
  key: MouseKey;
  rep?: number;
  /** Lit in the still drawing. Exactly one layer of a cycle carries it. */
  rm?: boolean;
}

/** How many reps a cycle is: the clock the registry declares for one, over the clock for a rep. */
const REPS = Math.round(CYCLE / REP);

/**
 * How many reps to START a key's animation BEFORE the drawing began, so that its one lit window
 * falls in the rep it belongs to.
 *
 * A negative delay winds the animation FORWARD, so the wait for rep n is the reps REMAINING after
 * it: one rep back lands the window in the LAST rep, not the second. Getting this the plain way
 * round puts the middle button before the right one, which is the order nobody teaches.
 */
function repDelay(rep: number): number {
  return (REPS - (rep - 1)) % REPS;
}

/**
 * The badge that pops beside the pointer: a mouse from above, with the key this rep HOLDS filled.
 *
 * TWO MARKS, NOT ONE. A filled key means held. `roll` instead draws the wheel UNFILLED and rolling,
 * with a tick arrow beside it, which is what a scroll is — so a middle-drag and a scroll cannot be
 * read as the same thing.
 */
function Badge({ layers = [], roll }: { layers?: readonly KeyLayer[]; roll?: boolean }) {
  const w = BADGE_W;
  const h = (w * 4) / 3;
  const half = w / 2;
  const keyH = h * 0.42;
  const wr = w * 0.1;
  const shape = (key: MouseKey): string => (key === 'left'
    ? `M1 ${keyH} V${half} A${half - 1} ${half - 1} 0 0 1 ${half} 1 V${keyH} Z`
    : `M${half} ${keyH} V1 A${half - 1} ${half - 1} 0 0 1 ${w - 1} ${half} V${keyH} Z`);
  const layerStyle = (l: KeyLayer): CSSProperties => (l.rep === undefined
    ? { animationName: ANIM.keyLit, opacity: 0 }
    : {
      animationName: ANIM.keyLit3,
      animationDuration: 'var(--pw-tg-cycle)',
      animationDelay: 'var(--pw-tg-ad)',
      '--pw-tg-ad': repDelay(l.rep) === 0 ? '0ms' : `calc(var(--pw-tg-rep) * ${-repDelay(l.rep)})`,
      opacity: 0,
    } as CSSProperties);
  const wheelRect = (fill: string, stroke?: string) => (
    <rect
      x={half - wr} y={h * 0.1} width={wr * 2} height={h * 0.26} rx={wr}
      fill={fill} stroke={stroke} strokeWidth={stroke ? 1.2 : undefined}
    />
  );
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={half - 1} fill={colors.white} stroke={INK} strokeWidth={1.8} />
      {layers.filter((l) => l.key !== 'wheel').map((l) => (
        <path
          key={l.key} data-testid="tour-key" data-key={l.key} data-rm={l.rm ? 'end' : undefined}
          d={shape(l.key)} fill={LIT} className={CLS.anim} style={layerStyle(l)}
        />
      ))}
      <path d={`M1 ${keyH} H${w - 1}`} stroke={INK} strokeWidth={1.4} />
      <path d={`M${half} 1 V${keyH}`} stroke={INK} strokeWidth={1.4} />
      {/* The wheel sits across the two keys, so it is drawn after their divider and covers it. */}
      <g className={roll ? CLS.anim : undefined} style={roll ? { animationName: ANIM.wheelRoll } : undefined}>
        {wheelRect(colors.white, INK)}
        {layers.filter((l) => l.key === 'wheel').map((l) => (
          <g key={l.key} data-testid="tour-key" data-key={l.key} data-rm={l.rm ? 'end' : undefined}
            className={CLS.anim} style={layerStyle(l)}
          >
            {wheelRect(LIT)}
          </g>
        ))}
      </g>
      {roll && (
        <g stroke={GUIDE} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={`M${w + 4.5} ${h * 0.22} v${h * 0.3}`} />
          <path d={`M${w + 2} ${h * 0.28} L${w + 4.5} ${h * 0.16} L${w + 7} ${h * 0.28}`} />
          <path d={`M${w + 2} ${h * 0.48} L${w + 4.5} ${h * 0.6} L${w + 7} ${h * 0.48}`} />
        </g>
      )}
    </svg>
  );
}

/** Left, then right, then middle: one whole rep each. */
const CYCLE_KEYS: readonly KeyLayer[] = [
  { key: 'left', rep: 1, rm: true },
  { key: 'right', rep: 2 },
  { key: 'wheel', rep: 3 },
];
const HELD_LEFT: readonly KeyLayer[] = [{ key: 'left', rm: true }];

/**
 * The pointer with its press ring and its badge, travelling as one body.
 *
 * `amp` is how far it goes each way, and `move` which of the two travels it makes: a drag that stays
 * where it landed while the wheel beat runs, or a stroke that runs back.
 */
function Actor({
  keys, move, amp, x, y, badgeAnim = ANIM.badge, scrollBeat,
}: {
  keys: readonly KeyLayer[]; move: string; amp: number; x: number; y: number;
  badgeAnim?: string; scrollBeat?: boolean;
}) {
  return (
    <div
      className={`${CLS.anim} ${CLS.pan}`}
      style={{ '--pw-tg-amp': `${amp}px`, animationName: move, position: 'absolute', left: x, top: y } as CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div
          className={CLS.anim}
          style={{
            animationName: ANIM.ripple, opacity: 0, position: 'absolute',
            left: RIPPLE_X - RIPPLE / 2, top: RIPPLE_Y - RIPPLE / 2, width: RIPPLE, height: RIPPLE,
            borderRadius: '50%', border: `2.5px solid ${LIT}`,
          }}
        />
        <Pointer />
        <div
          className={CLS.anim} data-rm="end" data-testid="tour-badge"
          style={{ animationName: badgeAnim, opacity: 0, position: 'absolute', left: BADGE_X, top: BADGE_Y }}
        >
          <Badge layers={keys} />
        </div>
        {scrollBeat && (
          <div
            className={CLS.anim} data-testid="tour-scroll"
            style={{ animationName: ANIM.scrollBadge, opacity: 0, position: 'absolute', left: BADGE_X, top: BADGE_Y }}
          >
            <Badge roll />
          </div>
        )}
      </div>
    </div>
  );
}

/** The grid the scene is drawn on, bled past the card so a travel never shows its edge. */
function Grid({ w, h, x0 = 0, y0 = 0 }: { w: number; h: number; x0?: number; y0?: number }) {
  const lines: ReactNode[] = [];
  for (let x = x0 + GRID; x < x0 + w; x += GRID) {
    lines.push(<path key={`v${x}`} d={`M${x} ${y0} V${y0 + h}`} stroke={LINE} strokeWidth={1} />);
  }
  for (let y = y0 + GRID; y < y0 + h; y += GRID) {
    lines.push(<path key={`h${y}`} d={`M${x0} ${y} H${x0 + w}`} stroke={LINE} strokeWidth={1} />);
  }
  return <g>{lines}</g>;
}

/** The island every diagram acts on: the same shape in each, so it reads as one map being panned,
 *  turned and built on. */
function Island({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M14 10 H74 V26 H88 V54 H60 V64 H24 V48 H2 V24 H14 Z" fill={GRASS} />
      <rect x={34} y={20} width={26} height={18} rx={3} fill={HILL} />
    </g>
  );
}

/** The path the hand takes, drawing itself as the hand crosses. A straight line, because that is
 *  what the hand does: an arc would be a different gesture. */
function Trail({ x1, x2, y, anim }: { x1: number; x2: number; y: number; anim: string }) {
  const len = (x2 - x1) * 1.1;
  return (
    <path
      d={`M${x1} ${y} H${x2}`} stroke={GUIDE} strokeWidth={2} strokeLinecap="round"
      strokeDasharray={len} strokeDashoffset={len}
      className={`${CLS.anim} ${CLS.drawn}`}
      style={{ '--pw-tg-len': `${len}px`, animationName: anim } as CSSProperties}
    />
  );
}

/**
 * The little map, and the frame around it that does not move.
 *
 * The scene is clipped by a clipPath INSIDE the svg rather than by overflow on a box: the card
 * itself is what tips into 3D, and a clip on a transformed element is the one arrangement that
 * makes a browser hand the whole thing to a separate raster and lose the scene's own edges.
 */
function Card({ w, h, stand, children }: { w: number; h: number; stand?: 'tip' | 'still'; children: ReactNode }) {
  const clip = useId();
  const svg = (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <clipPath id={clip}><rect width={w} height={h} rx={CARD_R} /></clipPath>
      <rect width={w} height={h} rx={CARD_R} fill={WATER} />
      <g clipPath={`url(#${clip})`}>{children}</g>
    </svg>
  );
  if (!stand) return svg;
  return (
    <div style={{ perspective: PERSPECTIVE }}>
      {stand === 'tip'
        ? (
          <div className={`${CLS.anim} ${CLS.tilt}`} data-testid="tour-plane" style={{ animationName: ANIM.tip, width: w, height: h }}>
            {svg}
          </div>
        )
        : (
          <div data-testid="tour-plane" style={{ transform: `rotateX(${STAND_DEG}deg)`, width: w, height: h }}>
            {svg}
          </div>
        )}
    </div>
  );
}

/** Where the pointer's tip stands on a card: a little right of centre and below the trail's line,
 *  so the arrow points into the map rather than over the island. */
const TIP_X = CARD_W / 2 - 7;

/* ── The diagrams ──────────────────────────────────────────── */

/**
 * Carrying the map: three reps, one button each, and the map answers every one of them the same
 * way. The wheel beat follows the drag inside the same rep, so a step whose text says "drag, and
 * scroll to zoom" shows both without a second diagram.
 */
function CameraDiagram() {
  const w = CARD_W;
  const h = CARD_H;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <Card w={w} h={h}>
        <g transform={`translate(${w / 2} ${h / 2})`}>
          <g className={CLS.anim} style={{ animationName: ANIM.zoom }}>
            <g transform={`translate(${-w / 2} ${-h / 2})`}>
              <g
                className={`${CLS.anim} ${CLS.pan}`}
                style={{ '--pw-tg-amp': `${DRAG}px`, animationName: ANIM.campan } as CSSProperties}
              >
                <rect x={-BLEED} y={0} width={w + BLEED * 2} height={h} fill={WATER} />
                <Grid w={w + BLEED * 2} h={h} x0={-BLEED} />
                <Island x={76} y={16} />
              </g>
            </g>
          </g>
        </g>
        <Trail x1={w / 2 - 30} x2={w / 2 + 30} y={h / 2 + 14} anim={ANIM.dragTrail} />
      </Card>
      <Actor
        keys={CYCLE_KEYS} move={ANIM.dragCursor} amp={DRAG}
        x={TIP_X} y={h / 2 + 3} badgeAnim={ANIM.dragBadge} scrollBeat
      />
    </div>
  );
}

/** A brush crossing the map with the ground appearing behind it, flat or on a surface already
 *  standing in 3D: the same stroke either way, which is the whole point of the 3D one. */
function StrokeDiagram({ stand }: { stand?: boolean }) {
  const w = CARD_W;
  const h = CARD_H;
  const cw = 26;
  const ch = 18;
  const x0 = w / 2 - 2 * cw;
  const y = h / 2 - 9;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <Card w={w} h={h} stand={stand ? 'still' : undefined}>
        <Grid w={w} h={h} />
        <Island x={76} y={16} />
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i} data-testid="tour-laid" data-rm="end"
            x={x0 + i * cw + 1} y={y + 1} width={cw - 2} height={ch - 2} rx={3} fill={LAID}
            className={CLS.anim} style={{ animationName: cellAnim(i), opacity: 0 }}
          />
        ))}
        <Trail x1={x0 - 6} x2={x0 + 4 * cw + 6} y={y + ch / 2} anim={ANIM.trail} />
      </Card>
      <Actor keys={HELD_LEFT} move={ANIM.run} amp={RUN} x={TIP_X} y={h / 2 + (stand ? 11 : 9)} />
    </div>
  );
}

/** The flat map standing up: the pointer walks off the card to the button that switches views, the
 *  button answers the press, and the map tips. One map, two ways of looking at it. */
function View3dDiagram() {
  const h = CARD_H;
  return (
    <div style={{ position: 'relative', width: V3_W + V3_GAP + V3_BTN, height: h }}>
      <div style={{ position: 'absolute', left: 0, top: 0 }}>
        <Card w={V3_W} h={h} stand="tip">
          <Grid w={V3_W} h={h} />
          <Island x={58} y={16} />
        </Card>
      </div>
      {/* The button is DRAWN, ink line and all, like the mouse beside the pointer: the same
          vocabulary as everything else in these cards, and the frame it stands for casts no
          shadows of its own. */}
      <div
        style={{
          position: 'absolute', right: 0, top: h / 2 - V3_BTN / 2,
          width: V3_BTN, height: V3_BTN, borderRadius: 10,
          background: colors.surfaceSecondary, border: `1.6px solid ${INK}`, color: INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...roleFont('chip'),
        }}
      >
        3D
        <div
          className={CLS.anim}
          style={{
            animationName: ANIM.chipRipple, opacity: 0, position: 'absolute', inset: -4,
            borderRadius: 14, border: `2.5px solid ${LIT}`,
          }}
        />
        <div
          className={CLS.anim} data-rm="end"
          style={{
            animationName: ANIM.press, opacity: 0, position: 'absolute', inset: 0,
            borderRadius: 10, background: LIT, mixBlendMode: 'multiply',
          }}
        />
      </div>
      <div
        className={`${CLS.anim} ${CLS.reach}`}
        style={{
          '--pw-tg-dx': `${V3_W / 2 + V3_GAP + V3_BTN / 2 - 6}px`, '--pw-tg-dy': '0px',
          animationName: ANIM.reach, position: 'absolute', left: V3_W / 2 - 6, top: h / 2 - 1,
        } as CSSProperties}
      >
        <div style={{ position: 'relative' }}><Pointer /></div>
      </div>
    </div>
  );
}

/**
 * Looking around in 3D: the same three reps, and the scene answers them differently. The left
 * button SLIDES it and the other two TURN it, which is the fact a sentence about "orbit" cannot
 * place. The wheel beat brings it closer, as it does in the flat view.
 */
function OrbitDiagram() {
  const w = CARD_W;
  const h = CARD_H;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <Card w={w} h={h} stand="still">
        <g transform={`translate(${w / 2} ${h / 2})`}>
          <g
            className={`${CLS.anim} ${CLS.yaw}`}
            style={{ animationName: ANIM.turn, animationDuration: 'var(--pw-tg-cycle)' }}
          >
            <g className={CLS.anim} style={{ animationName: ANIM.zoom }}>
              <g transform={`translate(${-w / 2} ${-h / 2})`}>
                <g
                  className={CLS.anim}
                  style={{ animationName: ANIM.slide, animationDuration: 'var(--pw-tg-cycle)' }}
                >
                  <rect x={-BLEED} y={-BLEED} width={w + BLEED * 2} height={h + BLEED * 2} fill={WATER} />
                  <Grid w={w + BLEED * 2} h={h + BLEED * 2} x0={-BLEED} y0={-BLEED} />
                  <Island x={76} y={16} />
                </g>
              </g>
            </g>
          </g>
        </g>
        <Trail x1={w / 2 - 30} x2={w / 2 + 30} y={h / 2 + 14} anim={ANIM.dragTrail} />
      </Card>
      <Actor
        keys={CYCLE_KEYS} move={ANIM.dragCursor} amp={DRAG}
        x={TIP_X} y={h / 2 + 7} badgeAnim={ANIM.dragBadge} scrollBeat
      />
    </div>
  );
}

/**
 * The drawing for a step, or null for one whose content is not a gesture.
 *
 * Called from the overlay's render with the step it is about to show, so the answer carries the
 * HEIGHT as well: the placement fits the card against the spotlight before either has been measured.
 */
export function tourDiagram(step: TourStep): { node: ReactNode; height: number } | null {
  const node = ((): ReactNode => {
    switch (step.id) {
      case 'camera': return <CameraDiagram />;
      case 'bar': return <StrokeDiagram />;
      case 'view3d': return <View3dDiagram />;
      case 'orbit': return <OrbitDiagram />;
      case 'build3d': return <StrokeDiagram stand />;
      default: return null;
    }
  })();
  if (!node) return null;
  return {
    height: TOUR_DIAGRAM_H,
    node: (
      <div
        aria-hidden className="pw-tg" data-testid={`tour-diagram-${step.id}`}
        style={{
          marginBottom: TITLE_GAP, height: DRAW_H,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* The loops, declared once per drawing. Identical text whichever diagram is up, and a
            stylesheet the tour carries with it rather than one the app has to have loaded. */}
        <style>{SHEET}</style>
        {node}
      </div>
    ),
  };
}

/** Which steps carry a drawing, for a test to read: the mapping above is a switch, and a switch is
 *  not a list anything else can check. */
export const TOUR_DIAGRAM_STEPS = [
  'camera', 'bar', 'view3d', 'orbit', 'build3d',
] as const satisfies readonly TourStepId[];
