/*
 * The tour's send-off: a short congratulation, a fall of confetti, and one button back to the map.
 *
 * It opens only when the tour is FINISHED, never when it is skipped: someone who skipped asked to
 * be left alone, and celebrating that would be the tour talking back.
 *
 * What makes a fall read as CONFETTI rather than as objects dropping is that every piece differs
 * from every other and that the pieces are PAPER: thin, light, and turning as they go. So each one
 * draws its own fall speed, sway, spin, tumble and start delay, and the tumble is a `scaleX` swung
 * through negative values — a flat strip seen edge-on is exactly `scaleX: 0`, which is paper
 * turning over without a scrap of perspective. Nothing glows, nothing blurs, nothing leaves the
 * plane, and the fills are flat menu-tile colours.
 *
 * The pieces are plain divs driven by the Web Animations API rather than 70-odd framer components:
 * WAAPI takes independent per-piece keyframes cheaply and composites them off the main thread.
 * That also puts them OUTSIDE both automatic reduced-motion gates (framer's, and the stylesheet's
 * `[data-reduced-motion="1"]` rule), so this file reads the preference itself and renders no pieces
 * at all — the message, the button and the focus behaviour are identical either way.
 */
import { useEffect, useRef } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { makeRng } from '../../../core/model/rng';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { colors, font, modalTitle, radii, buttonMotion, primaryButton } from '../../design/styles';
import { Wavy } from '../../primitives/Wavy';
import { ModalShell } from '../../primitives/ModalShell';

const CARD_W = 360;

/** The app's own tile colours, so the pieces read as bits of it rather than party stock. The
 *  card's own cream and plain white are deliberately not in the set: a piece the colour of what it
 *  falls on is not a piece. */
const PIECE_COLORS = [
  colors.tileYellow,
  colors.tileGreen,
  colors.tilePaleYellow,
  colors.tileDeepGreen,
];

/** Enough that the fall stops reading as countable objects. */
const PIECE_COUNT = 72;

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
 *  no piece shares a value with its neighbour. */
const PIECES: readonly Piece[] = (() => {
  const rng = makeRng(0x5e0f);
  return Array.from({ length: PIECE_COUNT }, (_, i): Piece => {
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
      delay: i < PIECE_COUNT * WAVE_SHARE ? rng.range(0, 0.25) : rng.range(0.25, 0.75),
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reduced) return;
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
  }, [reduced]);

  if (reduced) return null;
  return (
    <div
      ref={hostRef}
      aria-hidden
      data-testid="tour-confetti"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {PIECES.map((p, i) => (
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

export function TourDoneModal() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.tourDone);
  const setModal = useEditorStore((s) => s.setModal);
  const close = () => setModal('tourDone', false);

  return (
    <ModalShell helpTarget={{ page: 'tour' }}
      open={open}
      onClose={close}
      width={CARD_W}
      maxVwPct={92}
      ariaLabel={`${t('tour.done_title_a')}${t('tour.done_title_b')}`}
      cardStyle={{
        position: 'relative',
        overflow: 'hidden',
        padding: '30px 28px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <Confetti />
      {/* The content is positioned so it paints over the confetti, which is positioned itself:
          in-flow siblings would sit under it whatever the DOM order. */}
      <div style={{ ...modalTitle, position: 'relative' }}>
        {t('tour.done_title_a')}
        <Wavy>{t('tour.done_title_b')}</Wavy>
      </div>
      <div style={{ ...font.body, color: colors.brownText, position: 'relative' }}>{t('tour.done_body')}</div>
      <motion.button
        type="button"
        onClick={close}
        {...buttonMotion}
        style={{ ...primaryButton, position: 'relative', marginTop: 6 }}
      >
        {t('tour.done_action')}
      </motion.button>
    </ModalShell>
  );
}
