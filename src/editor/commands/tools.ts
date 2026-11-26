/**
 * The commands the mode tiles and the bars' controls press: the mode in front, each option of the
 * tool in hand set to a value, and what a bar's own controls start and end (a region's painting, the
 * object brush bar, the selection, the Notes door). Each runs the body its key or its back-out runs
 * (`actions.ts:setMode`, the option bodies of `commands.ts`, `back/back-out.ts`), so a control, a key
 * and a back-out reach one state by one path.
 */
import type { I18nKey } from '../../i18n/keys';
import { getRoadMaterials } from '../../state/catalog';
import { BRUSH_SIZE, BUILD_MODES, BUILD_SHAPES, TERRAIN_THICKNESS, type BuildMode, type BuildShape } from '../../state/editing/edit-mode';
import { AUTO_EDGE_CUTS, OBJECT_SPACING, type AutoEdgeCut } from '../../state/editing/vocabulary';
import { brushBarOpen, keyContext } from '../../state/keymap/toolbar';
import { brushBarRefusal, type BrushBarRefusal } from '../../state/object-shelf-view';
import { ROAD_FAMILIES, roadFamilyOf, type RoadFamily } from '../../state/slices/edit';
import { PLANET_MATERIALS } from '../../state/slices/planet-session';
import { notesOpenable } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import { closeBrushBar, finishRegionPainting } from '../back/back-out';
import { showNotesForEditing } from '../editing/annotation-edit';
import { paintGenerateScope } from '../editing/generate-batch';
import { setMode } from './actions';
import { toggle } from './app';
import { setToolShape, shapeInHand, sizeInHand, takesAutoEdgeCut, thicknessInHand } from './commands';
import { type Command, refuse } from './types';

const store = () => useEditorStore.getState();
const NOT_TAKEN = 'The app did not take the change in its present state.';

/** Rest as a caller names it, no mode being open. */
const NO_MODE = 'none';

const MODE_LABELS: Readonly<Record<typeof BUILD_MODES[number], I18nKey>> = {
  object: 'mode.object', road: 'mode.road', mountain: 'mode.mountain', water: 'mode.water',
  generate: 'mode.generate', blueprint: 'mode.blueprint', annotate: 'annot.layer',
};

/** What `current` reads where the toolbar in front has no such option. */
const NO_VALUE = 'none';

const SHAPE_LABELS: Readonly<Record<BuildShape, I18nKey>> = {
  free: 'terrain.shape.free', line: 'eraser.line', curve: 'eraser.curve', rect: 'eraser.rect', circle: 'eraser.circle',
};
const EDGE_CUT_LABELS: Readonly<Record<AutoEdgeCut, I18nKey>> = { off: 'edgecut.off', rect: 'edgecut.rect', round: 'edgecut.round' };

const ROAD_FAMILY_LABELS: Readonly<Record<RoadFamily, I18nKey>> = { roads: 'design.road_surface', prints: 'design.surface_prints' };

/** Whether the road bar, whose swatches the family switch changes, is the toolbar in front. */
const roadBarInFront = (): boolean => keyContext(store()) === 'terrain' && store().editMode.mode === 'road';

/** An on/off command over the map's tools, as `toggle` is one over the app. */
const mapToggle = (...facts: Parameters<typeof toggle>): Command => ({ ...toggle(...facts), target: 'map' });

const ON_ARG = { name: 'on', kind: 'boolean', description: 'The state to set.' } as const;
const onOff = (on: unknown): string => (on === true ? 'on' : 'off');

/** Whether Generate's or the assistant's region is being painted; Blueprint's frame step is its own. */
const paintingRegion = (): boolean => store().selectingRegion && store().regionSelectionOwner !== 'blueprint';

/** Why the object brush bar does not open over what is armed, for a caller that sees no button. */
const BRUSH_BAR_REFUSALS: Readonly<Record<BrushBarRefusal, string>> = {
  planting: 'A planting card is armed, which lays its own planting.',
  'one-at-a-time': 'The armed item is placed one at a time.',
  row: 'Nothing the shelf shows can be laid more than one at a time.',
};

/** What the brush of the surface in front lays, with the swatches its bar offers and its setter: a
 *  road surface or print, or the planet session's ground; null where the surface lays its own. */
