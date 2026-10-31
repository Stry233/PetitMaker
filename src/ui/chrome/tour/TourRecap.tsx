/**
 * The tour's last screen: what the run covered, each card's tile a way back to it, a fall of
 * confetti, and one way on to the map. The tour stays in Settings, which its words say.
 *
 * What makes a fall read as confetti rather than as objects dropping is that every piece differs
 * from every other and that the pieces are paper: thin, light, and turning as they go. So each one
 * draws its own fall speed, sway, spin, tumble and start delay, and the tumble is a `scaleX` swung
 * through negative values, which is paper turning over without a scrap of perspective. The pieces
 * are plain divs driven by the Web Animations API, outside both automatic reduced-motion gates, so
 * the fall reads the preference itself and renders no pieces at all under it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { makeRng } from '../../../core/base/rng';
import { useLocale } from '../../../i18n/context';
import { useReadingT } from '../../design/reading';
import { cursors, interactionProfilesFor, radii, type InteractionProfile } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { skin, windowTitle } from '../../design/window-skin';
import { ACTIVE, TILE_GREEN, TILE_PALE_YELLOW, TILE_DEEP_GREEN } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { useScrollFade } from '../../primitives/scroll-fade';
import { CONTROL_CLEARANCE, scrollBleed, useScrollRow } from '../../primitives/use-scroll-row';
import { useSurfaceZoom } from '../../design/scale';
import { reelFiles } from './reels';
import type { useDeckLayout } from './TourDeck';
import type { TourController } from './use-tour';

/** The app's own tile colours, so the pieces read as bits of it rather than party stock. The
 *  card's own cream and plain white are deliberately not in the set: a piece the colour of what it
 *  falls on is not a piece. */
const PIECE_COLORS = [
  ACTIVE,
  TILE_GREEN,
  TILE_PALE_YELLOW,
  TILE_DEEP_GREEN,
];

/** The fall's area per piece, in card px², so a large window's fall is as dense as a phone's rather
 *  than the same pieces spread thinner: about 80 pieces on an upright phone, 140 on a desktop card. */
const AREA_PER_PIECE = 2400;
/** The fewest pieces, enough that the fall stops reading as countable objects, and the most, so a
 *  huge screen's fall stays light to draw. */
const PIECE_MIN = 60;
const PIECE_MAX = 220;

/** How many pieces fall over a box `w` by `h` card px. */
function pieceCount(w: number, h: number): number {
  return Math.min(PIECE_MAX, Math.max(PIECE_MIN, Math.round((w * h) / AREA_PER_PIECE)));
}

/** The share of the pieces in the leading wave. The rest trail in on longer delays, so the fall
 *  arrives and then settles rather than switching off. */
const WAVE_SHARE = 0.7;

/** Samples per fall. The sway and the tumble are sinusoids sampled at these points and linearly
 *  interpolated between them, which at this count is smooth to the eye. */
const KEYFRAMES = 24;

/** The last share of a fall, over which a piece fades, so nothing vanishes mid-air at full opacity. */
const FADE_TAIL = 0.2;

interface Piece {
  left: number;    // % of the card's width
  w: number;       // px
  h: number;       // px
  radius: number;  // px
  color: string;
  fall: number;    // s, this piece's own time from above the card to past its bottom
  delay: number;   // s
  sway: number;    // px, half the width of the horizontal sine
  phase: number;   // rad, so no two pieces sway in step
  turns: number;   // sine cycles of sway over the fall
  spin: number;    // deg over the fall, signed
  tumble: number;  // scaleX cycles over the fall, on no relation to the spin
}

/** One seeded stream, drawn from in a fixed order, so the fall is the same every time it plays and
 *  no piece shares a value with its neighbour. A fall takes the first pieces it needs, each piece
 *  drawing its own wave, so any count keeps the wave's share. */
