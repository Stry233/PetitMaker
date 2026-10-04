import { AnimatePresence } from 'framer-motion';
import { mapEdgeAttr } from '../../primitives/map-edge';
import type { AutoEdgeCut, EraserShape } from '../../../core/model/types';
import { toggleBuildTool, type BuildShape, type BuildTool, type EditModePatch } from '../../../core/model/edit-mode';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { tourTargetAttr } from '../../chrome/tour/steps';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { z } from '../../design/styles';
import { useFrameLayout } from '../frame-layout';
import { modeLabelKey } from '../frame';
import { cssMotion } from '../../design/motion';
import { EDGE_RIGHT, QUAD } from '../units';
import { SWATCH_ROW_GAP, ToolRow } from './ToolRow';
import { BrushSizeControl } from './BrushSizeControl';
import { MaterialStrip, RoadStyles, type MaterialSwatch } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AutoTrim } from './AutoTrim';
import { ToolOptions } from './ToolOptions';
import { ToolPill, TOOL_PILL_GAP, toolPillCentre } from './ToolPill';
import { ShapeOptions } from './ShapeOptions';
import { TOOL_CELLS, type TerrainSurface } from './terrain-cells';
import { ELEVATION_COLORS, ZONE_COLORS } from '../../../core/model/constants';
import { CellZone } from '../../../core/model/types';
import { PLANET_PROFILE } from '../../../core/model/game-profile';
import { PLANET_MATERIALS, type PlanetMaterial } from '../../../state/slices/planet-session';

const noop = () => {};

/** The editor and Help figures share the same tool and setting arrangement. */
export function TerrainRow({ surface, activeTool, activeShape, eraserShape, brushSize, onBrushSize, onSelect,
  autoEdgeCut = 'off', onAutoEdgeCut = noop, onEraserShape = noop, groundOnly = false,
}: {
  surface: TerrainSurface; activeTool: BuildTool; activeShape: BuildShape; eraserShape: EraserShape;
  brushSize: number; onBrushSize: (n: number) => void;
  onSelect: (edit: EditModePatch) => void;
  autoEdgeCut?: AutoEdgeCut; onAutoEdgeCut?: (mode: AutoEdgeCut) => void;
  onEraserShape?: (shape: EraserShape) => void;
  /** The planet session's row: brush, eraser, shapes and size, without trimming or smart build. */
  groundOnly?: boolean;
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
      {groundOnly ? null : <>
        <div {...helpTargetAttr('trim')}><ToolPill glyph={TOOL_CELLS[2]!.glyph[surface]} label={t('design.edge_cut')} commandId="tool.edgecut"
          active={activeTool === 'trim'} centre={centre(2)} onSelect={() => toggle('trim')}/></div>
        <SmartBuild surface={surface} centre={centre(3)} active={activeTool === 'smart'}/>
      </>}
    </div>
    <ToolOptions mode={drawing || erasing ? 'shape' : null}>
      <ShapeOptions value={shape} onChange={next => {
        if (erasing) onEraserShape(next === 'free' ? 'dot' : next);
        else onSelect(next === 'free' ? { tool: 'brush' } : { tool: 'shape', shape: next });
      }}/>
      {groundOnly ? null : <AutoTrim value={autoEdgeCut} onChange={onAutoEdgeCut} disabled={false}/>}
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
  const session = useEditorStore((s) => s.planetSession !== null);

  return (
    <div
      {...helpTargetAttr('terrain')}
      {...mapEdgeAttr('bottom')}
      style={{
        position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        transition: cssMotion('frame.layout.adapt', ['right']),
        display: 'flex', flexDirection: 'column', gap: SWATCH_ROW_GAP,
        pointerEvents: 'none',
      }}
    >
      {surface === 'road' ? <RoadStyles /> : null}
      {session && surface === 'mountain' ? <PlanetMaterials /> : null}
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
        groundOnly={session}
      />
    </div>
  );
}

/** Each planet material's swatch: grass ground wears the first layer's colour, sand the beach's.
 *  Grass is named for what it lays: ground while the planet's ground stays flat, mountain once it
 *  may stack. */
const MATERIAL_ART: Record<PlanetMaterial, { labelKey: string; color: string }> = {
  mountain: { labelKey: PLANET_PROFILE.maxLayer > 0 ? 'planet.material_mountain' : 'layer.ground', color: ELEVATION_COLORS[1]! },
  sand: { labelKey: 'planet.material_sand', color: ZONE_COLORS[CellZone.Beach]! },
};

/** What the planet session's mountain brush lays, one swatch per material. */
function PlanetMaterials() {
  const t = useT();
  const material = useEditorStore((s) => s.planetMaterial);
  const setMaterial = useEditorStore((s) => s.setPlanetMaterial);
  const swatches: MaterialSwatch[] = PLANET_MATERIALS.map((id) => ({ id, name: t(MATERIAL_ART[id].labelKey), color: MATERIAL_ART[id].color }));
  const pick = (id: string) => { const next = PLANET_MATERIALS.find((m) => m === id); if (next) setMaterial(next); };
  return <MaterialStrip label={t(modeLabelKey('mountain', true))} swatches={swatches} active={material} onPick={pick} />;
}
