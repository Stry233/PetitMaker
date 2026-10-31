/* The chosen segment wears one sliding plate. Its target is always a share of the control's own
 * box, never a pixel box, so a host resizing the control (a window gliding to a section's width)
 * leaves the target where it was: equal-width slots get their share from the slot count,
 * content-sized and wrapping slots from the active slot's measured share of the control. A persistent
 * plate inherits its modal's exit opacity. */
import { font, cursors, radii } from '../design/styles';
import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { skin } from '../design/window-skin';
import { roleWeight, TEXT_ROLES } from '../design/text-weight';
import { useTransition } from '../design/motion/use-motion';
import { visualRect } from '../design/visual-rect';
import { FRAME_INK } from '../design/tokens';
import { useInteractionProfiles } from '../design/input-mode';
import { onFontsSettled } from '../../assets/fonts/settled';

const PAD_X = 6; // stretch-mode button horizontal padding (each side) — see `btn.padding` below
const TRACK_PAD = 3; // wrap's own padding — see `wrap.padding` below, and the plate's top/bottom inset
const TRACK_GAP = 4; // the flex gap between buttons; the plate's fractions carry it (see the header)
/** Shares closer than this are one target (a hundredth of a px on a 1000 px control). */
const SAME_SHARE = 1e-5;

/** The active slot's left edge and width as fractions of the control's own border box, which is the
 *  plate's containing block (the control draws no border). */
type PlateShare = { left: number; width: number };

export function SegmentedControl<T extends string>({
  value, options, onChange, render = (o) => String(o), label, idPrefix, stretch = true, fontSize = TEXT_ROLES.chip.px, height, wrapLabels = false,
}: {
  value: T;
  options: readonly T[];
  onChange: (o: T) => void;
  render?: (o: T) => ReactNode;
  /** Accessible name per option, for options drawn as icons. */
  label?: (o: T) => string;
  /** Unique namespace so each control's sliding plate animates independently. */
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
  /** Allow complete labels in narrow columns: a label wraps between words, and a slot is never
   *  narrower than its longest word, taking that room from the others. */
  wrapLabels?: boolean;
}) {
  const slide = useTransition('control.plate.slide');
  const profiles = useInteractionProfiles();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [share, setShare] = useState<PlateShare | null>(null);
  // Equal-width slots take their share from the count; the others are measured.
  const measured = !stretch || wrapLabels;

  // Rects rather than offsets: offsets round to whole px, which leaves the plate up to half a px off
  // its slot, more once a lifted zoom draws it. Both rects sit under the same zoom, so their ratio is
  // the layout ratio on every engine. A slot's press scales its label, never the slot, so the rect
  // read at the press's release is the slot's layout box.
  const measure = () => {
    if (!measured) return;
    const wrapEl = wrapRef.current;
    const activeEl = btnRefs.current[options.indexOf(value)];
    if (!wrapEl || !activeEl) return;
    const w = visualRect(wrapEl);
    // A control laid out at no width (a hidden section) keeps the share it had.
    if (!(w.width > 0)) return;
    const b = visualRect(activeEl);
    const next: PlateShare = { left: (b.left - w.left) / w.width, width: b.width / w.width };
    setShare((prev) => (prev && Math.abs(prev.left - next.left) < SAME_SHARE && Math.abs(prev.width - next.width) < SAME_SHARE ? prev : next));
  };
  useLayoutEffect(measure);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  // A web font arriving re-flows the labels, and a wrapping slot's share changes with the room it is
  // given, so both re-measure.
  useEffect(() => {
    if (!measured) return;
    const stopFonts = onFontsSettled(() => measureRef.current());
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return stopFonts;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el);
    return () => { stopFonts(); ro.disconnect(); };
  }, [measured]);

  const activeIndex = options.indexOf(value);
  const optionCount = options.length;
  // A gesture label rather than the press's own target: the label shrinks under the finger while the
  // slot keeps the box the plate is measured from.
  const pressed = { pressed: profiles.actionTap.whileTap };

  return (
    <div ref={wrapRef} style={{ ...wrap, ...(stretch ? null : { alignSelf: 'flex-start' }), ...(height !== undefined ? { height, boxSizing: 'border-box' } : null) }}>
      {/* One persistent plate, an ordinary child of the control (no `layoutId`), so it slides inside
          the control and fades in lockstep with an enclosing modal card's exit opacity. */}
      {!measured ? (
        // Inset to the buttons' own content box, so the gap-aware fractions land on each flexed slot
        // (slot i of n sits at i*(W+gap)/n in a gapped flex row).
        <div style={plateTrack}>
          <motion.span
            key={`seg-pill-v3-${idPrefix}`}
            aria-hidden
            initial={false}
            animate={{
              left: `calc((100% + ${TRACK_GAP}px) * ${activeIndex / optionCount})`,
              width: `calc((100% - ${TRACK_GAP * (optionCount - 1)}px) / ${optionCount})`,
            }}
            transition={slide}
            style={plate}
          />
        </div>
      ) : (
        share && (
          <motion.span
            // The versioned key remounts the plate when its animated-prop set changes, since Fast
            // Refresh keeps the DOM, and a stale inline transform from an older set would stay.
            key={`seg-pill-v4-${idPrefix}`}
            aria-hidden
            initial={false}
            animate={{ left: `${share.left * 100}%`, width: `${share.width * 100}%` }}
            transition={slide}
            style={{ ...plate, top: TRACK_PAD, bottom: TRACK_PAD }}
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
            whileTap="pressed"
            aria-pressed={active}
            aria-label={label?.(o)}
            style={{
              // `overflow: hidden` would resolve an automatic least width to 0, so a wrapping slot names its own.
              ...btn, flex: stretch ? 1 : 'none', fontSize, minWidth: wrapLabels ? 'min-content' : 0,
              padding: height !== undefined ? `0 ${stretch ? PAD_X : 14}px` : stretch ? `8px ${PAD_X}px` : '6px 14px',
            }}
          >
            <motion.span
              variants={pressed}
              transition={profiles.actionTap.transition}
              style={{
                position: 'relative', zIndex: 1, display: 'inline-block', whiteSpace: wrapLabels ? 'normal' : 'nowrap',
                // A wrapped label's box takes the slot's width, so its lines centre within it.
                textAlign: 'center', overflowWrap: wrapLabels ? 'break-word' : undefined,
              }}
            >
              {render(o)}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}

// `overflow: hidden` keeps the plate inside the track's stadium while a host's glide redraws it.
const wrap: CSSProperties = { position: 'relative', display: 'flex', gap: TRACK_GAP, background: skin.track, borderRadius: radii.pill, padding: TRACK_PAD, overflow: 'hidden' };
const btn: CSSProperties = { border: 'none', cursor: cursors.clickable, borderRadius: radii.pill, fontFamily: font.family, fontWeight: roleWeight('chip'), color: FRAME_INK, position: 'relative', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
// The plate's vertical box is a static inset, never measured or animated, so CSS-zoom rounding opens
// no gap between it and the track.
const plateTrack: CSSProperties = { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, left: TRACK_PAD, right: TRACK_PAD };
const plate: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: skin.active, borderRadius: radii.pill, zIndex: 0 };
