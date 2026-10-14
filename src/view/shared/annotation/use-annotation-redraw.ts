/**
 * The plan-notes layer's store inputs, mirrored onto either view: one list, so an input added for
 * one view reaches the other.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { GridState } from '../../../core/model/types';
import { onTextVerdicts, textVerdictsVersion } from '../../../state/text-verdicts';
import { useEditorStore } from '../../../state/store';

/**
 * Calls `redraw` with the live map whenever a fact the notes are drawn from changes (the notes'
 * epoch, since their data mutates in place; the draft, selection and dimension switch; the map; the
 * locale; a custom tag's text verdict), and `rebakeText` once the app's fonts land, since a label
 * rasterised before its face loaded keeps the fallback otherwise.
 */
export function useAnnotationRedraw(
  gridState: GridState | null,
  redraw: (gs: GridState) => void,
  rebakeText: () => void,
): void {
  const locale = useEditorStore((s) => s.locale);
  const annotationsEpoch = useEditorStore((s) => s.annotationsEpoch);
  const tagVerdicts = useSyncExternalStore(onTextVerdicts, textVerdictsVersion);
  const annotationDraft = useEditorStore((s) => s.annotationDraft);
  const annotationSelection = useEditorStore((s) => s.annotationSelection);
  const annotationDimensions = useEditorStore((s) => s.annotationDimensions);
  // The callbacks close over each view's own renderer; the latest pair is what runs. Layout
  // effects run before effects, so the redraw below always sees this render's pair.
  const latest = useRef({ redraw, rebakeText });
  useLayoutEffect(() => { latest.current = { redraw, rebakeText }; });

  useEffect(() => {
    const gs = useEditorStore.getState().gridState;
    if (gs) latest.current.redraw(gs);
  }, [annotationsEpoch, annotationDraft, annotationSelection, annotationDimensions, gridState, locale, tagVerdicts]);

  useEffect(() => {
    let live = true;
    void document.fonts?.ready?.then(() => { if (live) latest.current.rebakeText(); });
    return () => { live = false; };
  }, []);
}
