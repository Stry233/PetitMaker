/*
 * surfaces.tsx — the Help Center's interface figures: the REAL surfaces, mounted live.
 *
 * Every entry is the product's own component inside a `PreviewFrame` (non-interactive, contained,
 * un-zoomed), so a figure can never drift from what ships: the settings panel is the settings
 * panel, the keyboard shows the visitor's own rebinds, the layer panel reads their own map. The
 * mounts live in `previews/` by neighborhood; this file is only the id → component table the page
 * descriptors name.
 */
import type { ComponentType } from 'react';
import { SettingsPreview, KeyboardPreview, PlanetPreview, ArrivalPreview } from './previews/chrome';
import {
  SavePreview, SharePreview, ShareWindowPreview, ImportPreview, JsonPreview, ChecklistPreview, FullChecklistPreview,
  CandidatesPreview, SearchPreview, ExportControlsPreview, ExportControlsOpenPreview, FooterEditorPreview,
  StylizeDirectionsPreview, StylizeStudioPreview,
} from './previews/share';
import {
  PicHeaderPreview, PicLayersPreview, PicShotsPreview, PicCodePreview, PicBrandPreview, PicFooterBandPreview,
} from './previews/picture-bands';
import {
  AgentDreamPreview, AgentSetupPreview, AgentSetupDetectPreview, AgentOversightPreview, AgentPlanPreview,
  AgentSteerPreview, AgentTrailPreview, AgentRegionPreview, AgentTroublePreview, AgentBannerPreview,
  AgentUndoPreview,
} from './previews/assistant';
import {
  GenerateShelfIslandPreview, GenerateShelfMazePreview, IslandHeightPreview, IslandRichnessPreview,
  LetterMaterialsPreview, PictureMaterialsPreview, PictureStencilPreview, PictureTuningPreview,
} from './previews/generate';
import { TourPreview } from './previews/tour';
import { Camera3dPreview } from './previews/camera';
import { FrameOverview, FrameCut, LayersTour, NotesRowTour, NotesEntryPreview } from './previews/frame-overview';
import { AutoTrimModesPreview, ObjectShelfPreview, TerrainToolsStrip } from './previews/strips';
import { ContextMenuPreview, DeleteConfirmPreview } from './previews/floating';

const FrameModes = () => <FrameCut corner="modes" />;
const FrameAgent = () => <FrameCut corner="agent" />;
const FrameTopRight = () => <FrameCut corner="topright" />;
const FrameRail = () => <FrameCut corner="rail" />;
// With no mode armed the live shell shows no bottom bar, so the cut stands in the terrain bar's
// own cells instead of an empty figure.
const FrameBar = () => <FrameCut corner="bar" fallback={<TerrainToolsStrip active="draw" />} />;

/** The footer's one figure: the editor you type in, over the band it produces on the picture. */
const FooterFigure = () => (<><FooterEditorPreview /><PicFooterBandPreview /></>);

export const HELP_SURFACES: Record<string, ComponentType> = {
  'frame-overview': FrameOverview,
  'frame-modes': FrameModes,
  'frame-agent': FrameAgent,
  'frame-topright': FrameTopRight,
  'frame-rail': FrameRail,
  'frame-bar': FrameBar,
  save: SavePreview,
  share: SharePreview,
  'share-window': ShareWindowPreview,
  import: ImportPreview,
  json: JsonPreview,
  'export-controls': ExportControlsPreview,
  'export-controls-open': ExportControlsOpenPreview,
  'footer-editor': FooterFigure,
  'stylize-directions': StylizeDirectionsPreview,
  'stylize-window': StylizeStudioPreview,
  'pic-header': PicHeaderPreview,
  'pic-layers': PicLayersPreview,
  'pic-shots': PicShotsPreview,
  'pic-code': PicCodePreview,
  'pic-brand': PicBrandPreview,
  planet: PlanetPreview,
  'agent-dream': AgentDreamPreview,
  'agent-setup': AgentSetupPreview,
  'agent-setup-detect': AgentSetupDetectPreview,
  'agent-oversight': AgentOversightPreview,
  'agent-plan': AgentPlanPreview,
  'agent-steer': AgentSteerPreview,
  'agent-trail': AgentTrailPreview,
  'agent-region': AgentRegionPreview,
  'agent-trouble': AgentTroublePreview,
  'agent-banner': AgentBannerPreview,
  'agent-undo': AgentUndoPreview,
  settings: SettingsPreview,
  arrival: ArrivalPreview,
  keyboard: KeyboardPreview,
  tour: TourPreview,
  layers: LayersTour,
  'notes-row': NotesRowTour,
  'notes-entry': NotesEntryPreview,
  candidates: CandidatesPreview,
  'stencil-picture': PictureStencilPreview,
  'object-shelf': ObjectShelfPreview,
  'autotrim-modes': AutoTrimModesPreview,
  'context-menu': ContextMenuPreview,
  'delete-confirm': DeleteConfirmPreview,
  'generate-shelf': GenerateShelfMazePreview,
  'letter-materials': LetterMaterialsPreview,
  'picture-materials': PictureMaterialsPreview,
  'picture-tuning': PictureTuningPreview,
  'island-richness': IslandRichnessPreview,
  'island-height': IslandHeightPreview,
  'generate-shelf-island': GenerateShelfIslandPreview,
  search: SearchPreview,
  'camera-3d': Camera3dPreview,
  checklist: ChecklistPreview,
  'checklist-full': FullChecklistPreview,
};
