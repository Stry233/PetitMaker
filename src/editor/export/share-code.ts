// The share picture's PetitGlyph band, built over the map as it may leave the browser and drawn to a
// canvas. The preview and the export share one band when its width and payload inputs match.
import { buildShareCode } from '../../io/share';
import { RESOLUTION_WIDTHS } from '../../io/export/compose';
import { APP_VERSION } from '../../platform/build/build-info';
import { CURRENT_VERSION } from '../../io/save/format';
import { exportableState } from '../../io/export/exportable';
import { hasCoatingConflict } from '../../rules/placement-overlap';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import type { ExportOptions } from '../../io/export/types';
import { useEditorStore } from '../../state/store';
import { planetNaming, shownPlanetName } from '../session/planet-names';

export interface ShareCodeAsset {
  canvas: HTMLCanvasElement;
  /** Width and metadata fingerprint within the current map's cache entry. */
  builtKey: string;
  notice: 'export.code_dense' | 'export.notes_omitted' | null;
}

export type ShareCodeIssue = 'export.code_overlap' | 'export.code_failed' | 'export.code_dense' | 'export.notes_omitted';

/** Fingerprint of everything that changes the encoded band for a given map. */
export function shareCodeKey(bandWidth: number, createdAt: string, planetName: string): string {
  return `${bandWidth}|${createdAt}|${planetName}`;
}

/** Render a built ShareCode to a canvas (shared by the preview asset and the export path). */
export async function renderShareCodeAsset(
  state: GridState,
  summary: MapProvenanceSummary | null,
  meta: { createdAt: string },
  width: number,
): Promise<ShareCodeAsset | null> {
  const locale = useEditorStore.getState().locale;
  const planetName = shownPlanetName(state.template, locale);
  const code = await buildShareCode(
    exportableState(state, planetNaming(locale)), summary, { appVersion: APP_VERSION, saveVersion: CURRENT_VERSION, createdAt: meta.createdAt },
    width,
  );
  if (!code) return null;
  const gc = document.createElement('canvas');
  gc.width = code.width;
  gc.height = code.height;
  gc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(code.rgba), code.width, code.height), 0, 0);
  return { canvas: gc, builtKey: shareCodeKey(gc.width, meta.createdAt, planetName), notice: code.notesOmitted ? 'export.notes_omitted' : code.shareOriginalRecommended ? 'export.code_dense' : null };
}

/** Native exports use a High-size preview; the final capture rebuilds at the reserved native width. */
export function shareCodeBuildWidth(resolution: ExportOptions['resolution']): number {
  return resolution === 'original' ? RESOLUTION_WIDTHS.high : RESOLUTION_WIDTHS[resolution];
}

/** Why a band could not be built: legacy coating conflicts use the same overlap rule as new placements. */
export function shareCodeIssueKey(state: GridState | null | undefined): ShareCodeIssue {
  return state && hasCoatingConflict(state) ? 'export.code_overlap' : 'export.code_failed';
}
