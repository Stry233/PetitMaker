/** Brush width in cells, with one tick per available size. */
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
