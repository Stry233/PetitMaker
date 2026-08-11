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
import { useRef } from 'react';
import { usePx } from '../../design/scale';
import { cursors, UNAVAILABLE } from '../../design/styles';
import { Plate } from './bar-atoms';

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
  /** Value announced to a screen reader when the number alone would not say what it means. */
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
  const off = disabled || max <= min;
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
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) pick(e.clientX); }}
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
    </div>
  );
}
