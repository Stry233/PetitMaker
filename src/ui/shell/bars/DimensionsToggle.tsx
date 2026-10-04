import { useT } from '../../../i18n/context';
import { SCALE } from '../units';
import { OptionPill } from './OptionPill';

export function DimensionsToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const t = useT();
  return <OptionPill value={value ? 'show' : 'hide'} label={t('region.dimensions')} commandId="tool.auto_trim"
    onChange={next => onChange(next === 'show')} options={(['show', 'hide'] as const).map(mode => ({
      value: mode, label: t(mode === 'show' ? 'region.dimensions_show' : 'region.dimensions_hide'),
      glyph: <svg width={51 * SCALE} height={51 * SCALE} viewBox="0 0 28 28" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7h18v14H5zM10 7v5m4-5v3m4-3v5" />
          {mode === 'hide' && <path d="m4 24 20-20" />}
        </g>
      </svg>,
    }))} />;
}
