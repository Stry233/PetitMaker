// The share picture's PetitGlyph band, built over the map as it may leave the browser and drawn to a
// canvas. The preview and the export share one band when its width and payload inputs match; a
// preview asks for its band through `createShareCodeBand`, which owns when a band is built at all,
// what makes a band asked for again a new one, the wait for changes to settle and what a failed
// build says.
import { buildShareCode } from '../../io/share';
import { moduleBaseFor } from '../../io/share/facts';
import { createSignal } from '../../core/base/signal';
import { RESOLUTION_WIDTHS } from '../../io/export/compose';
import { APP_VERSION } from '../../platform/build/build-info';
import { CURRENT_VERSION } from '../../io/save/format';
import { exportableState } from '../../io/export/exportable';
import { hasCoatingConflict } from '../../rules/placement-overlap';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import type { ExportOptions } from '../../io/export/types';
import { useEditorStore } from '../../state/store';
import { onTextVerdicts, textVerdictsVersion } from '../../state/text-verdicts';
import { onPlanetLibraryChange } from '../../io/storage/planet-library';
import { planetNaming, shownPlanetName } from '../session/planet-names';

export interface ShareCodeAsset {
  canvas: HTMLCanvasElement;
  /** The timestamp its payload carries, which an export of the same picture carries too. */
  createdAt: string;
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
  return { canvas: gc, createdAt: meta.createdAt, builtKey: shareCodeKey(gc.width, meta.createdAt, planetName), notice: code.notesOmitted ? 'export.notes_omitted' : code.shareOriginalRecommended ? 'export.code_dense' : null };
}

/** Native exports use a High-size preview; the final capture rebuilds at the reserved native width. */
function shareCodeBuildWidth(resolution: ExportOptions['resolution']): number {
  return resolution === 'original' ? RESOLUTION_WIDTHS.high : RESOLUTION_WIDTHS[resolution];
}

/** Whether a picture of `resolution` is wide enough to carry a code at all. */
export function codeFitsSize(resolution: ExportOptions['resolution']): boolean {
  return moduleBaseFor(shareCodeBuildWidth(resolution)) !== null;
}

/** Why a band could not be built: legacy coating conflicts use the same overlap rule as new placements. */
export function shareCodeIssueKey(state: GridState | null | undefined): ShareCodeIssue {
  return state && hasCoatingConflict(state) ? 'export.code_overlap' : 'export.code_failed';
}

/** Map and size changes settle this long, in ms, before a preview's band is built. */
const BUILD_DEBOUNCE_MS = 250;

/** A preview's band as it stands: the built band, whether one is on its way (the preview keeps its
 *  last picture meanwhile), and what the window says about it. */
export interface ShareCodeState {
  asset: ShareCodeAsset | null;
  pending: boolean;
  /** A build failure, or the notice a built band brings. */
  issue: ShareCodeIssue | null;
}

const NO_BAND: ShareCodeState = { asset: null, pending: false, issue: null };
const ON_ITS_WAY: ShareCodeState = { asset: null, pending: true, issue: null };

/** What a preview's band is built for. */
export interface ShareCodeRequest {
  state: GridState;
  /** Read as the build starts: the summary is a fresh object on every store read. */
  summary: () => MapProvenanceSummary | null;
  /** Whether the picture carries a code at all (`io/export/facts.ts:isImportable`). */
  importable: boolean;
  resolution: ExportOptions['resolution'];
  /** A posed picture's fixed timestamp for the payload; left out, the band's own. */
  createdAt?: string;
  /** The title and description the payload carries, as one string: an edit to them is a new band. */
  notesKey?: string;
}

/** What a band is built from besides the map itself, as one string; a request that matches the one
 *  standing asks for nothing. The planet's shown name and the custom tags' verdicts are read here,
 *  since both ride in the payload and change with no word from the window. */
function inputsKey(request: ShareCodeRequest): string {
  const planetName = shownPlanetName(request.state.template, useEditorStore.getState().locale);
  return JSON.stringify([request.importable, request.resolution, request.createdAt ?? '', request.notesKey ?? '', planetName, textVerdictsVersion()]);
}

/** One preview's band, as an external store its window reads. */
interface ShareCodeBand {
  /** Asks for the band `request` builds in place of the one asked before; null asks for none. A size
   *  below the code's module floor, or a picture that carries no code, builds none and waits for none;
   *  a request for the band already asked for changes nothing, so a surface may ask at every render. */
  request(request: ShareCodeRequest | null): void;
  /** Stops a build on its way, leaving what the band says, as a preview going away does. */
  release(): void;
  subscribe(listener: () => void): () => void;
  snapshot(): ShareCodeState;
}

export function createShareCodeBand(): ShareCodeBand {
  const band = createSignal<ShareCodeState>(NO_BAND);
  let stop = (): void => {};
  // One timestamp from the first band asked for until none is: it goes into the payload, so the
  // bands of one window session, and the export that reuses one, carry the same.
  let session = '';
  let asked: { request: ShareCodeRequest; key: string } | null = null;
  let unwatch: (() => void) | null = null;
  const publish = (next: ShareCodeState): void => { if (band.get() !== next) band.emit(next); };
  /** While a band is asked for, a planet's name or a tag's verdict landing asks for it again. */
  const watch = (on: boolean): void => {
    if (!on) { unwatch?.(); unwatch = null; return; }
    if (unwatch) return;
    const again = (): void => { if (asked) self.request(asked.request); };
    const offVerdicts = onTextVerdicts(again);
    const offLibrary = onPlanetLibraryChange(again);
    unwatch = () => { offVerdicts(); offLibrary(); };
  };
  const self: ShareCodeBand = {
    request(request) {
      const key = request ? inputsKey(request) : '';
      if (request && asked && asked.request.state === request.state && asked.key === key) {
        asked = { request, key };
        return;
      }
      asked = request ? { request, key } : null;
      watch(request !== null);
      stop();
      stop = () => {};
      if (!request) session = '';
      if (!request || !request.importable || !codeFitsSize(request.resolution)) {
        publish(NO_BAND);
        return;
      }
      const width = shareCodeBuildWidth(request.resolution);
      const createdAt = request.createdAt ?? (session ||= new Date().toISOString());
      publish(ON_ITS_WAY);
      let alive = true;
      const timer = setTimeout(() => {
        void renderShareCodeAsset(request.state, request.summary(), { createdAt }, width)
          .then((asset) => { if (alive) publish({ asset, pending: false, issue: asset?.notice ?? null }); })
          .catch((e: unknown) => {
            console.error('[export] share code build failed', e);
            if (alive) publish({ asset: null, pending: false, issue: shareCodeIssueKey(request.state) });
          });
      }, BUILD_DEBOUNCE_MS);
      stop = () => { alive = false; clearTimeout(timer); };
    },
    release() {
      asked = null;
      watch(false);
      stop();
      stop = () => {};
    },
    subscribe: (listener) => band.subscribe(() => listener()),
    snapshot: () => band.get(),
  };
  return self;
}
