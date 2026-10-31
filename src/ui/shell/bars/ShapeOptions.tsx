import { useToolbarContext } from '../../session/use-toolbar-context';
import { BUILD_SHAPES, type BuildShape } from '../../../state/editing/edit-mode';
import { useT } from '../../../i18n/context';
import { GlyphIcon } from '../GlyphIcon';
import { SCALE } from '../units';
import { FREE_SHAPE_COMMAND, TOOL_CELLS, commandLabel } from './terrain-cells';
import { OptionPill } from './OptionPill';
import { useCommandTitle } from './bar-atoms';

/** A brush shape's drawing, at `scale` times the shape group's own size: the tool cell's glyph, or
 *  the loose stroke the free figure, which has no cell, is drawn as. */
export function ShapeGlyph({ shape, scale = 1 }: { shape: BuildShape; scale?: number }) {
  const cell = TOOL_CELLS.find(cell => cell.shows.shape === shape);
  return cell ? <GlyphIcon glyph={cell.glyph.mountain} size={51 * SCALE * scale}/> : <svg width={64 * SCALE * scale} height={58 * SCALE * scale} viewBox="0 0 28 20" aria-hidden>
    <path d="M2 15C8-3 11 22 17 7S26 0 25 14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
  </svg>;
}

export function ShapeOptions({ value, onChange, shapes = BUILD_SHAPES }: {
  value: BuildShape; onChange: (shape: BuildShape) => void; shapes?: readonly BuildShape[];
}) {
  const t = useT();
  const context = useToolbarContext();
  const titleOf = useCommandTitle();
  const options = shapes.map(shape => {
    const cell = TOOL_CELLS.find(cell => cell.shows.shape === shape);
    const command = cell?.commandId ?? FREE_SHAPE_COMMAND;
    const label = t(commandLabel(command));
    return { value: shape, label, title: titleOf(label, command), glyph: <ShapeGlyph shape={shape}/> };
  });
  const helpTarget = context === 'region' ? { page: 'region' as const }
    : context === 'objects' ? { page: 'objects' as const, anchor: 'objects-batch' }
    : context === 'terrain' ? { page: 'terrain' as const, anchor: value === 'free' ? 'terrain-brush' : `terrain-${value}` }
    : { page: 'notes' as const, anchor: context === 'notes-erase' ? 'notes-edit' : 'notes-zone' };
  return <OptionPill helpTarget={helpTarget} value={value} options={options} label={t('terrain.shapes')} commandId="tool.shape_cycle" onChange={onChange}/>;
}
