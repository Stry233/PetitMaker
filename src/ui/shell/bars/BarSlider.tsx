/*
 * BarSlider.tsx — the slider every bottom bar uses: a track, a row of tick marks, and a knob.
 *
 * The design draws one slider and reuses it, so this takes the art and the geometry as arguments
 * rather than importing either. Two numbers are deliberately independent: how many STOPS the value
 * has (the engine's range) and how many TICKS are drawn (the design's marks). The brush has five
 * stops; the generate sliders have a hundred and one. Neither wants a tick per stop.
 *
 * The knob's travel is the span between the outer ticks, so a stop lands on its mark rather than at
 * the plate's edge.
 *
 * A SLIDER THAT CANNOT BE MOVED SAYS SO. Some contexts leave one meaningless — a rectangle takes no
 * brush width, a water island has one layer to reach — and an inert control that still looks live is
 * a lie: it gets dragged, nothing happens, and the app reads as broken. So it dims and takes the
 * blocked cursor, the same pair the layer panel's spent arrows wear, and it STAYS: removing it would
 * reflow the row every time the context changed, and a knob you can see not applying is information.
 * A single-stop range (`min === max`) is that state by construction and needs no caller to say so.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { usePx } from '../../design/scale';
import { cursors, font, UNAVAILABLE, z } from '../../design/styles';
import { useUiPreview } from '../../primitives/ui-preview';
import { BarText, Plate } from './bar-atoms';
import { PANEL_EDGE, PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { MOTIONS } from '../motion/registry';
import { useMotion } from '../motion/use-motion';

/** How far the bubble rises into place, in css px: the registry's own amplitude, since a distance
 *  typed at an element is the same unfindable decision a duration typed there is. */
const RISE = MOTIONS['slider.reading'].amplitude ?? 0;

/** Where the parts of a slider are drawn, in design px. */
export interface SliderShape {
  track: { x: number; y: number; w: number; h: number };
  /** Tick centres the knob's own centre travels between. */
  first: number;
  last: number;
  centreY: number;
  tick: number;
  knob: number;
  pip: number;
}

export interface SliderArt {
  /** Optional: a slider standing on a plate the same colour as the drawn track has to have the
   *  groove drawn behind it by whatever owns that plate, and passes no track here. */
  track?: string;
  knob: string;
  pip: string;
  tick: string;
}

interface Props {
  art: SliderArt;
  shape: SliderShape;
  min: number;
  max: number;
  /** How many marks to draw. Two would be the ends alone; the design draws three. */
  ticks: number;
  value: number;
  onChange: (v: number) => void;
  label: string;
  /** Value announced to a screen reader when the number alone would not say what it means, and the
   *  reading the hover bubble shows. */
  valueText?: string;
  /** The context this slider is standing in has nothing for it to set. A range with one stop is
   *  already unavailable without being told. */
  disabled?: boolean;
}

