// A segmented switch with a sliding pill that animates as the selection moves between options.
// Shared by the export dialog and the settings modal so every multi-option toggle in the app
// animates identically.
//
// THE PILL is a SINGLE persistent element (not a per-option `layoutId` shared-layout node).
// Its geometry — the active button's measured offset box — is animated with a house spring, so
// the yellow pill visibly SLIDES (and resizes, in content-sized mode) from one option to the
// next. This deliberately avoids a `layoutId` shared-layout pill, which fails two ways:
//   (1) SLIDE: a per-option pill re-mounts on each switch; re-parenting between two
//       different-width buttons collapses the projected box to a near-zero-width sliver
//       mid-transition (reads as a flicker/teleport, not a slide).
//   (2) MODAL EXIT: a `layoutId` projection node is promoted out of its parent's opacity group,
//       so it lingers at full alpha while the enclosing modal card fades away ("the toggle
//       floats out of the box on close"). A plain persistent DOM child inherits the ancestor's
//       exit opacity in lockstep.
//
// i18n: option labels are forced to one line — a longer language (ru/fr, …) that doesn't fit an
// option's slot must never wrap to a second line (an uneven, ugly pill). In `stretch` mode
// (equal-width slots) labels are MEASURED against their actual rendered slot; if the widest
// option would overflow, every option shrinks by the same factor (one consistent size across the
// row) via a `transform: scale()` — the same technique as `ui/menu/FitText.tsx` (scale a nowrap
// span rather than reflow it). English/Chinese fit at the authored size, so this is a no-op
// (scale stays 1) for the baseline locales.
import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { colors, font, springs, cursors } from '../styles';

const PAD_X = 6; // stretch-mode button horizontal padding (each side) — see `btn.padding` below
const TRACK_PAD = 3; // wrap's own padding — see `wrap.padding` below, and the pill's top/bottom inset

// The measured box (relative to the positioned wrap) of the active option's button — where the
// sliding pill sits horizontally. `null` until the first layout measurement (pill not yet
// rendered). Only x/w are measured: every option's button is stretched (flex default
// align-items) to the SAME full track height, so the pill's vertical placement is a static
// `top/bottom: TRACK_PAD` inset (see `pill` style below) rather than a measured y/height — a
// measured height would be `offsetHeight`, an INTEGER in the unzoomed CSS-pixel space (per the
// offsetTop/offsetWidth spec), while the app renders under a `zoom` (see `useChromeScale`) that
// rescales that integer's rounding error along with everything else: a button whose true
// (fractional) height is e.g. 30.26px reads back as offsetHeight 30, and re-applying that 30 as
// the pill's own height under the same zoom renders 30·zoom, short of the button's true
// 30.26·zoom — a shortfall that (anchored at the top) lands entirely on the BOTTOM gap, reading
// as an off-center pill. An inset can't drift like this because the browser lays out both edges
// directly with no JS integer round-trip.
type PillBox = { x: number; w: number };

// A quick, crisp slide. `stiff` (600/30/0.5, ζ≈0.87 — slightly underdamped) is the house's fast
// spring: it snaps across the row in a few frames yet still visibly TRAVELS (its ~1px arrival
// overshoot is clipped by the track's `overflow: hidden`), so it reads as movement, not a
// teleport. Chosen over `gentle` (stiffness 200), which the user found too slow. Existing token.
const PILL_SPRING = springs.stiff;

