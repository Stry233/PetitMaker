import type { HelpPage } from '../help/page-schema';
import type { ComponentType } from 'react';
import type { helpProvider as webHelpProvider } from '../help/edition-help';
import { FrameOverview, FrameCut, NotesEntryPreview } from '../help/figures/previews/frame-overview';
import { LayersTour, NotesRowTour } from '../help/figures/previews/frame-tours';
import { TourPreview } from '../help/figures/previews/tour';
import { AutoTrimModesPreview, ObjectShelfPreview, TerrainToolsStrip } from '../help/figures/previews/strips';
import { ContextMenuPreview, DeleteConfirmPreview } from '../help/figures/previews/floating';
import { GenerateShelfIslandPreview, GenerateShelfMazePreview, IslandHeightPreview, IslandRichnessPreview } from '../help/figures/previews/generate';

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
};

export const PROVIDER_IDS: readonly never[] = [];
export const providerBaseUrls = (): string[] => [];
type Figure = HelpPage['figure'];
/** A surface figure this edition does not bundle is left out; demos draw from the shared scenes. */
const shown = (figure: Figure): Figure => (figure?.kind === 'surface' && !(figure.surface in HELP_SURFACES) ? undefined : figure);

/** A page as the offline edition shows it: its entries are already this edition's (`catalog.ts`),
 *  and only the figures it bundles remain. */
export function editionHelpPage(page: HelpPage): HelpPage {
  return {
    ...page,
    figure: shown(page.figure),
    sections: page.sections.map((section) => (section.kind === 'prose' ? { ...section, figure: shown(section.figure) } : section)),
  };
}
