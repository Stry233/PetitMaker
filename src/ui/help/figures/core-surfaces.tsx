/*
 * The interface figures every edition bundles: the frame, the tour, layers and notes, the shelf,
 * trim, the floating menus and the Planet and Maze shelves. It imports no assistant, share or
 * camera preview, so the offline edition can take it whole.
 */
import type { ComponentType } from 'react';
import { FrameOverview, FrameCut, FrameMiniature, NotesEntryPreview } from './previews/frame-overview';
import { useLayoutShape } from '../../design/input-mode';
import { LayersTour, NotesRowTour } from './previews/frame-tours';
import { TourPreview } from './previews/tour';
import { AutoTrimModesPreview, TerrainToolsStrip } from './previews/strips';
import { ContextMenuPreview, DeleteConfirmPreview } from './previews/floating';
import {
  GenerateShelfIslandPreview, GenerateShelfMazePreview, IslandHeightPreview, IslandRichnessPreview,
} from './previews/generate';

const FrameModes = () => <FrameCut corner="modes" />;
const FrameTopRight = () => <FrameCut corner="topright" />;
const FrameRail = () => <FrameCut corner="rail" />;
// With no mode armed the live shell shows no bottom bar, so the cut stands in the terrain bar's
// own cells instead of an empty figure.
// The object shelf open, in the pictured arrangement: upright, its handle sets the shelf's height.
const FrameShelf = () => <FrameCut corner="bar" mode="object" />;
// The shelf stands over the map in both arrangements, its tab names in the plateless outline the
// map behind them reads through, so it is pictured in its frame there.
const ShelfFigure = FrameShelf;
// The shelf on an upright screen is a picture of the whole device, a miniature by intent.
const ShelfWindow = () => <FrameMiniature mode="object" />;
const FrameBar = () => <FrameCut corner="bar" fallback={<TerrainToolsStrip active="draw" />} />;
// The shelf's brush bar open on Paint, the shape and spacing it opens with. Upright the shelf panel
// keeps its posed height over a shorter brush bar, so the cut is the brush bar and its captions.
const OBJECT_BRUSH_POSE = { brush: 'paint', shape: 'line', spacing: 1 } as const;
const OBJECT_BRUSH = '[data-testid="shell-object-brush"]';
const OBJECT_BRUSH_TARGETS = [OBJECT_BRUSH, `${OBJECT_BRUSH} *`];
function ObjectBrush() {
  const upright = useLayoutShape() === 'portrait';
  return <FrameCut corner="bar" mode="object" objectBrush={OBJECT_BRUSH_POSE} {...(upright ? { targets: OBJECT_BRUSH_TARGETS } : {})} />;
}
// The region screen in the bar's place as the shelf's Area opens it, on the freehand brush. The cut
// is its brushes, shapes and guides in either arrangement, at live size and cropped where the column
// is narrower; each box takes in everything its parts draw, the captions hanging under them included.
const SCOPE_SCREEN = '[data-testid="shell-scope-screen"]';
const REGION_BAR_TARGETS = ['tools', 'shape', 'dimensions'].flatMap((slot) => {
  const at = `${SCOPE_SCREEN} [data-toolbar-slot="${slot}"]`;
  return [at, `${at} *`];
});
// Posed through the cut, not around it: a pose around the figure would read the reader's live scale at
// the pictured UI zoom.
const REGION_SCREEN = { tool: 'free' } as const;
const RegionBar = () => <FrameCut corner="bar" mode="generate" regionScreen={REGION_SCREEN} targets={REGION_BAR_TARGETS} />;

export const CORE_SURFACES: Record<string, ComponentType> = {
  'frame-overview': FrameOverview,
  'frame-modes': FrameModes,
  'frame-topright': FrameTopRight,
  'frame-rail': FrameRail,
  'frame-bar': FrameBar,
  'frame-shelf': ShelfWindow,
  'object-brush': ObjectBrush,
  'region-bar': RegionBar,
  tour: TourPreview,
  layers: LayersTour,
  'notes-row': NotesRowTour,
  'notes-entry': NotesEntryPreview,
  'object-shelf': ShelfFigure,
  'autotrim-modes': AutoTrimModesPreview,
  'context-menu': ContextMenuPreview,
  'delete-confirm': DeleteConfirmPreview,
  'generate-shelf': GenerateShelfMazePreview,
  'generate-shelf-island': GenerateShelfIslandPreview,
  'island-height': IslandHeightPreview,
  'island-richness': IslandRichnessPreview,
};
