import { useEditorStore } from '../../state/store';
import { useMapRevision } from '../session/use-map-revision';
import type * as WebExport from '../chrome/modals/export/edition-export';

// The container cannot run the review workers. Its export notice requires manual review.
const idle = () => {};
const unavailable = async (): Promise<never> => { throw new Error('Automatic review unavailable in Lite'); };
export const StylizeEntry = () => null;
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

export const exportPresetDescriptions = { share: 'lite.preset_share_desc', plain: 'lite.preset_plain_desc' } as const;
