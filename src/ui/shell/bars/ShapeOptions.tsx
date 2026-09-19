import { useToolbarContext } from '../use-toolbar-context';
import { BUILD_SHAPES, type BuildShape } from '../../../core/model/edit-mode';
import { useT } from '../../../i18n/context';
import { effectiveCombo, prettyCombo, useKeybinds } from '../../../core/runtime/keybindings';
import { GlyphIcon } from '../GlyphIcon';
import { SCALE } from '../units';
import { TOOL_CELLS } from './terrain-cells';
import { OptionPill } from './OptionPill';

const SHAPES = {
  free: { label: 'terrain.shape.free', command: 'tool.free' },
  line: { label: 'eraser.line', command: 'tool.line' },
  curve: { label: 'eraser.curve', command: 'tool.curve' },
  rect: { label: 'eraser.rect', command: 'tool.rect' },
  circle: { label: 'eraser.circle', command: 'tool.circle' },
} as const;

export function ShapeOptions({ value, onChange }: { value: BuildShape; onChange: (shape: BuildShape) => void }) {
  const t = useT();
  const overrides = useKeybinds(s => s.overrides);
  const context = useToolbarContext();
  const options = BUILD_SHAPES.map(shape => {
    const label = t(SHAPES[shape].label);
    const combo = effectiveCombo(overrides, SHAPES[shape].command, context);
    const cell = TOOL_CELLS.find(cell => cell.id === shape);
    return {
      value: shape, label, title: combo ? `${label} (${prettyCombo(combo)})` : label,
      glyph: cell ? <GlyphIcon glyph={cell.glyph.mountain} size={51 * SCALE}/> : <svg width={64 * SCALE} height={58 * SCALE} viewBox="0 0 28 20" aria-hidden>
        <path d="M2 15C8-3 11 22 17 7S26 0 25 14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      </svg>,
    };
  });
  return <OptionPill helpTarget={context === 'terrain' ? { page: 'terrain', anchor: value === 'free' ? 'terrain-brush' : `terrain-${value}` } : { page: 'notes', anchor: 'notes-zone' }} value={value} options={options} label={t('terrain.shapes')} commandId="tool.shape_cycle" onChange={onChange}/>;
}
