/*
 * FitText.tsx — a language-adaptive label. The v2 panels are laid out at fixed
 * PSD coordinates tuned for the (compact) Chinese text; other languages can be
 * wider and overflow/overlap. FitText measures its content and, when it would
 * exceed the given slot width, scales it down uniformly to fit — so the Chinese
 * layout is the untouched base (it fits → scale 1) and longer languages shrink
 * gracefully in place instead of overflowing. Generic: no per-language casing.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { font } from '../styles';
import { usePx } from './scale';
import { useFontsReady } from '../hooks/useFontsReady';

interface Props {
  /** Anchor position (design px). center → translate(-50%,-50%); left → left edge at cx, vertically centered.
   *  Ignored when `flow` is set. */
  cx?: number;
  cy?: number;
  /** Available width in design px; content shrinks to fit this. */
  maxW: number;
  anchor?: 'center' | 'left';
  /** Render IN FLOW (static, not absolutely positioned) so a flex parent centers it exactly — avoids
   *  the sub-pixel top/bottom drift of absolute pxf positioning inside a px-rounded box. */
  flow?: boolean;
  /** Single-label styling (omit when children carry their own styles, e.g. a row group). */
  size?: number;
  color?: string;
  weight?: number;
  /** Optional outline (e.g. the submenu-title white stroke) via textShadow. */
  outline?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function FitText({ cx = 0, cy = 0, maxW, anchor = 'center', flow = false, size, color, weight = 900, outline, style, children }: Props) {
  const { px, pxf, fw } = usePx();
  const ref = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    const natural = el.scrollWidth; // layout width — unaffected by the scale transform
    const max = px(maxW);
    setScale(natural > max && natural > 0 ? max / natural : 1);
  };
  useLayoutEffect(fit); // runs each render (converges via setScale equality); re-fits on language/size change
  useFontsReady(fit); // re-fit once the web font loads (first measure may use a fallback metric)

  const inner: CSSProperties = size != null
    ? { fontFamily: font.family, fontWeight: fw(weight), fontSize: pxf(size), color, lineHeight: 1, ...(outline ? { textShadow: outline } : {}) }
    : {};

  // The outer box is a FLEX container (not inline-block): an inline outer joins an inline
  // formatting context with the host's UNSCALED UA font strut (buttons default to ~13px
  // system font, line-height normal), so the line box grows asymmetrically around the
  // scaled label — the text drifts off-center by ~1px in a scale/DPI-dependent way.
  // Flex blockifies the inner span: outer height == the label's own line box, always.
  // In-flow: a static box the parent (e.g. a flex-centered button) positions; only the fit-scale applies.
  //
  // `maxWidth` matters here and not in the absolute case. The fit is a TRANSFORM, which shrinks
  // what is painted and not what is laid out, so an in-flow label kept reserving its unscaled
  // width and shoved its flex siblings along — in French the help button beside "ID de recette"
  // was pushed under the value box and vanished. Capping the box makes the layout agree with what
  // the eye sees; a label that already fits is unaffected, since the cap is never below its width.
  const outer: CSSProperties = flow
    ? { display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: pxf(maxW),
        pointerEvents: 'none', userSelect: 'none', ...style }
    : { position: 'absolute', left: pxf(cx), top: pxf(cy), transform: anchor === 'center' ? 'translate(-50%, -50%)' : 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none', userSelect: 'none', ...style };

  return (
    <span style={outer}>
      <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', transform: `scale(${scale})`, transformOrigin: anchor === 'center' ? 'center' : 'left center', ...inner }}>
        {children}
      </span>
    </span>
  );
}
