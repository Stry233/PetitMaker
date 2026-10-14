// The share-code band the preview shows, rebuilt after map and size changes settle.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { moduleBaseFor } from '../../../../io/share/facts';
import type { GridState } from '../../../../core/model/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import type { ExportOptions } from '../../../../io/export/facts';
import { onTextVerdicts, textVerdictsVersion } from '../../../../state/text-verdicts';
import { usePlanetName } from '../planet/use-planet-library';
import {
  renderShareCodeAsset, shareCodeBuildWidth, shareCodeIssueKey, type ShareCodeAsset, type ShareCodeIssue,
} from '../../../../editor/export/share-code';

export type { ShareCodeIssue };

/** Coalesce map and size changes before building the glyph. */
const BUILD_DEBOUNCE_MS = 250;

interface ShareCodeState {
  /** The rendered band, once built. Null while pending/unavailable. */
  asset: ShareCodeAsset | null;
  /** While rebuilding, retain the previous preview or show its initial loading state. */
  pending: boolean;
  /** A build failure or a recommendation to share the original file for a dense map. */
  issue: ShareCodeIssue | null;
}

/** Rebuild on map, notes, metadata, or size changes; unavailable glyphs never enter the pending state. */
export function useShareCode(
  open: boolean,
  state: GridState | null,
  request: {
    summary: MapProvenanceSummary | null;
    importable: boolean;
    resolution: ExportOptions['resolution'];
    createdAt: string;
    /** The title and description ride in the payload, so an edit to them rebuilds the code too. */
    notesKey?: string;
  },
): ShareCodeState {
  const { summary, importable, resolution, createdAt, notesKey = '' } = request;
  const [code, setCode] = useState<ShareCodeState>({ asset: null, pending: false, issue: null });
  const planetName = usePlanetName(state?.template);
  const tagVerdicts = useSyncExternalStore(onTextVerdicts, textVerdictsVersion);
  // The provenance summary is a fresh object every store read; it only changes while editing,
  // which the modal blocks — read it through a ref so it never re-triggers the effect.
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useEffect(() => {
    if (!open || !state || !importable || !createdAt) {
      setCode({ asset: null, pending: false, issue: null });
      return;
    }
    const width = shareCodeBuildWidth(resolution);
    if (moduleBaseFor(width) === null) {
      setCode({ asset: null, pending: false, issue: null }); // size below the module floor → no code, no wait
      return;
    }
    setCode({ asset: null, pending: true, issue: null });
    let alive = true;
    const id = setTimeout(() => {
      void renderShareCodeAsset(state, summaryRef.current, { createdAt }, width)
        .then((asset) => {
          if (alive) setCode({ asset, pending: false, issue: asset?.notice ?? null });
        })
        .catch((e: unknown) => {
          console.error('[export] share code build failed', e);
          if (alive) setCode({ asset: null, pending: false, issue: shareCodeIssueKey(state) });
        });
    }, BUILD_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(id); };
  }, [open, state, importable, resolution, createdAt, notesKey, planetName, tagVerdicts]);

  return code;
}
