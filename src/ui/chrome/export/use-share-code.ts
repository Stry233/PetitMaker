// src/ui/chrome/export/use-share-code.ts — the export modal's cached share-code asset. The
// preview and the final export draw the SAME rendered band: the code is built once per
// (map, title, size, createdAt) off the modal-open timestamp, debounced against typing, and
// handed to both the preview painter and the export capture. Building runs the real encoder
// (a generated map replays its generator to self-verify), so this must never run per keystroke
// or on the open animation frame — hence async + debounce. While `pending`, the preview stays in
// its loading state (no placeholder band is ever drawn).
import { useEffect, useRef, useState } from 'react';
import { buildShareCode, moduleBaseFor } from '../../../io/share';
import { RESOLUTION_WIDTHS } from '../../../io/export/compose';
import { APP_VERSION } from '../../../version';
import { CURRENT_VERSION } from '../../../io/save-format';
import type { GridState } from '../../../core/model/types';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import type { ExportOptions } from '../../../io/export/types';

export interface ShareCodeAsset {
  canvas: HTMLCanvasElement;
  /** Composition width the code was encoded for — reuse only when it matches comp.width. */
  builtWidth: number;
  /** Input fingerprint — reuse only when it matches the inputs at export time. */
  builtKey: string;
}

/** Fingerprint of everything that changes the encoded band for a given map. */
export function shareCodeKey(width: number, title: string, createdAt: string): string {
  return `${width}|${title}|${createdAt}`;
}

/** Render a built ShareCode to a canvas (shared by the preview asset and the export path). */
export async function renderShareCodeCanvas(
  state: GridState,
  summary: MapProvenanceSummary | null,
  meta: { title: string; createdAt: string },
  width: number,
): Promise<HTMLCanvasElement | null> {
  const code = await buildShareCode(state, summary, { appVersion: APP_VERSION, saveVersion: CURRENT_VERSION, title: meta.title, createdAt: meta.createdAt }, width);
  if (!code) return null;
  const gc = document.createElement('canvas');
  gc.width = code.width;
  gc.height = code.height;
  gc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(code.rgba), code.width, code.height), 0, 0);
  return gc;
}

/** The composition width a Size preset exports at — what the code must be encoded for. The
 *  'original' preset composes at the map's native width at export time; its PREVIEW composes at
 *  the 'high' width, so the preview asset is built there and the export rebuilds at native. */
export function shareCodeBuildWidth(resolution: ExportOptions['resolution']): number {
  return resolution === 'original' ? RESOLUTION_WIDTHS.high : RESOLUTION_WIDTHS[resolution];
}

const TITLE_DEBOUNCE_MS = 600;

export interface ShareCodeState {
  /** The rendered band, once built. Null while pending/unavailable. */
  asset: ShareCodeAsset | null;
  /** True while a build is scheduled or running — the preview stays in its loading state
   *  (there is NO placeholder band; the composition is simply not shown yet). */
  pending: boolean;
}

/** Cached share-code asset for the export modal. `pending` is true from the moment a build is
 *  needed until it resolves; it stays false when no code will exist (not importable, or the
 *  chosen size is below the module floor), so the preview never waits for a code that cannot
 *  come. Rebuilds when the map, title (debounced), size, or session timestamp change. */
export function useShareCode(
  open: boolean,
  state: GridState | null,
  summary: MapProvenanceSummary | null,
  importable: boolean,
  title: string,
  resolution: ExportOptions['resolution'],
  createdAt: string,
): ShareCodeState {
  const [code, setCode] = useState<ShareCodeState>({ asset: null, pending: false });
  // The provenance summary is a fresh object every store read; it only changes while editing,
  // which the modal blocks — read it through a ref so it never re-triggers the effect.
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useEffect(() => {
    if (!open || !state || !importable || !createdAt) {
      setCode({ asset: null, pending: false });
      return;
    }
    const width = shareCodeBuildWidth(resolution);
    if (moduleBaseFor(width) === null) {
      setCode({ asset: null, pending: false }); // size below the module floor → no code, no wait
      return;
    }
    setCode({ asset: null, pending: true });
    let alive = true;
    const id = setTimeout(() => {
      void renderShareCodeCanvas(state, summaryRef.current, { title, createdAt }, width)
        .then((canvas) => {
          if (alive) setCode({ asset: canvas ? { canvas, builtWidth: width, builtKey: shareCodeKey(width, title, createdAt) } : null, pending: false });
        })
        .catch(() => { if (alive) setCode({ asset: null, pending: false }); });
    }, TITLE_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(id); };
  }, [open, state, importable, title, resolution, createdAt]);

  return code;
}
