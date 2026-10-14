// The Lite edition's text-review and export policy. The container cannot run the review workers, so
// outside text passes as export text does here, under the export notice's manual review; a preset
// also sets the presentation choices the Lite card is drawn with.
import type * as Web from './edition-review';
import type { ExportOptions, ExportPreset } from '../../io/export/types';
import { listPlanets, settlePlanetName } from '../../io/storage/planet-library';
import { uncheckedPlanetName } from '../../state/planet-name-verdict';
import { recordTextVerdict } from '../../state/text-verdicts';
import { useEditorStore } from '../../state/store';

export const automaticExportReview: typeof Web.automaticExportReview = false;
export const isReviewTooLong: typeof Web.isReviewTooLong = () => false;

export const reviewPlanetNames: typeof Web.reviewPlanetNames = async () => {
  for (const entry of listPlanets()) if (!entry.nameReviewed) settlePlanetName(entry.entryId, entry.name, null);
  const template = useEditorStore.getState().gridState?.template;
  const name = template ? uncheckedPlanetName(template, listPlanets()) : null;
  if (name !== null) recordTextVerdict(name, true);
};

export const reviewCustomTags: typeof Web.reviewCustomTags = async () => {
  for (const tag of useEditorStore.getState().gridState?.annotations?.customTags ?? []) recordTextVerdict(tag.text, true);
};

export const applyExportPreset: typeof Web.applyExportPreset = (options: ExportOptions, preset: ExportPreset): ExportOptions => {
  const share = preset === 'share';
  return { ...options, preset, layerPreview: share, grid: share, footer: share, card3d: false };
};