function materialInHand(): { value: string; offered: readonly string[]; set(id: string): void } | null {
  const s = store();
  if (keyContext(s) !== 'terrain') return null;
  if (s.editMode.mode === 'road') {
    return { value: s.tileMaterial, offered: [...getRoadMaterials(false), ...getRoadMaterials(true)].map((item) => item.id), set: s.setTileMaterial };
  }
  if (s.editMode.mode === 'mountain' && s.planetSession) {
    const pick = (id: string): void => { const material = PLANET_MATERIALS.find((m) => m === id); if (material) s.setPlanetMaterial(material); };
    return { value: s.planetMaterial, offered: PLANET_MATERIALS, set: pick };
  }
  return null;
}

export const TOOL_COMMANDS: readonly Command[] = [
  {
    id: 'mode.set', effect: 'change', target: 'map', labelKey: 'mode.deck',
    description: 'Opens a build mode as its tile does, with what it held when it was left, or puts every mode away. annotate is Notes, which opens with the notes shown.',
    args: [{ name: 'mode', kind: 'enum', values: [...BUILD_MODES, NO_MODE], labels: MODE_LABELS, description: 'The mode to open; none puts the open one away.' }],
    current: () => store().editMode.mode ?? NO_MODE,
    invoke({ mode }) {
      const wanted = mode === NO_MODE ? null : mode as BuildMode;
      setMode(wanted);
      return store().editMode.mode === wanted ? `mode.set is now ${String(mode)}.` : refuse(NOT_TAKEN);
    },
  },
  {
    id: 'brush.size', effect: 'change', target: 'map', labelKey: 'design.brush_size',
    description: 'The size of the brush in hand, as the bigger and smaller keys step it: the build brush or eraser, the region brush, a route note\'s line width, or the spacing of the object brush.',
    args: [{
      name: 'value', kind: 'number', integer: true,
      min: Math.min(BRUSH_SIZE.min, OBJECT_SPACING.min), max: Math.max(BRUSH_SIZE.max, OBJECT_SPACING.max),
      description: `The size in cells: ${BRUSH_SIZE.min} to ${BRUSH_SIZE.max} for a brush or a line, ${OBJECT_SPACING.min} to ${OBJECT_SPACING.max} for the object brush's spacing.`,
    }],
    current: () => sizeInHand().value,
    invoke({ value }) {
      const size = sizeInHand();
      const wanted = Number(value);
      if (wanted < size.min || wanted > size.max) return refuse(`value must be from ${size.min} to ${size.max} for the brush in hand.`);
      size.set(wanted);
      return sizeInHand().value === wanted ? `brush.size is now ${wanted}.` : refuse(NOT_TAKEN);
    },
  },
  {
    id: 'tool.shape', effect: 'change', target: 'map', labelKey: 'terrain.shapes',
    description: 'The shape the tool in hand draws, as the shape keys set it: the build brush\'s or eraser\'s, the region brush\'s, the object brush\'s or a zone note\'s. With no toolbar in front it opens the build surface on that shape.',
    args: [{ name: 'value', kind: 'enum', values: BUILD_SHAPES, labels: SHAPE_LABELS, description: 'The shape to draw.' }],
    current: () => shapeInHand() ?? NO_VALUE,
    invoke({ value }) {
      setToolShape(value as BuildShape);
      return shapeInHand() === value ? `tool.shape is now ${String(value)}.` : refuse('The tool in hand does not take that shape.');
    },
  },
  {
    id: 'tool.thickness', effect: 'change', target: 'map', labelKey: 'terrain.thickness',
    description: 'How many layers one stroke of the mountain brush, its shapes or the mountain eraser builds or takes.',
    args: [{ name: 'value', kind: 'number', integer: true, min: TERRAIN_THICKNESS.min, max: TERRAIN_THICKNESS.max, description: 'The number of layers.' }],
    current: () => store().terrainThickness,
    invoke({ value }) {
      if (!thicknessInHand()) return refuse('The tool in hand takes no thickness.');
      store().setTerrainThickness(Number(value));
      return `tool.thickness is now ${store().terrainThickness}.`;
    },
  },
  {
    id: 'tool.auto_edge_cut', effect: 'change', target: 'map', labelKey: 'edgecut.auto',
    description: 'Whether a finished stroke of a terrain surface\'s brush or eraser cuts its corners itself: not at all, to a bevel, or round.',
    args: [{ name: 'value', kind: 'enum', values: AUTO_EDGE_CUTS, labels: EDGE_CUT_LABELS, description: 'The cut a stroke makes.' }],
    current: () => store().autoEdgeCut,
    invoke({ value }) {
      if (!takesAutoEdgeCut()) return refuse('The tool in hand takes no auto edge cut.');
      store().setAutoEdgeCut(value as AutoEdgeCut);
      return `tool.auto_edge_cut is now ${String(value)}.`;
    },
  },
  {
    id: 'tool.material', effect: 'change', target: 'map', labelKey: 'design.road_surface',
    description: 'What the brush of the surface in front lays: a road surface or a surface print on Roads, by its catalog id, or the ground material of a planet being edited.',
    args: [{ name: 'value', kind: 'string', description: 'The id of one of the swatches the surface\'s bar offers.' }],
    current: () => materialInHand()?.value ?? NO_VALUE,
    invoke({ value }) {
      const material = materialInHand();
      if (!material) return refuse('The surface in front lays no chosen material.');
      if (!material.offered.includes(String(value))) return refuse(`value must be one of: ${material.offered.join(', ')}.`);
      material.set(String(value));
      return `tool.material is now ${String(value)}.`;
    },
  },
  {
    id: 'tool.road_family', effect: 'change', target: 'map', labelKey: 'mode.road',
    description: 'Which family the road brush lays, as the road bar\'s switch sets it: road surfaces, or the surface prints laid over them. It arms the material last laid in that family, or the family\'s first.',
    args: [{ name: 'family', kind: 'enum', values: ROAD_FAMILIES, labels: ROAD_FAMILY_LABELS, description: 'The family to lay.' }],
    current: () => (roadBarInFront() ? roadFamilyOf(store()) : NO_VALUE),
    invoke({ family }) {
      if (!roadBarInFront()) return refuse('The surface in front lays no road.');
      store().switchRoadFamily(family as RoadFamily);
      return roadFamilyOf(store()) === family ? `tool.road_family is now ${String(family)}.` : refuse(NOT_TAKEN);
    },
  },
  mapToggle(
    { id: 'region.dimensions', labelKey: 'region.dimensions', description: 'Whether the region brush draws the width and height of what it paints, for Generate\'s and the assistant\'s regions and Blueprint\'s frame.' },
    () => store().regionDimensions, (on) => store().setRegionDimensions(on),
  ),
  {
    id: 'region.paint', effect: 'change', target: 'map', labelKey: 'generate.scope',
    description: 'Starts painting the region Generate fills, as its Area chip does, with the brush the kind in hand asks for, or ends the painting that stands, Generate\'s or the assistant\'s, as Done does, keeping the region.',
    args: [ON_ARG],
    current: paintingRegion,
    invoke({ on }) {
      if (store().selectingRegion && !paintingRegion()) return refuse('Blueprint\'s frame step is painting; its own Done and Cancel end it.');
      if (on !== true) finishRegionPainting();
      else if (!paintGenerateScope()) return refuse('Generate is not open.');
      return paintingRegion() === on ? `region.paint is now ${onOff(on)}.` : refuse(NOT_TAKEN);
    },
  },
  {
    id: 'objects.brush_bar', effect: 'change', target: 'map', labelKey: 'objects.brush',
    description: 'Stands the object brush bar in the object shelf\'s place, where the armed card is placed one at a time or painted along a shape, or puts it away as its Done does, keeping what is armed.',
    args: [ON_ARG],
    current: () => brushBarOpen(store()),
    invoke({ on }) {
      if (on !== true) closeBrushBar('keep');
      else {
        if (store().editMode.mode !== 'object') return refuse('The object shelf is not open.');
        const refusal = brushBarRefusal(store());
        if (refusal) return refuse(BRUSH_BAR_REFUSALS[refusal]);
        store().setObjectBrushBar(true);
      }
      return brushBarOpen(store()) === on ? `objects.brush_bar is now ${onOff(on)}.` : refuse(NOT_TAKEN);
    },
  },
  {
    id: 'selection.clear', effect: 'change', target: 'map', labelKey: 'selection.done',
    description: 'Puts the selection down with its picked block, ending touch multi-select and a latched move, as multi-select\'s Done does; one undo step.',
    args: [],
    invoke() {
      store().clearSelection();
      return 'The selection was put down.';
    },
  },
  {
    id: 'notes.edit', effect: 'change', target: 'map', labelKey: 'annot.export_edit',
    description: 'Opens Notes from the Save and share window, as its Edit button does: closes that window, shows the notes if they are hidden and opens Notes.',
    args: [],
    invoke() {
      if (!notesOpenable(store())) return refuse('Notes cannot open in the app\'s present state.');
      showNotesForEditing({ close: 'share' });
      return store().editMode.mode === 'annotate' ? 'Notes is open.' : refuse(NOT_TAKEN);
    },
  },
];
