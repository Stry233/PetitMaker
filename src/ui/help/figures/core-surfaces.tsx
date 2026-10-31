/*
 * The interface figures every edition bundles: the frame, the tour, layers and notes, the shelf,
 * trim, the floating menus and the Planet and Maze shelves. It imports no assistant, share or
 * camera preview, so the offline edition can take it whole.
 */
import type { ComponentType } from 'react';
import { FrameOverview, FrameCut, NotesEntryPreview } from './previews/frame-overview';
import { LayersTour, NotesRowTour } from './previews/frame-tours';
import { TourPreview } from './previews/tour';
import { AutoTrimModesPreview, ObjectShelfPreview, TerrainToolsStrip } from './previews/strips';
import { ContextMenuPreview, DeleteConfirmPreview } from './previews/floating';
import {
  GenerateShelfIslandPreview, GenerateShelfMazePreview, IslandHeightPreview, IslandRichnessPreview,
} from './previews/generate';

const FrameModes = () => <FrameCut corner="modes" />;
const FrameTopRight = () => <FrameCut corner="topright" />;
const FrameRail = () => <FrameCut corner="rail" />;
// With no mode armed the live shell shows no bottom bar, so the cut stands in the terrain bar's
// own cells instead of an empty figure.
const FrameBar = () => <FrameCut corner="bar" fallback={<TerrainToolsStrip active="draw" />} />;

export const CORE_SURFACES: Record<string, ComponentType> = {
  'frame-overview': FrameOverview,
  'frame-modes': FrameModes,
  'frame-topright': FrameTopRight,
  'frame-rail': FrameRail,
  'frame-bar': FrameBar,
  tour: TourPreview,
  layers: LayersTour,
  'notes-row': NotesRowTour,
  'notes-entry': NotesEntryPreview,
  'object-shelf': ObjectShelfPreview,
  'autotrim-modes': AutoTrimModesPreview,
  'context-menu': ContextMenuPreview,
  'delete-confirm': DeleteConfirmPreview,
  'generate-shelf': GenerateShelfMazePreview,
  'generate-shelf-island': GenerateShelfIslandPreview,
  'island-height': IslandHeightPreview,
  'island-richness': IslandRichnessPreview,
};
