import type { AutoEdgeCut } from '../../../core/model/types';
import { useT } from '../../../i18n/context';
import { INK } from '../../design/tokens';
import { SCALE } from '../units';
import { EC_STATE_KEY, edgeCutGlyph } from './edge-cut-glyph';
import { TerrainOptionPill } from './TerrainOptionPill';

const MODES: readonly AutoEdgeCut[] = ['off', 'rect', 'round'];

export function AutoTrim({ value, disabled, onChange }: {
  value: AutoEdgeCut; disabled: boolean; onChange: (value: AutoEdgeCut) => void;
}) {
  const t = useT();
  return <TerrainOptionPill value={value} options={MODES.map(mode => ({
    value: mode, label: t(EC_STATE_KEY[mode]), glyph: edgeCutGlyph(mode, 51 * SCALE, INK),
  }))} label={t('edgecut.auto')} commandId="tool.auto_trim" disabled={disabled} onChange={onChange}/>;
}
