import type { LiteHelpSurfaceId } from '../chrome/modals/help/lite-catalog';
import type { ComponentType } from 'react';
import type { helpProvider as webHelpProvider } from '../chrome/modals/help/edition-help';
import { FrameOverview, FrameCut, LayersTour, NotesRowTour, NotesEntryPreview } from '../chrome/modals/help/figures/previews/frame-overview';
import { TourPreview } from '../chrome/modals/help/figures/previews/tour';
import { AutoTrimModesPreview, ObjectShelfPreview, TerrainToolsStrip } from '../chrome/modals/help/figures/previews/strips';
import { ContextMenuPreview, DeleteConfirmPreview } from '../chrome/modals/help/figures/previews/floating';
import { GenerateShelfIslandPreview, GenerateShelfMazePreview, IslandHeightPreview, IslandRichnessPreview } from '../chrome/modals/help/figures/previews/generate';

export const helpProvider = (): ReturnType<typeof webHelpProvider> | undefined => undefined;
export const HELP_SURFACES: Record<string, ComponentType> = {
  'frame-overview': FrameOverview,
  'frame-modes': () => <FrameCut corner="modes" />,
  'frame-topright': () => <FrameCut corner="topright" />,
  'frame-rail': () => <FrameCut corner="rail" />,
  'frame-bar': () => <FrameCut corner="bar" fallback={<TerrainToolsStrip active="draw" />} />,
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
} satisfies Record<LiteHelpSurfaceId, ComponentType>;

export const PROVIDER_IDS: readonly never[] = [];
export const providerBaseUrls = (): string[] => [];
