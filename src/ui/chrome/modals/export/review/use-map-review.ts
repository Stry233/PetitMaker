import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../../../../state/store';
import { reviewMap, type MapReview } from '../../../../../io/moderation/map/reviewer';
import { captureReviewViews } from './map-capture';
import { useStylizeVersions } from '../stylize/use-stylize-versions';
import { useUiPreview } from '../../../../primitives/ui-preview';

const EMPTY: MapReview = { status: 'unavailable' };
const CLEAR: MapReview = { status: 'clear' };

export function useMapReview(open: boolean, automatic: boolean, illustration: boolean) {
  const pictured = useUiPreview();
  const map = useEditorStore(s => s.gridState);
  const bus = useEditorStore(s => s.eventBus);
  const annotations = useEditorStore(s => s.annotationsEpoch);
  const { selected } = useStylizeVersions();
  const subscribe = useCallback((notify: () => void) => {
    bus.on('cells-changed', notify); bus.on('objects-changed', notify); bus.on('history-applied', notify);
    return () => { bus.off('cells-changed', notify); bus.off('objects-changed', notify); bus.off('history-applied', notify); };
  }, [bus]);
  const read = useCallback(() => `${map?.cellsVersion ?? 0}:${map?.objectsVersion ?? 0}`, [map]);
  const revision = useSyncExternalStore(subscribe, read, read);
  const key = `${revision}:${annotations}:${illustration ? selected?.id ?? '' : ''}`;
  const [snapshot, setSnapshot] = useState<{ map: typeof map; key: string; result: MapReview } | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef<{ controller: AbortController; promise: Promise<MapReview> } | null>(null);
  const cancel = useCallback(() => {
    active.current?.controller.abort(); active.current = null; setPending(false);
  }, []);
  useEffect(() => { cancel(); return cancel; }, [open, map, key, cancel]);
  const result = pictured ? CLEAR : snapshot?.map === map && snapshot?.key === key ? snapshot.result : null;
  const check = useCallback(async (): Promise<MapReview> => {
    if (!open || !map) return EMPTY;
    if (result) return result;
    if (active.current) return active.current.promise;
    const controller = new AbortController();
    setPending(true);
    const promise = (async () => {
      try {
        const views = await captureReviewViews(illustration);
        const verdict = await reviewMap(views, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        setSnapshot({ map, key, result: verdict });
        return verdict;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        setSnapshot({ map, key, result: EMPTY }); return EMPTY;
      } finally {
        if (active.current?.controller === controller) { active.current = null; setPending(false); }
      }
    })();
    active.current = { controller, promise };
    return promise;
  }, [open, map, key, result, illustration]);
  useEffect(() => { if (open && automatic && !result) void check().catch(() => {}); }, [open, automatic, result, check]);
  const retry = useCallback(() => { cancel(); setSnapshot(null); }, [cancel]);
  return { result, pending, check, retry, cancel, revision: key, previewReady: !!result && result.status !== 'blocked' };
}
