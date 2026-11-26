import { useT } from '../../../../i18n/context';
import { TERRAIN_THICKNESSES } from '../../../../state/editing/edit-mode';
import { LayersIcon } from '../../../primitives/line-glyphs';
import { OptionPill, OPTION_GLYPH } from '../OptionPill';
import { useCommandTitle } from '../bar-atoms';

/** How many layers a mountain stroke builds or takes: each option shows only its glyph and names its count. */
export function Thickness({ value, onChange }: { value: number; onChange: (layers: number) => void }) {
  const t = useT();
  const titleOf = useCommandTitle();
  const options = TERRAIN_THICKNESSES.map((layers) => {
    const name = t('terrain.thickness_option', { n: layers });
    return { value: String(layers), name, title: titleOf(name, 'tool.thickness_cycle'), glyph: <LayersIcon layers={layers} size={OPTION_GLYPH}/> };
  });
  return <OptionPill helpTarget={{ page: 'terrain', anchor: 'terrain-thickness' }} value={String(value)} options={options}
    label={t('terrain.thickness')} commandId="tool.thickness_cycle" onChange={(next) => onChange(Number(next))}/>;
}
