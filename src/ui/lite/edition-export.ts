import { useCallback, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../state/store';
import type { ExportOptions, ExportPreset } from '../../io/export/types';
import type * as WebExport from '../chrome/modals/export/edition-export';

// The container cannot run the review workers. Its export notice requires manual review.
export const automaticExportReview = false;
const idle = () => {};
const unavailable = async (): Promise<never> => { throw new Error('Automatic review unavailable in Lite'); };
export const isReviewTooLong = (): boolean => false;
export const StylizeEntry = () => null;

export const useMapReview: typeof WebExport.useMapReview = () => {
  const map = useEditorStore(s => s.gridState);
  const bus = useEditorStore(s => s.eventBus);
  const annotations = useEditorStore(s => s.annotationsEpoch);
  const subscribe = useCallback((notify: () => void) => {
    bus.on('cells-changed', notify); bus.on('objects-changed', notify); bus.on('history-applied', notify);
    return () => { bus.off('cells-changed', notify); bus.off('objects-changed', notify); bus.off('history-applied', notify); };
  }, [bus]);
  const read = useCallback(() => `${map?.cellsVersion ?? 0}:${map?.objectsVersion ?? 0}:${annotations}`, [map, annotations]);
  const revision = useSyncExternalStore(subscribe, read, read);
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
