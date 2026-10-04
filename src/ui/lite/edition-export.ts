import { useEditorStore } from '../../state/store';
import { useMapRevision } from '../hooks/use-map-revision';
import type { ExportOptions, ExportPreset } from '../../io/export/types';
import type * as WebExport from '../chrome/modals/export/edition-export';
import { listPlanets, recordPlanetNameVerdict, settlePlanetName, uncheckedPlanetName } from '../../io/planet-library';

// The container cannot run the review workers. Its export notice requires manual review.
export const automaticExportReview = false;
const idle = () => {};
const unavailable = async (): Promise<never> => { throw new Error('Automatic review unavailable in Lite'); };
export const isReviewTooLong = (): boolean => false;
export const StylizeEntry = () => null;
/** Adopted planet names pass as export text does here, under the manual export notice. */
export const reviewPlanetNames: typeof WebExport.reviewPlanetNames = async () => {
  for (const entry of listPlanets()) if (!entry.nameReviewed) settlePlanetName(entry.entryId, entry.name, null);
  const template = useEditorStore.getState().gridState?.template;
  const name = template ? uncheckedPlanetName(template) : null;
  if (name !== null) recordPlanetNameVerdict(name, true);
};

export const useMapReview: typeof WebExport.useMapReview = () => {
  const mapRevision = useMapRevision();
  const annotations = useEditorStore(s => s.annotationsEpoch);
  const revision = `${mapRevision}:${annotations}`;
  return { result: null, pending: false, check: unavailable, retry: idle, cancel: idle, revision, previewReady: true };
};

export const useTextReview: typeof WebExport.useTextReview = () => ({
  allowed: false, issue: null, pending: false, progress: undefined, paused: false,
  check: unavailable, cancel: idle, retry: idle,
});

export function applyExportPreset(options: ExportOptions, preset: ExportPreset): ExportOptions {
  const share = preset === 'share';
  return { ...options, preset, importable: share, layerPreview: share, grid: share, footer: share, card3d: false };
}
export const exportPresetDescriptions = { share: 'lite.preset_share_desc', plain: 'lite.preset_plain_desc' } as const;
