import { useEffect, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../../../../state/store';
import { createMapReviewSession, type MapReviewInput } from '../../../../../editor/review/map-session';
import { useStylizeVersions } from '../stylize/use-stylize-versions';
import { useUiPreview } from '../../../../design/preview';
import { useMapRevision } from '../../../../session/use-map-revision';

/** One export surface's map check (`editor/review/map-session.ts`), over the live map, its notes where
 *  `includeAnnotations` and the chosen illustration where `illustration`. */
export function useMapReview(open: boolean, automatic: boolean, illustration: boolean, includeAnnotations = true) {
  const pictured = useUiPreview();
  const map = useEditorStore(s => s.gridState);
  const notes = useEditorStore(s => s.annotationsEpoch);
  const { selected } = useStylizeVersions();
  const revision = useMapRevision();
  const [session] = useState(createMapReviewSession);
  const input: MapReviewInput = {
    open, automatic, map, revision, pictured,
    notes: includeAnnotations ? notes : null, illustration: illustration ? selected?.id ?? '' : null,
  };
  // Read for this render's map: a verdict never shows for pictures it was not reached on, even for a render.
  const state = useSyncExternalStore(session.subscribe, () => session.snapshot(input));
  // After the paint: a check that starts here begins with the map's capture.
  useEffect(() => { session.watch(input); });
  useEffect(() => () => session.release(), [session]);
  return { ...state, check: session.check, retry: session.retry, cancel: session.cancel };
}
