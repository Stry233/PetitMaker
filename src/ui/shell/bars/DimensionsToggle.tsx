import { useT } from '../../../i18n/context';
import { OptionPill, OPTION_GLYPH } from './OptionPill';
import { MeasureIcon } from '../../primitives/line-glyphs';

/** Show or hide width and height. `commandId` names the key that cycles it; null leaves it to
 *  the pointer where the toolbar's keys are spoken for. */
export function DimensionsToggle({ value, onChange, commandId = 'tool.option_cycle' }: {
  value: boolean; onChange: (value: boolean) => void; commandId?: string | null;
}) {
  const t = useT();
  return <OptionPill value={value ? 'show' : 'hide'} label={t('region.dimensions')} commandId={commandId ?? undefined}
    onChange={next => onChange(next === 'show')} options={(['show', 'hide'] as const).map(mode => ({
      value: mode, label: t(mode === 'show' ? 'region.dimensions_show' : 'region.dimensions_hide'),
      glyph: <MeasureIcon size={OPTION_GLYPH} hidden={mode === 'hide'} />,
    }))} />;
}