export function BarSlider({
  art, shape, min, max, ticks, value, onChange, label, valueText, disabled,
}: Props) {
  const { px } = usePx();
  const ref = useRef<HTMLDivElement>(null);
  /*
   * THE READING LIVES ON THE KNOB, and only while a hand is on the slider.
   *
   * Standing permanently to the LEFT of every track with the setting's name beside it, it costs twice:
   * a row of names and numbers spends most of the strip's width on labels for controls whose own
   * drawing already says what they are, and a reading that is always there is read once and then
   * never again. On the knob it answers the question at the moment it is asked -- which value am I
   * on -- and it costs the row nothing the rest of the time.
   *
   * Shown while HOVERED or while DRAGGING, since a drag takes the pointer off the knob and a bubble
   * that vanished mid-drag would hide exactly the number being chosen.
   */
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const off = disabled || max <= min;
  // Shown even while the slider REFUSES: a control that has nothing to set is the one most in need of
  // saying so, and its reading is where the reason goes ("n/a" beside the setting's own name). It is
  // the only thing a refusing slider still does.
  const showReading = hovered || dragging;
  const steps = Math.max(1, max - min);
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  const current = clamp(value);
  const from = shape.first - shape.track.x;
  const span = shape.last - shape.first;
  const centre = from + ((current - min) / steps) * span;
  // A coarse step for the arrow keys on a wide range: a hundred presses to cross a slider is a
  // control no one uses twice.
  const nudge = Math.max(1, Math.round(steps / 20));

  // Measured as a FRACTION of the track's own rect, never against `px()`: the frame is drawn under
  // a page zoom, so a rect (and a pointer coordinate) is in screen px where `px()` is in the
  // frame's own, and the two differ by exactly that zoom.
  const pick = (clientX: number): void => {
    if (off) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const atDesign = ((clientX - rect.left) / rect.width) * shape.track.w;
    onChange(clamp(min + Math.round(((atDesign - from) / span) * steps)));
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={off ? -1 : 0}
      aria-label={label}
      aria-disabled={off || undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={current}
      {...(valueText ? { 'aria-valuetext': valueText } : {})}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
        pick(e.clientX);
      }}
      onPointerMove={(e) => { if (e.buttons) pick(e.clientX); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onKeyDown={(e) => {
        if (off) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(clamp(current + nudge));
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(clamp(current - nudge));
        else if (e.key === 'Home') onChange(min);
        else if (e.key === 'End') onChange(max);
        else return;
        e.preventDefault();
      }}
      style={{
        position: 'relative', width: px(shape.track.w), height: px(shape.track.h),
        // The groove drawn in this box is a stadium and a focus ring follows its own element's
        // corner, so a square box rings the slider as a rectangle cutting through the drawing.
        borderRadius: px(shape.track.h / 2),
        pointerEvents: 'auto', touchAction: 'none',
        cursor: off ? cursors.blocked : cursors.clickable,
        opacity: off ? UNAVAILABLE : 1,
      }}
    >
      {art.track ? (
        <Plate src={art.track} style={{ left: 0, top: 0, width: px(shape.track.w), height: px(shape.track.h) }} />
      ) : null}
      {Array.from({ length: ticks }, (_, i) => (
        <Plate
          key={i}
          src={art.tick}
          style={{
            left: px(from + (i / Math.max(1, ticks - 1)) * span - shape.tick / 2),
            top: px(shape.centreY - shape.track.y - shape.tick / 2),
            width: px(shape.tick), height: px(shape.tick),
          }}
        />
      ))}
      <Plate
        src={art.knob}
        style={{
          left: px(centre - shape.knob / 2), top: px(shape.centreY - shape.track.y - shape.knob / 2),
          width: px(shape.knob), height: px(shape.knob),
        }}
      />
      <Plate
        src={art.pip}
        style={{
          left: px(centre - shape.pip / 2), top: px(shape.centreY - shape.track.y - shape.pip / 2),
          width: px(shape.pip), height: px(shape.pip),
        }}
      />
      {/* The bubble carries the READING; the setting's name stands beside the track (the strip's
          `Knob`), so here it would repeat itself. Centred on the knob and standing ABOVE the track,
          where the strip has air and what it covers is the map rather than another control.
          `pointerEvents: none` so it can never take the press meant for the slider under it, and no
          transition on `left`: it has to be exactly on the knob at every step of a drag, and a lag
          reads as the number belonging to the previous value. */}
      <AnimatePresence initial={false}>
        {showReading ? (
        <SliderReading
          key="reading"
          anchor={ref} centre={px(centre)} width={px(shape.track.w)}
          text={valueText ?? String(current)}
        />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The reading follows the knob outside scroll clips; pictured controls stay inside their preview. */
function SliderReading({ anchor, centre, width, text }: {
  anchor: RefObject<HTMLDivElement>; centre: number; width: number; text: string;
}) {
  const pictured = useUiPreview();
  const layer = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const readingMotion = useMotion('slider.reading');
  useLayoutEffect(() => {
    if (pictured) return;
    let raf = 0;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect && layer.current) {
        const zoom = rect.width / width;
        if (zoom > 0) {
          const half = (bubble.current?.offsetWidth ?? 0) * zoom / 2;
          const x = Math.max(half + 6, Math.min(window.innerWidth - half - 6, rect.left + centre * zoom));
          const style = layer.current.style;
          const left = `${x / zoom}px`, top = `${rect.top / zoom}px`;
          if (style.zoom !== String(zoom)) style.zoom = String(zoom);
          if (style.left !== left) style.left = left;
          if (style.top !== top) style.top = top;
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [anchor, centre, width, pictured]);
  const reading = (
    <motion.span
      ref={bubble}
      data-testid="shell-slider-reading"
      aria-hidden
      initial={{ opacity: 0, y: RISE }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: RISE }}
      transition={readingMotion}
      style={{
        position: 'absolute', left: pictured ? centre : 0, bottom: '100%',
        translateX: '-50%', marginBottom: 6,
        padding: '2px 8px', borderRadius: 999, background: PLATE,
        pointerEvents: 'none', whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', border: PANEL_EDGE,
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK} weight={800}>{text}</BarText>
    </motion.span>
  );
  return pictured ? reading : createPortal(
    <div ref={layer} style={{ position: 'fixed', zIndex: z.popover, pointerEvents: 'none', fontFamily: font.family }}>{reading}</div>,
    document.body,
  );
}
