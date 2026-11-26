import { AUTO_EDGE_CUTS, type AutoEdgeCut } from '../../../../state/editing/vocabulary';
import { useT } from '../../../../i18n/context';
import { INK } from '../../../design/tokens';
import { EC_STATE_KEY, edgeCutGlyph } from './edge-cut-glyph';
import { OptionPill, OPTION_GLYPH } from '../OptionPill';

export function AutoTrim({ value, disabled, onChange }: {
  value: AutoEdgeCut; disabled: boolean; onChange: (value: AutoEdgeCut) => void;
}) {
  const t = useT();
  return <OptionPill helpTarget={{ page: 'terrain', anchor: 'terrain-autotrim-chip' }} value={value} options={AUTO_EDGE_CUTS.map(mode => ({
    value: mode, label: t(EC_STATE_KEY[mode]), glyph: edgeCutGlyph(mode, OPTION_GLYPH, INK),
  }))} label={t('edgecut.auto')} commandId="tool.option_cycle" disabled={disabled} onChange={onChange}/>;
}
