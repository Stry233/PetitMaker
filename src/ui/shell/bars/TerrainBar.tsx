import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import type { AutoEdgeCut, EraserShape } from '../../../core/model/types';
import type { BuildShape, BuildTool } from '../../../core/model/edit-mode';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { tourTargetAttr } from '../../chrome/tour/steps';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { z } from '../../design/styles';
import { INK } from '../../design/tokens';
import { useFrameLayout } from '../frame-layout';
import { cssMotion, useMotion } from '../motion/use-motion';
import { EDGE_RIGHT, QUAD, SCALE } from '../units';
import { SWATCH_ROW_GAP, ToolRow } from './ToolRow';
import { BrushSizeSlider } from './BrushSizeSlider';
import { RoadStyles } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AutoTrim } from './AutoTrim';
import { CELL_BOX } from './ToolCell';
import { TerrainToolButton, TERRAIN_TOOL_WIDTH, TERRAIN_TOOL_GROWTH } from './TerrainToolButton';
import { TerrainShapes } from './TerrainShapes';
import { BRUSH, TOOL_CELLS, type TerrainSurface } from './terrain-cells';

export const READOUT_SIZE = Math.round(BRUSH.readoutSize * SCALE);
export const SLIDER_LIFT = CELL_BOX.h / 2 - (BRUSH.centreY - BRUSH.track.y) * SCALE;
const MAIN_GAP = 8;
const noop = () => {};

function TerrainSize({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const present = useIsPresent();
  const transition = useMotion('slider.visibility');
  return <motion.div data-terrain-size aria-hidden={!present || undefined}
    {...(!present ? { inert: '' } : {})}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}
    style={{ flex: 'none', marginLeft: 'auto', marginTop: SLIDER_LIFT }}>
    <BrushSizeSlider value={value} onChange={next => { if (present) onChange(next); }}/>
  </motion.div>;
}

/** The editor and Help figures share the same tool and setting arrangement. */
export function TerrainRow({ surface, activeTool, activeShape, eraserShape, brushSize, onBrushSize, onSelect,
  autoEdgeCut = 'off', onAutoEdgeCut = noop, onEraserShape = noop,
}: {
  surface: TerrainSurface; activeTool: BuildTool; activeShape: BuildShape; eraserShape: EraserShape;
  brushSize: number; onBrushSize: (n: number) => void;
  onSelect: (edit: { tool: BuildTool; shape?: BuildShape }) => void;
  autoEdgeCut?: AutoEdgeCut; onAutoEdgeCut?: (mode: AutoEdgeCut) => void;
  onEraserShape?: (shape: EraserShape) => void;
}) {
  const t = useT();
  const drawing = activeTool === 'brush' || activeTool === 'shape';
  const erasing = activeTool === 'erase';
  const shape = erasing ? eraserShape === 'dot' ? 'free' : eraserShape : activeShape;
  const sized = activeTool === 'smart' || ((drawing || erasing) && shape !== 'rect' && shape !== 'circle');
  const selected = [drawing, erasing, activeTool === 'trim', activeTool === 'smart'];
  const centre = (index: number) => QUAD.left + index * (TERRAIN_TOOL_WIDTH + MAIN_GAP) + TERRAIN_TOOL_WIDTH / 2
    + (selected.slice(0, index).some(Boolean) ? TERRAIN_TOOL_GROWTH : 0) + (selected[index] ? TERRAIN_TOOL_GROWTH / 2 : 0);
  return <ToolRow>
    <div {...tourTargetAttr('bar')} {...helpTargetAttr('terrain')} style={{ display: 'flex', flex: 'none', alignItems: 'flex-start', gap: MAIN_GAP }}>
      <TerrainToolButton glyph={TOOL_CELLS[0]!.glyph[surface]} label={t('terrain.brush')} commandId="tool.brush"
        active={drawing} centre={centre(0)} onSelect={() => onSelect(activeShape === 'free' ? { tool: 'brush' } : { tool: 'shape', shape: activeShape })}/>
      <TerrainToolButton glyph={TOOL_CELLS[1]!.glyph[surface]} label={t('design.eraser')} commandId="tool.eraser"
        active={erasing} centre={centre(1)} onSelect={() => onSelect({ tool: 'erase' })}/>
      <div {...helpTargetAttr('trim')}><TerrainToolButton glyph={TOOL_CELLS[2]!.glyph[surface]} label={t('design.edge_cut')} commandId="tool.edgecut"
        active={activeTool === 'trim'} centre={centre(2)} onSelect={() => onSelect({ tool: 'trim' })}/></div>
      <SmartBuild surface={surface} centre={centre(3)} active={activeTool === 'smart'}/>
    </div>
    {(drawing || erasing) && <span data-terrain-divider aria-hidden style={{ width: 1, height: 26, marginTop: (CELL_BOX.h - 26) / 2, background: INK, opacity: .25, flex: 'none' }}/>}

    {(drawing || erasing) && <TerrainShapes value={shape} onChange={next => {
      if (erasing) onEraserShape(next === 'free' ? 'dot' : next);
      else onSelect(next === 'free' ? { tool: 'brush' } : { tool: 'shape', shape: next });
    }}/>}
    {(drawing || erasing) && <AutoTrim value={autoEdgeCut} onChange={onAutoEdgeCut} disabled={false}/>}
    <AnimatePresence initial={false}>
      {sized && <TerrainSize key="size" value={brushSize} onChange={onBrushSize}/>}
    </AnimatePresence>
  </ToolRow>;
}

export function TerrainBar({ surface }: { surface: TerrainSurface }) {
  const layout = useFrameLayout();
  const editMode = useEditorStore((s) => s.editMode);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const eraserShape = useEditorStore((s) => s.eraserShape);
  const setEraserShape = useEditorStore((s) => s.setEraserShape);
  const autoEdgeCut = useEditorStore((s) => s.autoEdgeCut);
  const setAutoEdgeCut = useEditorStore((s) => s.setAutoEdgeCut);

  return (
    <div
      style={{
        position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        transition: cssMotion('frame.layout.adapt', 'right'),
        display: 'flex', flexDirection: 'column', gap: SWATCH_ROW_GAP,
        pointerEvents: 'none',
      }}
    >
      {surface === 'road' ? <RoadStyles /> : null}
      <TerrainRow
        surface={surface}
        activeTool={editMode.tool}
        activeShape={editMode.shape}
        eraserShape={eraserShape}
        onEraserShape={setEraserShape}
        autoEdgeCut={autoEdgeCut}
        onAutoEdgeCut={setAutoEdgeCut}
        brushSize={brushSize}
        onBrushSize={setBrushSize}
        onSelect={setEditMode}
      />
    </div>
  );
}
