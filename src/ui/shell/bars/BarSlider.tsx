/*
 * Every bottom bar's slider: a track, ticks and a knob, the art and geometry passed in. The value's stops
 * and the drawn ticks are independent, and the knob travels between the outer ticks. A slider that cannot
 * act dims, takes the blocked cursor and stays (a one-stop range is that state).
 */
import { presence } from '../../design/motion';
import { clientPoint, viewportSize } from '../../../platform/device/viewport-space';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { usePx } from '../../design/scale';
import { cursors, font, UNAVAILABLE, z, radii } from '../../design/styles';
import { useUiPreview } from '../../design/preview';
import { BarText, Plate } from './bar-atoms';
import { PANEL_EDGE, PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { MOTIONS } from '../../design/motion/registry';
import { useTransition } from '../../design/motion/use-motion';
import { visualRect } from '../../design/visual-rect';

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

interface SliderArt {
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
  const glide = useTransition('tool.control.morph');
  /* The reading lives on the knob while it is hovered or dragged. */
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const off = disabled || max <= min;
  // Shown even while the slider refuses: its reading is where the reason goes.
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

  // Measured as a fraction of the track's rect, never `px()`: rects and pointers are in screen px under the zoom.
  const pick = (clientX: number): void => {
    if (off) return;
    const rect = ref.current ? visualRect(ref.current) : null;
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
        pick(clientPoint(e).x);
      }}
      onPointerMove={(e) => { if (e.buttons) pick(clientPoint(e).x); }}
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
      {/* A value set from elsewhere (a tool switch onto another stored width) glides the knob there;
          under the hand it follows at once. */}
      <motion.span aria-hidden initial={false} animate={{ x: px(centre) }} transition={dragging ? { duration: 0 } : glide}
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
        <Plate
          src={art.knob}
          style={{
            left: px(-shape.knob / 2), top: px(shape.centreY - shape.track.y - shape.knob / 2),
            width: px(shape.knob), height: px(shape.knob),
          }}
        />
        <Plate
          src={art.pip}
          style={{
            left: px(-shape.pip / 2), top: px(shape.centreY - shape.track.y - shape.pip / 2),
            width: px(shape.pip), height: px(shape.pip),
          }}
        />
      </motion.span>
      {/* The bubble carries the reading above the track, deaf to the pointer and following the knob without lag. */}
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
  const readingMotion = presence('slider.reading', { opacity: 0, y: RISE }, { reduced: useReducedMotionConfig() });
  useLayoutEffect(() => {
    if (pictured) return;
    let raf = 0;
    const place = () => {
      const rect = anchor.current ? visualRect(anchor.current) : null;
      if (layer.current) {
        const zoom = rect ? rect.width / width : 0;
        const style = layer.current.style;
        // An anchor that measures nothing leaves the layer hidden rather than standing at the page origin.
        const visibility = zoom > 0 ? 'visible' : 'hidden';
        if (style.visibility !== visibility) style.visibility = visibility;
        if (rect && zoom > 0) {
          const half = (bubble.current?.offsetWidth ?? 0) * zoom / 2;
          const x = Math.max(half + 6, Math.min(viewportSize().width - half - 6, rect.left + centre * zoom));
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
      {...readingMotion}
      style={{
        position: 'absolute', left: pictured ? centre : 0, bottom: '100%',
        translateX: '-50%', marginBottom: 6,
        padding: '2px 8px', borderRadius: radii.pill, background: PLATE,
        pointerEvents: 'none', whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', border: PANEL_EDGE,
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK} weight={800}>{text}</BarText>
    </motion.span>
  );
  return pictured ? reading : createPortal(
    <div ref={layer} style={{ position: 'fixed', visibility: 'hidden', zIndex: z.popover, pointerEvents: 'none', fontFamily: font.family }}>{reading}</div>,
    document.body,
  );
}
