/*
 * Every bottom bar's slider: a track, ticks and a knob, the art and geometry passed in. The value's stops
 * and the drawn ticks are independent, and the knob travels between the outer ticks. A slider that cannot
 * act dims, takes the blocked cursor and stays (a one-stop range is that state).
 */
import { amplitude, presence } from '../../design/motion';
import { viewportSize } from '../../../platform/device/viewport-space';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotionConfig, type MotionValue } from 'framer-motion';
import { usePx } from '../../design/scale';
import { cursors, font, UNAVAILABLE, z, radii } from '../../design/styles';
import { useUiPreview } from '../../design/preview';
import { BarText, Plate } from './bar-atoms';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../use-frame-zoom';
import { PANEL_EDGE, PLATE, PLATE_INK } from '../../design/tokens';
import { useSliderInput } from '../../primitives/use-slider-input';
import { visualRect } from '../../design/visual-rect';

/** How far the bubble rises into place, in css px: the registry's own amplitude, since a distance
 *  typed at an element is the same unfindable decision a duration typed there is. */
const RISE = amplitude('slider.reading');

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
  /** The track takes its container's width, which the owner keeps between its narrowest and the
   *  drawing's: the right end and last stop come in by the difference, the stops close up evenly and
   *  the drawn ends keep their shape. Ticks and knob stand at shares of the track, so the value keeps
   *  its place on it while the width changes past React. */
  fill?: boolean;
}

export function BarSlider({
  art, shape, min, max, ticks, value, onChange, label, valueText, disabled, fill = false,
}: Props) {
  const { px } = usePx();
  const zoom = useFrameZoom();
  const travel = useRef<HTMLSpanElement>(null);
  const off = disabled || max <= min;
  // The knob's centre travels from `from` past the track's left end to `tail` short of its right end.
  const from = shape.first - shape.track.x;
  const tail = shape.track.x + shape.track.w - shape.last;
  const { props, ref, current, share, glide, reading } = useSliderInput<HTMLDivElement>({
    min, max, value, onChange, label, ...(valueText ? { valueText } : {}), off, track: travel,
    // A coarse step for the arrow keys on a wide range: a hundred presses to cross a slider is a
    // control no one uses twice.
    nudge: Math.max(1, Math.round((max - min) / 20)),
    // A value set from elsewhere (a tool switch onto another stored width) glides on the carried control's motion.
    elsewhere: 'tool.control.morph',
  });

  return (
    <div
      {...props}
      style={{
        position: 'relative', width: fill ? '100%' : px(shape.track.w), height: px(shape.track.h),
        // The groove drawn in this box is a stadium and a focus ring follows its own element's
        // corner, so a square box rings the slider as a rectangle cutting through the drawing.
        borderRadius: px(shape.track.h / 2),
        pointerEvents: 'auto', touchAction: 'none',
        cursor: off ? cursors.blocked : cursors.clickable,
        opacity: off ? UNAVAILABLE : 1,
      }}
    >
      {/* Taller only: the value is read across the track's own width. */}
      <TouchReach zoom={zoom} />
      {art.track && !fill ? (
        <Plate src={art.track} style={{ left: 0, top: 0, width: px(shape.track.w), height: px(shape.track.h) }} />
      ) : null}
      {/* Filling, the drawing's two ends each show in half the track, so neither cap is squeezed. */}
      {art.track && fill ? ([0, 1] as const).map((half) => art.track && (
        <span key={half} aria-hidden style={{ position: 'absolute', top: 0, height: px(shape.track.h), overflow: 'hidden', pointerEvents: 'none',
          left: half ? '50%' : 0, width: '50%' }}>
          <Plate src={art.track} style={{ top: 0, height: px(shape.track.h), width: px(shape.track.w),
            left: half ? `calc(100% - ${px(shape.track.w)}px)` : 0 }} />
        </span>
      )) : null}
      <span ref={travel} aria-hidden style={{ position: 'absolute', top: 0, height: '100%', left: px(from), right: px(tail), pointerEvents: 'none' }}>
        {Array.from({ length: ticks }, (_, i) => (
          <Plate
            key={i}
            src={art.tick}
            style={{
              left: `calc(${(i / Math.max(1, ticks - 1)) * 100}% - ${px(shape.tick / 2)}px)`,
              top: px(shape.centreY - shape.track.y - shape.tick / 2),
              width: px(shape.tick), height: px(shape.tick),
            }}
          />
        ))}
        {/* The knob stands at the value's share of the travel, so it keeps that share at any width; a box
            as wide as the travel moved by a transform instead would reach past the track and count as
            overflow in a row that scrolls. */}
        <motion.span style={{ position: 'absolute', top: 0, width: 0, height: 0, left: glide.percent }}>
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
      </span>
      {/* The bubble carries the reading above the track, deaf to the pointer and following the knob without lag. */}
      <AnimatePresence initial={false}>
        {reading ? (
        <SliderReading
          key="reading"
          anchor={ref} share={share} drawn={glide.share} from={px(from)} tail={px(tail)}
          text={valueText ?? String(current)}
        />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The reading follows the knob outside scroll clips; pictured controls stay inside their preview. */
function SliderReading({ anchor, share, drawn, from, tail, text }: {
  anchor: RefObject<HTMLDivElement>;
  /** The value's share of the knob's travel, which runs `from` css px past the track's left end to `tail` short of its right. */
  share: number;
  /** The knob's drawn share while it glides there. */
  drawn: MotionValue<number>;
  from: number; tail: number; text: string;
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
      // The track's own width in its local px, current even while its owner resizes it.
      const width = anchor.current?.offsetWidth ?? 0;
      const centre = from + drawn.get() * (width - from - tail);
      if (layer.current) {
        const zoom = rect && width > 0 ? rect.width / width : 0;
        const style = layer.current.style;
        // An anchor that measures nothing leaves the layer hidden rather than standing at the page origin.
        const visibility = zoom > 0 ? '' : 'hidden';
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
  }, [anchor, drawn, from, tail, pictured]);
  const reading = (
    <motion.span
      ref={bubble}
      data-testid="shell-slider-reading"
      aria-hidden
      {...readingMotion}
      style={{
        position: 'absolute', left: pictured ? `calc(${from}px + ${share} * (100% - ${from + tail}px))` : 0, bottom: '100%',
        translateX: '-50%', marginBottom: 6,
        padding: '2px 8px', borderRadius: radii.pill, background: PLATE,
        pointerEvents: 'none', whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', border: PANEL_EDGE,
      }}
    >
      <BarText role="chip" color={PLATE_INK} weight={800}>{text}</BarText>
    </motion.span>
  );
  return pictured ? reading : createPortal(
    <div ref={layer} style={{ position: 'fixed', visibility: 'hidden', zIndex: z.popover, pointerEvents: 'none', fontFamily: font.family }}>{reading}</div>,
    document.body,
  );
}
