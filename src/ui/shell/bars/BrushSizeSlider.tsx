/** Brush width in cells, with one tick per available size; `of` sets another count of cells on the
 *  same five stops (a Paint stroke's spacing). */
import { useT } from '../../../i18n/context';
import { BarSlider } from './BarSlider';
import { Groove } from './bar-atoms';
import { usePanelTone } from './bar-panel';
import { BRUSH, CELL_BOX } from './terrain-cells';
import { SCALE } from '../units';

import track from '../../../assets/shell/shelf-mountain/brush-size/roundrect.svg';
import knob from '../../../assets/shell/shelf-mountain/brush-size/ellipse-1.svg';
import pip from '../../../assets/shell/shelf-mountain/brush-size/ellipse-2.svg';
import tick from '../../../assets/shell/shelf-mountain/brush-size/ticks/ellipse-1.svg';

/** A count of cells the slider sets in place of the brush's size: its range, as many stops as the
 *  brush's, and its name. */
export interface SliderMeaning { min: number; max: number; label: string }

export const SLIDER_LIFT = CELL_BOX.h / 2 - (BRUSH.centreY - BRUSH.track.y) * SCALE;

/** The narrowest the brush track draws, in design px: its stops half a knob apart, still each a
 *  distinct place for a finger. */
export const BRUSH_MIN_TRACK = BRUSH.track.w - (BRUSH.last - BRUSH.first) + (BRUSH.max - BRUSH.min) * BRUSH.knob / 2;

export function BrushSizeSlider({ value, onChange, disabled, fill = false, of }: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  of?: SliderMeaning;
  /** The track takes its container's width, which the owner keeps between `BRUSH_MIN_TRACK` and the drawing's. */
  fill?: boolean;
}) {
  const t = useT();
  // The drawn track is the dark plate's colour, so on that plate the groove stands in for it.
  const dark = usePanelTone() === 'dark';
  const slider = (
    <BarSlider
      art={dark ? { knob, pip, tick } : { track, knob, pip, tick }}
      shape={BRUSH}
      min={of?.min ?? BRUSH.min}
      max={of?.max ?? BRUSH.max}
      ticks={BRUSH.max - BRUSH.min + 1}
      value={value}
      onChange={onChange}
      label={of?.label ?? t('design.brush_size')}
      valueText={t('units.cells', { n: value })}
      disabled={disabled}
      fill={fill}
    />
  );
  if (!dark) return slider;
  return <span style={{ position: 'relative', display: 'flex', width: fill ? '100%' : 'fit-content' }}><Groove />{slider}</span>;
}