const PIECES: readonly Piece[] = (() => {
  const rng = makeRng(0x5e0f);
  return Array.from({ length: PIECE_MAX }, (): Piece => {
    // Strips are the majority; the squares and discs are what keeps the fall from reading as one
    // repeated object.
    const kind = rng.float();
    const strip = kind < 0.65;
    const disc = kind >= 0.85;
    const short = disc ? rng.range(4, 10) : rng.range(5, 9);
    return {
      left: rng.range(-2, 98),
      w: strip ? short * rng.range(2, 4) : short,
      h: short,
      radius: disc ? radii.pill : radii.sm,
      color: rng.pick(PIECE_COLORS),
      fall: rng.range(1.4, 2.4),
      delay: rng.float() < WAVE_SHARE ? rng.range(0, 0.25) : rng.range(0.25, 0.75),
      sway: rng.range(10, 40),
      phase: rng.range(0, Math.PI * 2),
      turns: rng.range(0.75, 1.75),
      spin: rng.range(180, 720) * (rng.float() < 0.5 ? -1 : 1),
      tumble: rng.range(0.6, 2.2),
    };
  });
})();

/** The piece's path, sampled: it falls at a steady rate, sways across it on its own sine, spins in
 *  the plane, and turns over on a period unrelated to the spin. */
