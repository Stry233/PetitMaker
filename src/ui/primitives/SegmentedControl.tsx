// A segmented switch with a sliding pill that animates as the selection moves between options.
// The ONE multi-option toggle, so every one of them in the app animates identically.
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
// option's slot must never wrap to a second line (an uneven, ugly pill). The label is drawn at the
// size it is asked for and never shrunk to its slot: a control is sized by its text, not the other
// way round, so a row that does not fit is fixed where the room is decided. (The scale-to-fit this
// carried was measured across all seven locales at every place this control appears and never once
// engaged, so it only stood as an invitation to size a window by shrinking its words.)
//
// STRETCH MODE'S PILL TARGET IS A FRACTION, NEVER A MEASURED PIXEL. Every option there is an equal
// `flex: 1` slot in a `gap`ped row, so option i of n sits at `left: (i/n)*(100% + gap)` with
// `width: (100% - gap*(n-1))/n` — geometry the DOM already guarantees without asking it (the gap
// terms matter: the plain (i/n)*100% form runs the pill gap*(n-1)/n too wide and up to a whole gap
// off its button). A host card that itself resizes (e.g. tweening to fit a new
// panel) used to re-measure the active button's px offset on every tick, re-aiming the pill's spring
// at a freshly-moved destination mid-flight; a spring chasing a moving target reads as a bounce no
// matter how the card's own resize is eased. A fraction cannot move under a resize, so the track
// carries the pill passively and the spring only ever animates an actual INDEX change. Only
// non-stretch (content-sized) mode still measures: there a slot's width depends on its own text, which
// has no fractional formula, so px measurement is the only source of truth.
import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { colors, font, springs, cursors } from '../design/styles';
import { skin } from '../design/window-skin';

const PAD_X = 6; // stretch-mode button horizontal padding (each side) — see `btn.padding` below
const TRACK_PAD = 3; // wrap's own padding — see `wrap.padding` below, and the pill's top/bottom inset
const TRACK_GAP = 4; // the flex gap between buttons; the pill's fractions carry it (see the header)

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
// Only used in non-stretch (content-sized) mode — see the STRETCH MODE header note.
type PillBox = { x: number; w: number };

// A quick, crisp slide. `stiff` (600/30/0.5, ζ≈0.87 — slightly underdamped) is the house's fast
// spring: it snaps across the row in a few frames yet still visibly TRAVELS (its ~1px arrival
// overshoot is clipped by the track's `overflow: hidden`), so it reads as movement, not a
// teleport. Chosen over `gentle` (stiffness 200), which the user found too slow. Existing token.
const PILL_SPRING = springs.stiff;

