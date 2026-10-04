import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../../../../state/store';
import { reviewMap, type MapReview } from '../../../../../io/moderation/map/reviewer';
import { captureReviewViews } from './map-capture';
import { useStylizeVersions } from '../stylize/use-stylize-versions';
import { useUiPreview } from '../../../../primitives/ui-preview';
import { useMapRevision } from '../../../../hooks/use-map-revision';

const EMPTY: MapReview = { status: 'unavailable' };
const CLEAR: MapReview = { status: 'clear' };

export function useMapReview(open: boolean, automatic: boolean, illustration: boolean, includeAnnotations = true) {
  const pictured = useUiPreview();
  const map = useEditorStore(s => s.gridState);
  const annotations = useEditorStore(s => s.annotationsEpoch);
  const { selected } = useStylizeVersions();
  const revision = useMapRevision();
  const key = `${revision}:${includeAnnotations ? annotations : "off"}:${illustration ? selected?.id ?? '' : ''}`;
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
        const views = await captureReviewViews(illustration, includeAnnotations);
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
  }, [open, map, key, result, illustration, includeAnnotations]);
  useEffect(() => { if (open && automatic && !result) void check().catch(() => {}); }, [open, automatic, result, check]);
  const retry = useCallback(() => { cancel(); setSnapshot(null); }, [cancel]);
  return { result, pending, check, retry, cancel, revision: key, previewReady: !!result && result.status !== 'blocked' };
}
