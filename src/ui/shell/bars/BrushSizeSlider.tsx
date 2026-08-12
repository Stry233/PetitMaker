/*
 * BrushSizeSlider.tsx — how many cells wide the brush lays, 1 to 5.
 *
 * Five stops, not the three dots the design source drew: those are tick marks in the drawing, and
 * the brush has always taken 1..5. Here the stops and the marks happen to line up, so it draws one
 * mark per stop.
 */
import { useT } from '../../../i18n/context';
import { BarSlider } from './BarSlider';
import { BRUSH } from './terrain-cells';

import track from '../../../assets/shell/shelf-mountain/brush-size/roundrect.svg';
import knob from '../../../assets/shell/shelf-mountain/brush-size/ellipse-1.svg';
import pip from '../../../assets/shell/shelf-mountain/brush-size/ellipse-2.svg';
import tick from '../../../assets/shell/shelf-mountain/brush-size/ticks/ellipse-1.svg';

export function BrushSizeSlider({ value, onChange, disabled }: {
  value: number;
  onChange: (v: number) => void;
  /** The armed tool lays a figure of its own size — a rectangle, a circle — or lays nothing, so
   *  there is no width for this to set. It stays on the row and refuses. */
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <BarSlider
      art={{ track, knob, pip, tick }}
      shape={BRUSH}
      min={BRUSH.min}
      max={BRUSH.max}
      ticks={BRUSH.max - BRUSH.min + 1}
      value={value}
      onChange={onChange}
      label={t('design.brush_size')}
      valueText={t(value === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: value })}
      disabled={disabled}
    />
  );
}
