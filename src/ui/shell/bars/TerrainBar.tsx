import { AnimatePresence } from 'framer-motion';
import type { AutoEdgeCut, EraserShape } from '../../../core/model/types';
import { toggleBuildTool, type BuildShape, type BuildTool, type EditModePatch } from '../../../core/model/edit-mode';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { tourTargetAttr } from '../../chrome/tour/steps';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { z } from '../../design/styles';
import { useFrameLayout } from '../frame-layout';
import { cssMotion } from '../motion/use-motion';
import { EDGE_RIGHT, QUAD } from '../units';
import { SWATCH_ROW_GAP, ToolRow } from './ToolRow';
import { BrushSizeControl } from './BrushSizeControl';
import { RoadStyles } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AutoTrim } from './AutoTrim';
import { ToolOptions } from './ToolOptions';
import { ToolPill, TOOL_PILL_GAP, toolPillCentre } from './ToolPill';
import { ShapeOptions } from './ShapeOptions';
import { TOOL_CELLS, type TerrainSurface } from './terrain-cells';

const noop = () => {};

/** The editor and Help figures share the same tool and setting arrangement. */
export function TerrainRow({ surface, activeTool, activeShape, eraserShape, brushSize, onBrushSize, onSelect,
  autoEdgeCut = 'off', onAutoEdgeCut = noop, onEraserShape = noop,
}: {
  surface: TerrainSurface; activeTool: BuildTool; activeShape: BuildShape; eraserShape: EraserShape;
  brushSize: number; onBrushSize: (n: number) => void;
  onSelect: (edit: EditModePatch) => void;
  autoEdgeCut?: AutoEdgeCut; onAutoEdgeCut?: (mode: AutoEdgeCut) => void;
  onEraserShape?: (shape: EraserShape) => void;
}) {
  const t = useT();
  const drawing = activeTool === 'brush' || activeTool === 'shape';
  const erasing = activeTool === 'erase';
  const shape = erasing ? eraserShape === 'dot' ? 'free' : eraserShape : activeShape;
  const sized = activeTool === 'smart' || ((drawing || erasing) && shape !== 'rect' && shape !== 'circle');
  const selected = [drawing, erasing, activeTool === 'trim', activeTool === 'smart'];
  const centre = (index: number) => toolPillCentre(index, selected.findIndex(Boolean));
  const toggle = (tool: 'brush' | 'erase' | 'trim') => onSelect(toggleBuildTool({ tool: activeTool, shape: activeShape }, tool));
  return <ToolRow>
    <div {...tourTargetAttr('bar')} {...helpTargetAttr('terrain')} style={{ display: 'flex', flex: 'none', alignItems: 'flex-start', gap: TOOL_PILL_GAP }}>
      <ToolPill helpTarget={{ page: 'terrain', anchor: 'terrain-brush' }} glyph={TOOL_CELLS[0]!.glyph[surface]} label={t('terrain.brush')} commandId="tool.brush"
        active={drawing} centre={centre(0)} onSelect={() => toggle('brush')}/>
      <ToolPill helpTarget={{ page: 'terrain', anchor: 'terrain-eraser' }} glyph={TOOL_CELLS[1]!.glyph[surface]} label={t('design.eraser')} commandId="tool.eraser"
        active={erasing} centre={centre(1)} onSelect={() => toggle('erase')}/>
      <div {...helpTargetAttr('trim')}><ToolPill glyph={TOOL_CELLS[2]!.glyph[surface]} label={t('design.edge_cut')} commandId="tool.edgecut"
        active={activeTool === 'trim'} centre={centre(2)} onSelect={() => toggle('trim')}/></div>
      <SmartBuild surface={surface} centre={centre(3)} active={activeTool === 'smart'}/>
    </div>
    <ToolOptions mode={drawing || erasing ? 'shape' : null}>
      <ShapeOptions value={shape} onChange={next => {
        if (erasing) onEraserShape(next === 'free' ? 'dot' : next);
        else onSelect(next === 'free' ? { tool: 'brush' } : { tool: 'shape', shape: next });
      }}/>
      <AutoTrim value={autoEdgeCut} onChange={onAutoEdgeCut} disabled={false}/>
    </ToolOptions>
    <AnimatePresence initial={false}>
      {sized && <BrushSizeControl key="size" value={brushSize} onChange={onBrushSize}/>}
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
      {...helpTargetAttr('terrain')}
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