export function SegmentedControl<T extends string>({
  value, options, onChange, render = (o) => String(o), idPrefix, stretch = true, fontSize = 12.5,
}: {
  value: T;
  options: readonly T[];
  onChange: (o: T) => void;
  render?: (o: T) => string;
  /** Unique namespace so each control's sliding pill animates independently. */
  idPrefix: string;
  /** Buttons fill the row (export) vs size to their content (inline settings toggle). */
  stretch?: boolean;
  fontSize?: number;
}) {
  const reduced = useReducedMotionConfig();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [scale, setScale] = useState(1);
  // The sliding pill's target box. `idPrefix` is used only to keep the pill's DOM
  // stable per control (React `key`), not as a Framer `layoutId` — see the header note.
  const [pillBox, setPillBox] = useState<PillBox | null>(null);

  // ONE measure pass drives both the overflow-scale (labels) and the pill geometry, off the
  // same rendered layout. Called every render (useLayoutEffect below), on font load, and on
  // resize. Both setState calls converge (number/reference equality) so it never loops.
  const measure = () => {
    // (a) overflow scale — stretch mode only (content-sized buttons never crowd their label).
    let next = 1;
    if (stretch) {
      for (let i = 0; i < options.length; i++) {
        const btnEl = btnRefs.current[i];
        const labelEl = labelRefs.current[i];
        if (!btnEl || !labelEl) continue;
        const available = btnEl.clientWidth - PAD_X * 2;
        const natural = labelEl.scrollWidth; // unaffected by the scale transform
        if (available > 0 && natural > available) next = Math.min(next, available / natural);
      }
    }
    setScale(next); // number — React bails when unchanged

    // (b) pill box — the active button's measured horizontal extent, relative to the positioned
    // wrap. Vertical is NOT measured — see the `PillBox` comment above.
    const activeEl = btnRefs.current[options.indexOf(value)];
    if (activeEl) {
      const box: PillBox = { x: activeEl.offsetLeft, w: activeEl.offsetWidth };
      setPillBox((prev) => (prev && prev.x === box.x && prev.w === box.w ? prev : box));
    }
  };
  useLayoutEffect(measure); // re-measure every render (value/language/width changes); converges via setState equality
  // Re-measure once the web font finishes loading (first measure may use a fallback metric), and
  // whenever the control resizes (stretch-mode slot widths change with the container).
  useEffect(() => {
    (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(measure);
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} style={{ ...wrap, ...(stretch ? null : { alignSelf: 'flex-start' }) }}>
      {/* The single persistent sliding pill — animates its box to the active option. It is an
          ordinary child of the wrap (no `layoutId`), so it slides cleanly AND fades in lockstep
          with an enclosing modal card's exit opacity. */}
      {pillBox && (
        <motion.span
          // Only x/width animate; y/height stay static — the pill's vertical box is fixed by
          // the wrap's insets, and a lingering inline translateY/height would over-constrain
          // the top/bottom inset (top+height wins, bottom is ignored) into a bottom-flush pill.
          // `y: 0` in `style` is the declared fallback, so if an animate key is ever removed
          // framer returns to it instead of freezing at a stale inline value; the versioned key
          // remounts the element when the animated-prop set changes (Fast Refresh keeps the DOM
          // alive across code swaps).
          key={`seg-pill-v2-${idPrefix}`}
          aria-hidden
          initial={false}
          animate={{ x: pillBox.x, width: pillBox.w }}
          transition={reduced ? { duration: 0 } : PILL_SPRING}
          style={{ ...pill, y: 0 }}
        />
      )}
      {options.map((o, i) => {
        const active = o === value;
        return (
          <motion.button
            key={o}
            ref={(el) => { btnRefs.current[i] = el; }}
            type="button"
            onClick={() => onChange(o)}
            whileTap={{ scale: 0.95 }}
            aria-pressed={active}
            style={{ ...btn, flex: stretch ? 1 : 'none', padding: stretch ? `8px ${PAD_X}px` : '6px 14px', fontSize, minWidth: 0 }}
          >
            <span
              ref={(el) => { labelRefs.current[i] = el; }}
              style={{ position: 'relative', zIndex: 1, display: 'inline-block', whiteSpace: 'nowrap', transform: scale < 1 ? `scale(${scale})` : undefined }}
            >
              {render(o)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

// `overflow: hidden` clips the sliding pill to the track: the pill animates on a
// slightly-underdamped house spring (`springs.stiff`), so on arrival it OVERSHOOTS
// its target box by ~1px and, at an END option, would briefly poke past the track's
// rounded edge. Clipping to the track's own stadium (borderRadius 999) contains that
// overshoot. At rest the pill is inset by the `TRACK_PAD` padding on every side, so its
// rounded corners sit inside the stadium and are never cut.
const wrap: CSSProperties = { position: 'relative', display: 'flex', gap: 4, background: colors.trackOff, borderRadius: 999, padding: TRACK_PAD, overflow: 'hidden' };
const btn: CSSProperties = { border: 'none', cursor: cursors.clickable, borderRadius: 999, fontFamily: font.family, fontWeight: 800, color: colors.frameDark, position: 'relative', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
// The pill's vertical placement is a static `top/bottom` inset (not measured/animated — see the
// `PillBox` comment), so it is symmetric BY CONSTRUCTION at every zoom/scale: the browser lays
// out both edges directly, with no JS offsetHeight integer round-trip to drift. Horizontal is
// still measured + animated (`x`/`width` in the `animate` prop above) from the active button's
// offset box; `left: 0` is that transform's origin.
// `height: 'auto'` is explicit (not merely omitted) so it doubles as the framer fallback for a
// removed animated height — see the key comment on the motion.span.
const pill: CSSProperties = { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, left: 0, height: 'auto', background: colors.tileYellow, borderRadius: 999, zIndex: 0 };
