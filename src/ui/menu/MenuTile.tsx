/*
 * MenuTile.tsx — one tappable tile on the home screen: a flat continuous-corner
 * rounded-square (color sampled per-tile from the design source) with a centered
 * icon and a label below it. Both the tile and its label are positioned
 * absolutely against the card — a 1:1 transcription of the design coordinates.
 *
 * Animation-ready: the visual is a motion.button whose press/hover state is
 * driven by interaction only — no business logic baked in.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '../../i18n/context';
import { useFontsReady } from '../hooks/useFontsReady';
import { colors, inkTint, font, springs, cursors } from '../styles';
import { type TileSpec } from './metrics';
import { usePx } from './scale';
import { measureTextW } from './measure-text';
import { squircleClip } from './squircle';
import { Icon } from './icons';

interface MenuTileProps {
  spec: TileSpec;
  /** Tile height override (build buttons are not square). */
  height?: number;
  /** Fraction of the tile the icon should occupy. */
  iconScale?: number;
  onSelect: (spec: TileSpec) => void;
  /** Vertical room (design px) for the label before it collides with the next
   *  row/element — see TileLabel below. Defaults to a conservative value; the
   *  hub passes the actual design row pitch per tile group. */
  labelMaxH?: number;
  /** Work is running behind this tile (e.g. background generation/agent run):
   *  shows a small "typing bubble" badge at the tile's top-right corner. */
  busy?: boolean;
}

/** Chat-style typing bubble: dark pill with three softly pulsing dots. Sits
 *  OUTSIDE the tile's squircle clip (a sibling, not a child). Static under
 *  reduced motion — the badge itself is the signal; the pulse is garnish. */
function BusyBubble({ x, y }: { x: number; y: number }) {
  const { px } = usePx();
  const reduced = useReducedMotionConfig();
  return (
    <span style={{ position: 'absolute', left: px(x), top: px(y), width: px(44), height: px(30), borderRadius: px(15), background: colors.frameDark, boxShadow: `0 1px 4px ${inkTint(0.35)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: px(5), pointerEvents: 'none' }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i}
          style={{ display: 'block', width: px(6), height: px(6), borderRadius: '50%', background: colors.white }}
          animate={reduced ? { opacity: 0.9 } : { opacity: [0.35, 1, 0.35] }}
          transition={reduced ? undefined : { duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
      ))}
    </span>
  );
}


// A single word wider than its box is broken with `overflowWrap: anywhere` — that
// wrapping is the desired look for genuinely long translations (ru "Постройки" →
// two lines). But when a word overflows by only a hair (en "Generate" = ~130 in a
// ~129 box), the break orphans a single trailing letter onto its own row, which
// looks broken. So if fitting the word on ONE line needs no more than this much
// shrink, keep it on one line and scale it down instead of orphaning a letter.
const ORPHAN_MIN_SCALE = 0.86;

/**
 * A tile's label wraps (`overflowWrap: anywhere`) up to the vertical room before
 * the NEXT row/element (`maxH`, design px, from the design row pitch), then shrinks
 * so it never grows into the next row. The one exception is the 1-letter-orphan
 * case (see ORPHAN_MIN_SCALE): a word barely over the box is kept on one line and
 * shrunk a hair rather than dropping its last letter to a second row. No-op
 * (scale 1) whenever the label already fits — always true for en/zh (their widest
 * grid label, "Generate", only grazes the box → an imperceptible one-line 0.99).
 */
function TileLabel({ x, y, width, maxH, size, color, text }: { x: number; y: number; width: number; maxH: number; size: number; color: string; text: string }) {
  const { px, pxf, fw } = usePx();
  const ref = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  const [oneLine, setOneLine] = useState(true); // force nowrap for the orphan case
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    // A single token (no whitespace to wrap at) that overflows by just a hair:
    // keep it on one line, shrunk to fit, instead of orphaning its last letter.
    if (!/\s/.test(text)) {
      const naturalW = measureTextW(text, size); // design px (detects the "1-letter orphan" case below)
      if (naturalW > 0 && width / naturalW >= ORPHAN_MIN_SCALE) {
        setOneLine(true);
        setScale(Math.min(1, width / naturalW));
        return;
      }
    }
    // Otherwise let it wrap (overflowWrap: anywhere) and shrink only if the
    // wrapped block is taller than the row budget. scrollHeight is a pre-transform
    // layout metric (unaffected by the scale), so this converges.
    setOneLine(false);
    const hScale = el.scrollHeight > px(maxH) && el.scrollHeight > 0 ? px(maxH) / el.scrollHeight : 1;
    setScale(hScale);
  };
  useLayoutEffect(fit); // re-fits on language/size change (runs each render, converges via setState equality)
  useFontsReady(fit); // re-fit once the web font loads
  return (
    <span style={{ position: 'absolute', left: px(x), top: px(y), transform: 'translateX(-50%)', width: px(width), textAlign: 'center', pointerEvents: 'none', userSelect: 'none' }}>
      {/* BLOCK, never inline-block: an inline-level child sits on a line box whose STRUT comes
          from the inherited (unscaled) UA font, and it is baseline-aligned to that strut. The
          label's own font-size is scale-dependent while the strut is not, so the text slides
          down the moment the two diverge — the label visibly detaches from its tile at any
          scale where they differ (browser zoom, a resized window, uiZoom). A block child
          creates no line box in the parent, so the label's top IS its box top. Same reason
          FitText's outer box is flex. */}
      <span ref={ref} style={{
        display: 'block', width: '100%', transform: `scale(${scale})`, transformOrigin: 'top center',
        fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(size), lineHeight: 1.12, color,
        whiteSpace: oneLine ? 'nowrap' : 'normal',
        overflowWrap: oneLine ? 'normal' : 'anywhere',
      }}>
        {text}
      </span>
    </span>
  );
}

export function MenuTile({
  spec,
  height,
  iconScale = 0.8,
  onSelect,
  /** Vertical room (design px) available for the label before it would collide
   *  with the next row/element — see TileLabel. Callers pass the design row pitch. */
  labelMaxH = 60,
  busy,
}: MenuTileProps) {
  const t = useT();
  const { px } = usePx();
  const w = px(spec.size);
  const h = px(height ?? spec.size);
  const iconBox = Math.round(Math.min(w, h) * iconScale);

  const tileStyle: CSSProperties = {
    position: 'absolute',
    left: px(spec.x),
    top: px(spec.y),
    width: w,
    height: h,
    clipPath: squircleClip(w, h, px(spec.r)),
    background: spec.fill,
    border: 'none',
    padding: 0,
    cursor: cursors.clickable,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <>
      <motion.button
        type="button"
        style={tileStyle}
        onClick={() => onSelect(spec)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        transition={springs.stiff}
        aria-label={t(spec.labelKey)}
      >
        <Icon name={spec.icon} size={iconBox} />
      </motion.button>
      <TileLabel x={spec.x + spec.size / 2} y={spec.labelY} width={spec.size + 18} maxH={labelMaxH} size={29} color={spec.labelColor} text={t(spec.labelKey)} />
      {busy && <BusyBubble x={spec.x + spec.size - 26} y={spec.y - 12} />}
    </>
  );
}
