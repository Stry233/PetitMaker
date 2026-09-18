// Preview and export share a debounced glyph asset when its pixel width and payload inputs match.
import { useEffect, useRef, useState } from 'react';
import { buildShareCode } from '../../../../io/share/export';
import { moduleBaseFor } from '../../../../io/share/glyph/geometry';
import { RESOLUTION_WIDTHS } from '../../../../io/export/compose';
import { APP_VERSION } from '../../../../version';
import { CURRENT_VERSION } from '../../../../io/save-format';
import { stackedCoatingIds } from '../../../../io/json-codec';
import type { GridState } from '../../../../core/model/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import type { ExportOptions } from '../../../../io/export/types';

export interface ShareCodeAsset {
  canvas: HTMLCanvasElement;
  /** Width and metadata fingerprint within the current map's cache entry. */
  builtKey: string;
  notice: 'export.code_dense' | 'export.notes_omitted' | null;
}

/** Fingerprint of everything that changes the encoded band for a given map. */
export function shareCodeKey(bandWidth: number, createdAt: string): string {
  return `${bandWidth}|${createdAt}`;
}

/** Render a built ShareCode to a canvas (shared by the preview asset and the export path). */
export async function renderShareCodeAsset(
  state: GridState,
  summary: MapProvenanceSummary | null,
  meta: { createdAt: string },
  width: number,
): Promise<ShareCodeAsset | null> {
  const code = await buildShareCode(state, summary, { appVersion: APP_VERSION, saveVersion: CURRENT_VERSION, createdAt: meta.createdAt }, width);
  if (!code) return null;
  const gc = document.createElement('canvas');
  gc.width = code.width;
  gc.height = code.height;
  gc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(code.rgba), code.width, code.height), 0, 0);
  return { canvas: gc, builtKey: shareCodeKey(gc.width, meta.createdAt), notice: code.notesOmitted ? 'export.notes_omitted' : code.shareOriginalRecommended ? 'export.code_dense' : null };
}

/** Native exports use a High-size preview; the final capture rebuilds at the reserved native width. */
function shareCodeBuildWidth(resolution: ExportOptions['resolution']): number {
  return resolution === 'original' ? RESOLUTION_WIDTHS.high : RESOLUTION_WIDTHS[resolution];
}

/** Coalesce map and size changes before building the glyph. */
const BUILD_DEBOUNCE_MS = 250;

export interface ShareCodeState {
  /** The rendered band, once built. Null while pending/unavailable. */
  asset: ShareCodeAsset | null;
  /** While rebuilding, retain the previous preview or show its initial loading state. */
  pending: boolean;
  /** A build failure or a recommendation to share the original file for a dense map. */
  issue: ShareCodeIssue | null;
}

export type ShareCodeIssue = 'export.code_overlap' | 'export.code_failed' | 'export.code_dense' | 'export.notes_omitted';

/** Overlapping coatings are legal placements but cannot share one encoded surface cell. */
export function shareCodeIssueKey(state: GridState | null | undefined): ShareCodeIssue {
  return state && stackedCoatingIds(state.objects.values()).size > 0 ? 'export.code_overlap' : 'export.code_failed';
}

/** Rebuild on map, notes, metadata, or size changes; unavailable glyphs never enter the pending state. */
export function useShareCode(
  open: boolean,
  state: GridState | null,
  summary: MapProvenanceSummary | null,
  importable: boolean,
  resolution: ExportOptions['resolution'],
  createdAt: string,
  /** The title and description ride in the payload, so an edit to them rebuilds the code too. */
  notesKey = '',
): ShareCodeState {
  const [code, setCode] = useState<ShareCodeState>({ asset: null, pending: false, issue: null });
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
  }, [open, state, importable, resolution, createdAt, notesKey]);

  return code;
}
