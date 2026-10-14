import { interactionProfiles, font, cursors, radii } from '../design/styles';
/** A persistent pill inherits its modal's exit opacity. Equal-width slots use fractional targets
 * so host resizing does not restart the selection spring; content-sized slots use measured offsets. */
import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { skin } from '../design/window-skin';
import { roleWeight, TEXT_ROLES } from '../design/text-weight';
import { useTransition } from '../design/motion/use-motion';
import { FRAME_INK } from '../design/tokens';

const PAD_X = 6; // stretch-mode button horizontal padding (each side) — see `btn.padding` below
const TRACK_PAD = 3; // wrap's own padding — see `wrap.padding` below, and the pill's top/bottom inset
const TRACK_GAP = 4; // the flex gap between buttons; the pill's fractions carry it (see the header)

// Horizontal offsets are local pixels; vertical insets avoid CSS-zoom rounding gaps.
type PillBox = { x: number; w: number };

export function SegmentedControl<T extends string>({
  value, options, onChange, render = (o) => String(o), label, idPrefix, stretch = true, fontSize = TEXT_ROLES.chip.px, height, wrapLabels = false,
}: {
  value: T;
  options: readonly T[];
  onChange: (o: T) => void;
  render?: (o: T) => ReactNode;
  /** Accessible name per option, for options drawn as icons. */
  label?: (o: T) => string;
  /** Unique namespace so each control's sliding pill animates independently. */
  idPrefix: string;
  /** Buttons fill the row (export) vs size to their content (inline settings toggle). */
  stretch?: boolean;
  /** A segment names a choice, so it is drawn at the `chip` rung. Passed only where a caller's row
   *  cannot hold that size. */
  fontSize?: number;
  /** The control's whole height in css px, for a caller whose row holds controls to one line (the
   *  generate strip). The buttons fill it; their vertical padding goes. Unset, the buttons size from
   *  their own padding as they always have. */
  height?: number;
  /** Allow complete labels in narrow settings columns. */
  wrapLabels?: boolean;
}) {
  const settle = useTransition('control.settle');
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The sliding pill's measured target box — non-stretch mode only (stretch computes its target
  // as a fraction at render time, no state needed). `idPrefix` is used only to keep the pill's
  // DOM stable per control (React `key`), not as a Framer `layoutId` — see the header note.
  const [pillBox, setPillBox] = useState<PillBox | null>(null);

  // The pill box — the active button's measured horizontal extent, relative to the positioned
  // wrap. Vertical is not measured — see the `PillBox` comment above. Called every render
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
  // The mount-time observers call the latest measure, so a resize after the value changed reads the
  // button that is active now.
  const measureRef = useRef(measure);
  measureRef.current = measure;
  // Re-measure once the web font finishes loading (first measure may use a fallback metric), and
  // whenever the control resizes (a content-sized slot's own width can change with the container).
  useEffect(() => {
    if (stretch) return; // nothing to re-measure — the fraction is resize-invariant by construction
    void (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => measureRef.current());
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [stretch]);

  const activeIndex = options.indexOf(value);
  const optionCount = options.length;

  return (
    <div ref={wrapRef} style={{ ...wrap, ...(stretch ? null : { alignSelf: 'flex-start' }), ...(height !== undefined ? { height, boxSizing: 'border-box' } : null) }}>
      {/* The single persistent sliding pill — animates its box to the active option. It is an
          ordinary child of the wrap (no `layoutId`), so it slides cleanly and fades in lockstep
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
            transition={settle}
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
            transition={settle}
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
            whileTap={interactionProfiles.actionTap.whileTap}
            aria-pressed={active}
            aria-label={label?.(o)}
            style={{
              ...btn, flex: stretch ? 1 : 'none', fontSize, minWidth: 0,
              padding: height !== undefined ? `0 ${stretch ? PAD_X : 14}px` : stretch ? `8px ${PAD_X}px` : '6px 14px',
            }}
          >
            <span style={{ position: 'relative', zIndex: 1, display: 'inline-block', whiteSpace: wrapLabels ? 'normal' : 'nowrap', overflowWrap: wrapLabels ? 'anywhere' : undefined }}>
              {render(o)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

// `overflow: hidden` clips the sliding pill to the track: the pill animates on a
// slightly-underdamped house spring (`control.settle`), so on arrival it overshoots
// its target box by ~1px and, at an end option, would briefly poke past the track's
// rounded edge. Clipping to the track's own stadium (borderRadius 999) contains that
// overshoot. At rest the pill is inset by the `TRACK_PAD` padding on every side, so its
// rounded corners sit inside the stadium and are never cut.
const wrap: CSSProperties = { position: 'relative', display: 'flex', gap: TRACK_GAP, background: skin.track, borderRadius: radii.pill, padding: TRACK_PAD, overflow: 'hidden' };
const btn: CSSProperties = { border: 'none', cursor: cursors.clickable, borderRadius: radii.pill, fontFamily: font.family, fontWeight: roleWeight('chip'), color: FRAME_INK, position: 'relative', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
// The pill's vertical placement is a static `top/bottom` inset, never measured or animated (the
// `PillBox` comment has why). Non-stretch mode only: horizontal is still measured + animated
// (`x`/`width` in the `animate` prop above) from the active button's offset box, since a
// content-sized slot has no fractional formula — `left: 0` is that transform's origin. Stretch mode
// uses `pillTrack`/`pillStretch` below instead.
// `height: 'auto'` is explicit (not merely omitted) so it doubles as the framer fallback for a
// removed animated height — see the key comment on the motion.span.
const pill: CSSProperties = { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, left: 0, height: 'auto', background: skin.active, borderRadius: radii.pill, zIndex: 0 };
// Stretch mode only. `pillTrack` insets to the wrap's content box (the wrap's own padding is
// `TRACK_PAD` on every side), so it is exactly the box the flexed buttons lay out in; the
// gap-aware fractions above then land on each button's own slot with no JS measurement at all
// (button i of n sits at i*(W+gap)/n in a gapped flex row). `pillStretch` fills it vertically the
// same static way `pill` does.
const pillTrack: CSSProperties = { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, left: TRACK_PAD, right: TRACK_PAD };
const pillStretch: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: skin.active, borderRadius: radii.pill, zIndex: 0 };
