// The share-code band the preview shows, as `editor/export/share-code.ts:createShareCodeBand` builds it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GridState } from '../../../../core/model/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import type { ExportOptions } from '../../../../io/export/facts';
import { createShareCodeBand, type ShareCodeIssue, type ShareCodeState } from '../../../../editor/export/share-code';

export type { ShareCodeIssue };

/** The band for `state` while `open`. The band decides what makes it a new one, so it is asked at
 *  every render and builds only when its inputs moved. */
export function useShareCode(
  open: boolean,
  state: GridState | null,
  request: {
    summary: MapProvenanceSummary | null;
    importable: boolean;
    resolution: ExportOptions['resolution'];
    /** A posed picture's fixed timestamp; the live window leaves it to the band. */
    createdAt?: string;
    /** The title and description ride in the payload, so an edit to them rebuilds the code too. */
    notesKey?: string;
  },
): ShareCodeState {
  const { summary, importable, resolution, createdAt, notesKey } = request;
  const [band] = useState(createShareCodeBand);
  const code = useSyncExternalStore(band.subscribe, band.snapshot);
  // The provenance summary is a fresh object every store read; it only changes while editing,
  // which the modal blocks, so it is read as a build starts and never asks again by itself.
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useEffect(() => {
    band.request(open && state ? {
      state, summary: () => summaryRef.current, importable, resolution,
      ...(createdAt ? { createdAt } : {}), ...(notesKey ? { notesKey } : {}),
    } : null);
  });
  useEffect(() => () => band.release(), [band]);

  return code;
}