export function SegmentedControl<T extends string>({
  value, options, onChange, render = (o) => String(o), idPrefix, stretch = true, fontSize = 12.5, height,
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
  /** The control's whole height in css px, for a caller whose row holds controls to one line (the
   *  generate strip). The buttons fill it; their vertical padding goes. Unset, the buttons size from
   *  their own padding as they always have. */
  height?: number;
}) {
  const reduced = useReducedMotionConfig();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The sliding pill's measured target box — non-stretch mode only (stretch computes its target
  // as a fraction at render time, no state needed). `idPrefix` is used only to keep the pill's
  // DOM stable per control (React `key`), not as a Framer `layoutId` — see the header note.
  const [pillBox, setPillBox] = useState<PillBox | null>(null);

  // The pill box — the active button's measured horizontal extent, relative to the positioned
  // wrap. Vertical is NOT measured — see the `PillBox` comment above. Called every render
  // (useLayoutEffect below), on font load, and on resize; converges via setState equality.
  const measure = () => {
    if (stretch) return; // fractional target, nothing to measure — see the header note
    const activeEl = btnRefs.current[options.indexOf(value)];
    if (activeEl) {
      const box: PillBox = { x: activeEl.offsetLeft, w: activeEl.offsetWidth };
      setPillBox((prev) => (prev && prev.x === box.x && prev.w === box.w ? prev : box));
    }
  };
  useLayoutEffect(measure); // re-measure every render (value/language/width changes)
  // Re-measure once the web font finishes loading (first measure may use a fallback metric), and
  // whenever the control resizes (a content-sized slot's own width can change with the container).
  useEffect(() => {
    if (stretch) return; // nothing to re-measure — the fraction is resize-invariant by construction
    (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(measure);
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeIndex = options.indexOf(value);
  const optionCount = options.length;

  return (
    <div ref={wrapRef} style={{ ...wrap, ...(stretch ? null : { alignSelf: 'flex-start' }), ...(height !== undefined ? { height, boxSizing: 'border-box' } : null) }}>
      {/* The single persistent sliding pill — animates its box to the active option. It is an
          ordinary child of the wrap (no `layoutId`), so it slides cleanly AND fades in lockstep
          with an enclosing modal card's exit opacity. */}
      {stretch ? (
        // Inset to the buttons' own content box (the wrap's padding on every side is `TRACK_PAD`),
        // so the gap-aware fractions inside it land exactly on the button row's flexed geometry.
        <div style={pillTrack}>
          <motion.span
            key={`seg-pill-v3-${idPrefix}`}
            aria-hidden
            initial={false}
            animate={{
              left: `calc((100% + ${TRACK_GAP}px) * ${activeIndex / optionCount})`,
              width: `calc((100% - ${TRACK_GAP * (optionCount - 1)}px) / ${optionCount})`,
            }}
            transition={reduced ? { duration: 0 } : PILL_SPRING}
            style={pillStretch}
          />
        </div>
      ) : (
        pillBox && (
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
        )
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
            style={{
              ...btn, flex: stretch ? 1 : 'none', fontSize, minWidth: 0,
              padding: height !== undefined ? `0 ${stretch ? PAD_X : 14}px` : stretch ? `8px ${PAD_X}px` : '6px 14px',
            }}
          >
            <span style={{ position: 'relative', zIndex: 1, display: 'inline-block', whiteSpace: 'nowrap' }}>
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
const wrap: CSSProperties = { position: 'relative', display: 'flex', gap: TRACK_GAP, background: skin.track, borderRadius: 999, padding: TRACK_PAD, overflow: 'hidden' };
const btn: CSSProperties = { border: 'none', cursor: cursors.clickable, borderRadius: 999, fontFamily: font.family, fontWeight: 800, color: colors.frameDark, position: 'relative', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
// The pill's vertical placement is a static `top/bottom` inset (not measured/animated — see the
// `PillBox` comment), so it is symmetric BY CONSTRUCTION at every zoom/scale: the browser lays
// out both edges directly, with no JS offsetHeight integer round-trip to drift. NON-STRETCH MODE
// ONLY: horizontal is still measured + animated (`x`/`width` in the `animate` prop above) from the
// active button's offset box, since a content-sized slot has no fractional formula — `left: 0` is
// that transform's origin. Stretch mode uses `pillTrack`/`pillStretch` below instead.
// `height: 'auto'` is explicit (not merely omitted) so it doubles as the framer fallback for a
// removed animated height — see the key comment on the motion.span.
const pill: CSSProperties = { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, left: 0, height: 'auto', background: skin.active, borderRadius: 999, zIndex: 0 };
// STRETCH MODE ONLY. `pillTrack` insets to the wrap's content box (the wrap's own padding is
// `TRACK_PAD` on every side), so it is exactly the box the flexed buttons lay out in; the
// gap-aware fractions above then land on each button's own slot with no JS measurement at all
// (button i of n sits at i*(W+gap)/n in a gapped flex row). `pillStretch` fills it vertically the
// same static way `pill` does.
const pillTrack: CSSProperties = { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, left: TRACK_PAD, right: TRACK_PAD };
const pillStretch: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: skin.active, borderRadius: 999, zIndex: 0 };
