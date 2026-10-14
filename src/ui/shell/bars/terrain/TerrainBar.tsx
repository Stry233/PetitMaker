import { isSurfacePrint } from '../../../../core/model/traits';
import type { AutoEdgeCut, EraserShape } from '../../../../state/editing/vocabulary';
import { brushSizeOf, buildShapeOf, buildToolOf, toggleBuildTool, type BuildShape, type BuildTool, type ContentArming } from '../../../../state/editing/edit-mode';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { helpTargetAttr } from '../../../session/help-targets';
import { modeLabelKey } from '../../frame';
import { BrushSizeControl } from '../BrushSizeControl';
import { MaterialStrip, RoadStyles, type MaterialSwatch } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AutoTrim } from './AutoTrim';
import { ToolPill, toolPillCentre } from '../ToolPill';
import { ShapeOptions } from '../ShapeOptions';
import { TOOL_CELLS } from '../terrain-cells';
import type { ContentType } from '../../../../state/editing/edit-mode';
import { ToolbarRow, type ToolbarSlot, type ToolbarSpec } from '../toolbar-morph';
import { ELEVATION_COLORS, ZONE_COLORS } from '../../../../core/model/palette';
import { CellZone } from '../../../../core/game/zones';
import { getCatalogItem } from '../../../../state/catalog';
import { PLANET_PROFILE } from '../../../../core/game/profile';
import { PLANET_MATERIALS, type PlanetMaterial } from '../../../../state/slices/planet-session';
import type { I18nKey } from '../../../../i18n/keys';

const noop = () => {};

interface TerrainRowProps {
  surface: ContentType; activeTool: BuildTool; activeShape: BuildShape; eraserShape: EraserShape;
  brushSize: number; onBrushSize: (n: number) => void;
  onSelect: (arm: ContentArming) => void;
  autoEdgeCut?: AutoEdgeCut; onAutoEdgeCut?: (mode: AutoEdgeCut) => void;
  onEraserShape?: (shape: EraserShape) => void;
  /** Surfaces that support painting and erasing, without terrain trimming or smart build. */
  basicTools?: boolean;
}

/** The terrain tool row's slots, shared by the editor and Help figures. */
function useTerrainRow({ surface, activeTool, activeShape, eraserShape, brushSize, onBrushSize, onSelect,
  autoEdgeCut = 'off', onAutoEdgeCut = noop, onEraserShape = noop, basicTools = false,
}: TerrainRowProps): Omit<ToolbarSpec, 'rows'> {
  const t = useT();
  const drawing = activeTool === 'brush' || activeTool === 'shape';
  const erasing = activeTool === 'erase';
  const shape = erasing ? eraserShape : activeShape;
  const sized = activeTool === 'smart' || ((drawing || erasing) && shape !== 'rect' && shape !== 'circle');
  const ids = basicTools ? ['brush', 'eraser'] : ['brush', 'eraser', 'trim', 'smart'];
  const activePill = drawing ? 'brush' : erasing ? 'eraser' : activeTool === 'trim' ? 'trim' : activeTool === 'smart' ? 'smart' : null;
  const centre = (id: string) => toolPillCentre(ids.indexOf(id), activePill ? ids.indexOf(activePill) : -1);
  const toggle = (tool: 'brush' | 'erase' | 'trim') => onSelect(toggleBuildTool({ tool: activeTool, shape: activeShape }, tool));
  const pills: ToolbarSlot[] = [
    { id: 'brush', node: <ToolPill helpTarget={{ page: 'terrain', anchor: 'terrain-brush' }} glyph={TOOL_CELLS[0]!.glyph[surface]} label={t('terrain.brush')} commandId="tool.brush"
      active={drawing} centre={centre('brush')} onSelect={() => toggle('brush')}/> },
    { id: 'eraser', node: <ToolPill helpTarget={{ page: 'terrain', anchor: 'terrain-eraser' }} glyph={TOOL_CELLS[1]!.glyph[surface]} label={t('design.eraser')} commandId="tool.erase"
      active={erasing} centre={centre('eraser')} onSelect={() => toggle('erase')}/> },
    ...(basicTools ? [] : [
      { id: 'trim', node: <div {...helpTargetAttr('trim')}><ToolPill glyph={TOOL_CELLS[2]!.glyph[surface]} label={t('design.edge_cut')} commandId="tool.trim"
        active={activeTool === 'trim'} centre={centre('trim')} onSelect={() => toggle('trim')}/></div> },
      { id: 'smart', node: <SmartBuild surface={surface} centre={centre('smart')} active={activeTool === 'smart'}/> },
    ]),
  ];
  const options: ToolbarSlot[] = drawing || erasing ? [
    { id: 'shape', node: <ShapeOptions value={shape} onChange={next => {
      if (erasing) onEraserShape(next);
      else onSelect(next === 'free' ? { kind: 'brush' } : { kind: 'shape', shape: next });
    }}/> },
    ...(basicTools ? [] : [{ id: 'auto-trim', node: <AutoTrim value={autoEdgeCut} onChange={onAutoEdgeCut} disabled={false}/> }]),
  ] : [];
  return {
    pills, activePill, pillAttrs: { ...tourTargetAttr('bar'), ...helpTargetAttr('terrain') }, options,
    trailing: sized ? [{ id: 'size', end: true, node: <BrushSizeControl value={brushSize} onChange={onBrushSize}/> }] : [],
    frameAttrs: helpTargetAttr('terrain'),
  };
}

/** The editor and Help figures share the same tool and setting arrangement. */
export function TerrainRow(props: TerrainRowProps) {
  return <ToolbarRow {...useTerrainRow(props)}/>;
}

/** The live terrain toolbar for one surface, read from the store. */
export function useTerrainToolbar(surface: ContentType): ToolbarSpec {
  const activeTool = useEditorStore(buildToolOf);
  const activeShape = useEditorStore(buildShapeOf);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const brushSize = useEditorStore(brushSizeOf);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const eraserShape = useEditorStore((s) => s.eraserShape);
  const setEraserShape = useEditorStore((s) => s.setEraserShape);
  const autoEdgeCut = useEditorStore((s) => s.autoEdgeCut);
  const setAutoEdgeCut = useEditorStore((s) => s.setAutoEdgeCut);
  const tileMaterial = useEditorStore(s => s.tileMaterial);
  const session = useEditorStore((s) => s.planetSession !== null);
  const row = useTerrainRow({
    surface, activeTool, activeShape, eraserShape, onEraserShape: setEraserShape,
    autoEdgeCut, onAutoEdgeCut: setAutoEdgeCut, brushSize, onBrushSize: setBrushSize, onSelect: (arm) => setEditMode({ arm }),
    basicTools: session || (surface === 'road' && isSurfacePrint(getCatalogItem(tileMaterial))),
  });
  const rows: ToolbarSlot[] = [
    ...(surface === 'road' ? [{ id: 'road-styles', node: <RoadStyles /> }] : []),
    ...(session && surface === 'mountain' ? [{ id: 'planet-materials', node: <PlanetMaterials /> }] : []),
  ];
  return { ...row, rows };
}

/** Each planet material's swatch: grass ground wears the first layer's colour, sand the beach's.
 *  Grass is named for what it lays: ground while the planet's ground stays flat, mountain once it
 *  may stack. */
const MATERIAL_ART: Record<PlanetMaterial, { labelKey: I18nKey; color: string }> = {
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
