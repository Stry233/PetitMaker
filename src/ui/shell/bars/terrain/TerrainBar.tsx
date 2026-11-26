import type { ReactNode } from 'react';
import { isSurfacePrint } from '../../../../core/model/traits';
import type { AutoEdgeCut, EraserShape } from '../../../../state/editing/vocabulary';
import { buildShapeOf, buildToolOf, surfaceTools, takesThickness, toggleBuildTool, toolTakesSize, type BuildShape, type BuildTool, type ContentArming, type SurfaceTool } from '../../../../state/editing/edit-mode';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { helpTargetAttr } from '../../../session/help-targets';
import { modeLabelKey } from '../../frame';
import { useRunCommand } from '../../use-shell-commands';
import { LiveBrushSize } from '../BrushSizeControl';
import { MaterialStrip, RoadStyles, type MaterialSwatch } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AutoTrim } from './AutoTrim';
import { Thickness } from './Thickness';
import { ToolPill, toolPillCentre, useCellPill } from '../ToolPill';
import { ShapeOptions } from '../ShapeOptions';
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
  /** The size slider the row ends with where the armed tool takes a size. */
  sizeControl: ReactNode;
  /** A figure's press: the arming a pill or a brush shape asks of its own world. */
  onSelect?: (arm: ContentArming) => void;
  /** The live toolbar's press, in `onSelect`'s place: runs the command a pill or an option names. */
  press?: (id: string, args?: Readonly<Record<string, unknown>>) => void;
  autoEdgeCut?: AutoEdgeCut;
  /** How many layers a mountain stroke builds or takes (`takesThickness`). */
  thickness?: number;
  /** The planet editor, whose ground is one layer. */
  planetSession?: boolean;
  /** The road brush lays a transparent print. */
  printArmed?: boolean;
}

/** Each tool's pill in the row, by its toolbar slot. */
const PILL_ID: Readonly<Record<SurfaceTool, string>> = { brush: 'brush', erase: 'eraser', trim: 'trim', smart: 'smart' };

/** The terrain tool row's slots, shared by the editor and Help figures. */
function useTerrainRow({ surface, activeTool, activeShape, eraserShape, sizeControl, onSelect = noop, press,
  autoEdgeCut = 'off', thickness = 1, planetSession = false, printArmed = false,
}: TerrainRowProps): Omit<ToolbarSpec, 'rows'> {
  const cellPill = useCellPill(surface);
  const drawing = activeTool === 'brush' || activeTool === 'shape';
  const erasing = activeTool === 'erase';
  const shape = erasing ? eraserShape : activeShape;
  const tools = surfaceTools(surface, { planetSession, printArmed });
  const ids = tools.map((tool) => PILL_ID[tool]);
  const activePill = drawing ? 'brush' : erasing ? 'eraser' : activeTool === 'trim' ? 'trim' : activeTool === 'smart' ? 'smart' : null;
  const centre = (id: string) => toolPillCentre(ids.indexOf(id), activePill ? ids.indexOf(activePill) : -1);
  // A cell's pill with its press: the cell's command, or for a figure the arming that toggles `tool`.
  const cell = (id: string, tool: 'brush' | 'erase' | 'trim') => {
    const face = cellPill(id);
    return { ...face, onSelect: () => (press ? press(face.commandId) : onSelect(toggleBuildTool({ tool: activeTool, shape: activeShape }, tool))) };
  };
  const pill: Record<SurfaceTool, () => ToolbarSlot['node']> = {
    brush: () => <ToolPill helpTarget={{ page: 'terrain', anchor: 'terrain-brush' }} tourTarget="brush" {...cell('draw', 'brush')}
      active={drawing} centre={centre('brush')}/>,
    erase: () => <ToolPill helpTarget={{ page: 'terrain', anchor: 'terrain-eraser' }} tourTarget="eraser" {...cell('erase', 'erase')}
      active={erasing} centre={centre('eraser')}/>,
    trim: () => <div {...helpTargetAttr('trim')}><ToolPill {...cell('trim', 'trim')}
      active={activeTool === 'trim'} centre={centre('trim')}/></div>,
    smart: () => <SmartBuild centre={centre('smart')} active={activeTool === 'smart'}/>,
  };
  const pills: ToolbarSlot[] = tools.map((tool) => ({ id: PILL_ID[tool], node: pill[tool]() }));
  const options: ToolbarSlot[] = drawing || erasing ? [
    { id: 'shape', node: <ShapeOptions value={shape} onChange={next => {
      if (press) press('tool.shape', { value: next });
      else if (!erasing) onSelect(next === 'free' ? { kind: 'brush' } : { kind: 'shape', shape: next });
    }}/> },
    ...(tools.includes('trim') ? [{ id: 'auto-trim', node: <AutoTrim value={autoEdgeCut} onChange={value => press?.('tool.auto_edge_cut', { value })} disabled={false}/> }] : []),
    ...(takesThickness(surface, activeTool, planetSession) ? [{ id: 'thickness', node: <Thickness value={thickness} onChange={value => press?.('tool.thickness', { value })}/> }] : []),
  ] : [];
  return {
    pills, activePill, pillAttrs: { ...tourTargetAttr('bar'), ...helpTargetAttr('terrain') }, options,
    trailing: toolTakesSize(activeTool, shape) ? [{ id: 'size', end: true, sizeSlider: true, node: sizeControl }] : [],
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
  const eraserShape = useEditorStore((s) => s.eraserShape);
  const autoEdgeCut = useEditorStore((s) => s.autoEdgeCut);
  const thickness = useEditorStore((s) => s.terrainThickness);
  const tileMaterial = useEditorStore(s => s.tileMaterial);
  const session = useEditorStore((s) => s.planetSession !== null);
  const press = useRunCommand();
  const row = useTerrainRow({
    surface, activeTool, activeShape, eraserShape, autoEdgeCut, thickness, sizeControl: <LiveBrushSize of="brush"/>, press,
    planetSession: session, printArmed: isSurfacePrint(getCatalogItem(tileMaterial)),
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
  const run = useRunCommand();
  const swatches: MaterialSwatch[] = PLANET_MATERIALS.map((id) => ({ id, name: t(MATERIAL_ART[id].labelKey), color: MATERIAL_ART[id].color }));
  return <MaterialStrip label={t(modeLabelKey('mountain', true))} swatches={swatches} active={material} onPick={(id) => run('tool.material', { value: id })} />;
}
