/*
 * The id-to-component table of the Help Center's interface figures: each the product's own component
 * inside a `PreviewFrame`, mounted from `previews/`. The figures every edition bundles are
 * `core-surfaces.tsx`; this adds the web edition's own.
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
  LetterMaterialsPreview, PictureMaterialsPreview, PictureStencilPreview, PictureTuningPreview,
} from './previews/generate';
import { Camera3dPreview } from './previews/camera';
import { FrameCut } from './previews/frame-overview';
import { CORE_SURFACES } from './core-surfaces';

const FrameAgent = () => <FrameCut corner="agent" />;

/** The footer's one figure: the editor you type in, over the band it produces on the picture. */
const FooterFigure = () => (<><FooterEditorPreview /><PicFooterBandPreview /></>);

export const HELP_SURFACES: Record<string, ComponentType> = {
  ...CORE_SURFACES,
  'frame-agent': FrameAgent,
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
  candidates: CandidatesPreview,
  'stencil-picture': PictureStencilPreview,
  'letter-materials': LetterMaterialsPreview,
  'picture-materials': PictureMaterialsPreview,
  'picture-tuning': PictureTuningPreview,
  search: SearchPreview,
  'camera-3d': Camera3dPreview,
  checklist: ChecklistPreview,
  'checklist-full': FullChecklistPreview,
};