function keyframesFor(p: Piece, from: number, to: number): Keyframe[] {
  return Array.from({ length: KEYFRAMES + 1 }, (_, k) => {
    const at = k / KEYFRAMES;
    const x = Math.sin(p.phase + at * Math.PI * 2 * p.turns) * p.sway;
    const y = from + at * (to - from);
    const spin = p.spin * at;
    const face = Math.cos(at * Math.PI * 2 * p.tumble);
    return {
      transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${spin.toFixed(1)}deg) scaleX(${face.toFixed(3)})`,
      opacity: at > 1 - FADE_TAIL ? (1 - at) / FADE_TAIL : 1,
    };
  });
}

/** A dense wave and then a thinner trail, about three seconds, then done: no loop running behind a
 *  modal someone is reading. Nothing renders under reduced motion, since a decoration that cannot
 *  move has nothing to say. */
function Confetti() {
  const reduced = useReducedMotionConfig();
  const hostRef = useRef<HTMLDivElement>(null);
  // Read once, before the first paint: the fall plays once over the box it opened on.
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host && !reduced) setCount(pieceCount(host.clientWidth, host.clientHeight));
  }, [reduced]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reduced || count === 0) return;
    const height = host.clientHeight;
    const running: Animation[] = [];
    host.childNodes.forEach((node, i) => {
      const el = node as HTMLElement;
      const p = PIECES[i];
      if (!p || typeof el.animate !== 'function') return;
      running.push(el.animate(keyframesFor(p, -p.h - 12, height + p.h + 12), {
        duration: p.fall * 1000,
        delay: p.delay * 1000,
        easing: 'linear',
        fill: 'both', // holds the piece above the card through its delay, and gone after its fall
      }));
    });
    return () => { for (const a of running) a.cancel(); };
  }, [reduced, count]);

  if (reduced) return null;
  return (
    <div
      ref={hostRef}
      aria-hidden
      data-testid="tour-confetti"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {PIECES.slice(0, count).map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: 0,
            width: p.w,
            height: p.h,
            background: p.color,
            borderRadius: p.radius,
            // The fall's first keyframe raises this to 1. A piece is invisible until its own
            // animation exists, so none of them sits at the card's top edge waiting to start.
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}


/** The least width a tile takes, in card px, so a name's longest word fits its line in every locale. */
const TILE_MIN_W = 112;
/** The recap's side padding, upright and wide, in card px (the sheet's and the card's own). */
const SIDE_PAD = { tall: 20, wide: 32 } as const;

/** The recap's inner width, in card px. */
function innerOf(layout: ReturnType<typeof useDeckLayout>): number {
  return layout.cardW - 2 * (layout.tall ? SIDE_PAD.tall : SIDE_PAD.wide);
}

/** As many tiles across as keep each at least `TILE_MIN_W` wide, never fewer than two nor more than four. */
function columnsOf(layout: ReturnType<typeof useDeckLayout>, gap: number): number {
  return Math.min(4, Math.max(2, Math.floor((innerOf(layout) + gap) / (TILE_MIN_W + gap))));
}

/** A tile is a card the pointer presses whole, so it answers as the generate shelf's picture cards
 *  do; its hover growth, past its box. */
const TILE_PRESS = 'action' satisfies InteractionProfile;
const TILE_GROWTH = interactionProfilesFor('pc')[TILE_PRESS].whileHover.scale - 1;

/** The room the tiles' scroller keeps inside its edges for a tile's hover growth and focus ring, so
 *  neither is cut and a hover never reaches the scroll range: half the growth of a tile `tileW` card
 *  px wide, and of its height, which a name may make the longer side. */
function hoverBleed(tileW: number, tileH: number): string {
  return `calc(${Math.ceil((Math.max(tileW, tileH) * TILE_GROWTH) / 2)}px + ${CONTROL_CLEARANCE})`;
}

/** A tile's picture, width over height, upright and wide, and the most its name adds under it, in
 *  card px (two lines at the label rung with the roomier padding). */
const TILE_ASPECT = { tall: 4 / 3, wide: 16 / 10 } as const;
const TILE_NAME_H = 60;

export function TourRecap({ tour, layout }: { tour: TourController; layout: ReturnType<typeof useDeckLayout> }) {
  const t = useReadingT();
  const locale = useLocale();
  // A narrow upright sheet or a short wide card pads its tiles' names closer.
  const compact = layout.narrow || layout.short;
  const gap = layout.tall ? 10 : 12;
  // A short wide window has no height for a second row: the tiles stand in one row that scrolls sideways.
  const inRow = !layout.tall && layout.short;
  const aspect = TILE_ASPECT[layout.tall ? 'tall' : 'wide'];
  const tiles = useMemo(() => tour.cards.flatMap((card, i) => (card.tileKey
    ? [{ i, card, tileKey: card.tileKey, poster: reelFiles(locale, layout.form, card.kind)?.poster ?? null }] : [])),
  [tour.cards, locale, layout.form]);
  const across = inRow ? Math.max(1, tiles.length) : columnsOf(layout, gap);
  const tileW = Math.max(inRow ? TILE_MIN_W : 0, (innerOf(layout) - gap * (across - 1)) / across);
  const bleed = hoverBleed(tileW, tileW / aspect + TILE_NAME_H);
  const gridRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const gridFade = useScrollFade(gridRef, 'y');
  const row = useScrollRow(rowRef, { zoom: useSurfaceZoom(), bleed, pointerEvents: 'auto' });
  const flow: CSSProperties = inRow
    ? { gridAutoFlow: 'column', gridAutoColumns: `minmax(${TILE_MIN_W}px, 1fr)`, ...row }
    : { gridTemplateColumns: `repeat(${across}, minmax(0, 1fr))`, gridAutoRows: 'max-content', overflowY: 'auto', ...scrollBleed(bleed), ...gridFade };
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: layout.tall ? 18 : 20, minHeight: 0, flex: '1 1 auto' }} data-testid="tour-recap">
      <Confetti />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ ...windowTitle, textAlign: 'start', margin: 0 }}>{t('tour.recap_title')}</h2>
        <p style={{ ...roleFont('body'), color: skin.muted, margin: 0, lineHeight: 1.45 }}>{t('tour.recap_body')}</p>
      </div>
      {/* The tiles give way first where the window is short: they scroll, Start building stays. */}
      <div ref={inRow ? rowRef : gridRef} data-testid="tour-recap-tiles" style={{ position: 'relative', display: 'grid', gap, minHeight: 0, flex: inRow ? 'none' : '0 1 auto', ...flow }}>
        {tiles.map(({ i, tileKey, poster }) => (
          <ActionButton
            key={tileKey}
            interaction={TILE_PRESS}
            aria-label={t('tour.recap_tile', { tip: t(tileKey) })}
            onClick={() => tour.go(i)}
            style={{
              padding: 0, border: 'none', background: skin.inset, borderRadius: radii.md, overflow: 'hidden', cursor: cursors.clickable,
              display: 'flex', flexDirection: 'column', textAlign: 'start',
            }}
          >
            {poster && <img src={poster} alt="" style={{ display: 'block', width: '100%', aspectRatio: String(aspect), objectFit: 'cover', flex: 'none' }} />}
            <span style={{ ...roleFont('label'), color: skin.plateInk, padding: compact ? '6px 8px 8px' : '8px 12px 10px', flex: 'none' }}>{t(tileKey)}</span>
          </ActionButton>
        ))}
      </div>
      <ActionButton data-tour-way-on appearance="primary" onClick={tour.finish} style={{ position: 'relative', flex: 'none', alignSelf: layout.tall ? 'stretch' : 'flex-end', minWidth: 240 }}>
        {t('tour.start')}
      </ActionButton>
    </div>
  );
}
