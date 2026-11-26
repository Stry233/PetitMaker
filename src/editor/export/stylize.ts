/* The illustration studio's jobs against the live map: a provider take with its custom-prompt check
 * and style reference, a local pack take with its seed roll, each minted onto the version shelf and
 * remembered as the next direction; and the provider connection's reading, target and filing, which
 * `stylize-connection.ts` drives. The studio keeps its drafts, timers and status slots. */
import { packSampleUrl, packSwatchUrl } from '../../assets/style-sample-urls';
import { useEditorStore } from '../../state/store';
import { versionSrc, versionStore } from '../../state/stylize-versions';
import { isAbortError } from '../../platform/async/abort';
import { loadImage } from '../../platform/async/load-image';
import { sanitizeEndpointUrl } from '../../platform/remote/endpoint-url';
import { reviewText, ReviewWorkerLease } from '../../pipelines/moderation';
import {
  CUSTOM_DIRECTION_ID, CUSTOM_PROMPT_MAX, DIALECTS, STYLE_PACKS, STYLIZE_PROVIDERS, StylizeError, loadProcRenderer,
  neuralPacksUsableNow, procPackMeta, resolveRecipe, runEngine, toStylizeStatus,
  type DialectConfig, type DirectionId, type EngineDeps, type Recipe, type StylizeDialect, type StylizeDirection,
  type StylizeProvider, type StylizeStatus,
} from '../../pipelines/stylize';
import { PROC_PACK_META } from '../../pipelines/stylize/facts';
import { canonicalBytes, canonicalize } from '../../io/save/canonical';
import { loadStylizeKey, loadStylizeSettings, saveStylizeKey, saveStylizeSettings, type StylizeSettings } from '../../io/storage/stylize-settings';
import { host } from '../host/host';

export { neuralPacksUsable, retainNeuralRuntime } from '../../pipelines/stylize';
export { loadProcRenderer, runEngine };
export type { DialectConfig, StylizeDialect, StylizeStatus };

/** Injectable provider-backed generation runner. */
export type RunStylize = (
  deps: EngineDeps,
  direction: DirectionId,
  customText: string | undefined,
  recipe: Recipe,
  signal?: AbortSignal,
) => Promise<{ image: HTMLImageElement }>;

/** How a take ended: kept on the shelf, made stale by a map edit meanwhile, or failed with the
 *  status to show (null for a cancellation). */
export type TakeOutcome = { status: 'kept' } | { status: 'stale' } | { status: 'failed'; reason: StylizeStatus | null };

interface ModelTakeRequest {
  direction: DirectionId;
  /** The custom direction's words. */
  text: string;
  dialect: StylizeDialect;
  cfg: DialectConfig;
  run: RunStylize;
}

/** Local render width matching the largest export preset. */
const PROC_RENDER_PX = 2400;

/** The long side the studio's original is captured at where no provider sets one. */
const ORIGINAL_CAPTURE_PX = 2048;

/** The long side, in px, the studio captures the map's own picture at: what the connected provider
 *  takes, so the comparison shows what a take is drawn from. */
export const originalCaptureEdge = (dialect: StylizeDialect | null): number => dialect?.maxEdge ?? ORIGINAL_CAPTURE_PX;

function loadDataUrl(url: string): Promise<HTMLImageElement> {
  return loadImage(url).catch(() => { throw new StylizeError('bad_response'); });
}

/** One studio session's jobs; its check worker lives until `dispose`. */
export class StylizeStudioJobs {
  private readonly lease = new ReviewWorkerLease();

  dispose(): void {
    this.lease.dispose();
  }

  /** A provider take. A kept take of the same direction is the style reference, else the pack's
   *  sample or swatch; custom words pass the local text check before they go to the provider. */
  async generateModel(request: ModelTakeRequest, signal: AbortSignal): Promise<TakeOutcome> {
    const gridState = useEditorStore.getState().gridState;
    const { direction: dir, dialect, cfg, text } = request;
    const custom = dir === CUSTOM_DIRECTION_ID;
    const pack = STYLE_PACKS.find((p) => p.id === dir) ?? null;
    const shelf = versionStore.getState();
    const kept = shelf.selectedId ? shelf.versions.find((v) => v.id === shelf.selectedId) : null;
    const keptSrc = kept && kept.direction === dir ? versionSrc(kept) : null;
    // A pack take with no kept take to follow is anchored on the pack's sample, else its swatch.
    const packAnchor = pack ? packSampleUrl(pack.id) ?? packSwatchUrl(pack.id) : null;
    const styleRef = keptSrc
      ? { url: keptSrc, kind: 'take' as const }
      : packAnchor
        ? { url: packAnchor, kind: 'pack' as const }
        : null;
    versionStore.setRunning(true);
    // Record the mapEdit before capture so concurrent map edits make the result stale.
    const mapEdit = versionStore.currentMapEdit();
    try {
      if (!gridState) throw new StylizeError('bad_response');
      // Custom preferences are user text bound for a provider; the local content check runs first and refuses on its own.
      if (custom && text.trim()) {
        let verdict;
        try {
          verdict = await reviewText([{ field: 'description', text: text.trim().slice(0, CUSTOM_PROMPT_MAX) }], signal, () => {}, this.lease);
        } catch (err) {
          if (isAbortError(err)) throw err;
          throw new StylizeError('unchecked');
        }
        if (!verdict.allowed) throw new StylizeError('inappropriate');
      }
      const { image } = await request.run(
        {
          captureMap: () => host.capture2dImage({ maxPx: dialect.maxEdge, annotations: false }),
          state: gridState,
          dialect,
          cfg,
          pack,
          ...(styleRef ? { styleRef } : {}),
        },
        dir,
        custom ? text : undefined,
        resolveRecipe(dialect),
        signal,
      );
      const minted = versionStore.mint({ kind: 'model', direction: dir, ...(custom ? { prompt: text } : {}), image, mapEdit });
      saveStylizeSettings({ ...loadStylizeSettings(), direction: dir, customPrompt: text });
      return minted ? { status: 'kept' } : { status: 'stale' };
    } catch (err: unknown) {
      return { status: 'failed', reason: toStylizeStatus(err) };
    } finally {
      versionStore.setRunning(false);
    }
  }

  /** A local procedural or neural pack take, needing no provider. Each take of a pack rolls the
   *  next seed from the shelf, so concurrent requests receive distinct seeds. `remembered` is the
   *  direction the window stores as the next one. */
  async generateProc(packId: string, remembered: StylizeDirection, renderer: typeof loadProcRenderer = loadProcRenderer): Promise<TakeOutcome> {
    versionStore.setRunning(true);
    const mapEdit = versionStore.currentMapEdit();
    try {
      const gridState = useEditorStore.getState().gridState;
      if (!gridState) throw new StylizeError('bad_response');
      // Yield once so the running card paints before synchronous rendering starts.
      const [{ renderProcPackAsync, takeSeed }] = await Promise.all([
        renderer(),
        new Promise((resolve) => setTimeout(resolve, 30)),
      ]);
      const roll = versionStore.getState().versions.reduce(
        (m, v) => (v.direction === packId && v.roll !== undefined ? Math.max(m, v.roll + 1) : m), 0);
      // Headless callers fall back to the renderer's field-based source.
      const shot = host.capture2d({ maxPx: PROC_RENDER_PX, annotations: false });
      const sourceImage = shot ?? undefined;
      const canvas = await renderProcPackAsync({
        state: gridState, packId, maxPx: PROC_RENDER_PX, seed: takeSeed(gridState, roll, (s) => canonicalBytes(canonicalize(s))),
        locale: useEditorStore.getState().locale,
        ...(sourceImage ? { sourceImage } : {}),
      });
      if (!canvas) throw new StylizeError('bad_response');
      const image = await loadDataUrl(canvas.toDataURL('image/png'));
      // Neural output carries the AI disclosure; non-neural procedural output does not.
      const minted = versionStore.mint({ kind: procPackMeta(packId)?.neural ? 'model' : 'proc', direction: packId as StylizeDirection, image, mapEdit, roll });
      saveStylizeSettings({ ...loadStylizeSettings(), direction: remembered });
      return minted ? { status: 'kept' } : { status: 'stale' };
    } catch (err: unknown) {
      return { status: 'failed', reason: toStylizeStatus(err, 'device') };
    } finally {
      versionStore.setRunning(false);
    }
  }
}

/** The directions the studio offers, in the booklet's order: the local packs, those an on-device
 *  model draws only where the engine can run them (taken as so until its probe has answered), then
 *  the provider packs and the user's own words. */
export function offeredDirections(): StylizeDirection[] {
  const neural = neuralPacksUsableNow() ?? true;
  return [
    ...PROC_PACK_META.filter((pack) => neural || !pack.neural).map((pack) => pack.id),
    ...STYLE_PACKS.map((pack) => pack.id),
    CUSTOM_DIRECTION_ID,
  ];
}

/** The studio's stored direction and custom words, read once as it opens; a stored direction the
 *  studio no longer offers gives way to the first it does. */
export function storedStylizeInputs(): Pick<StylizeSettings, 'direction' | 'customPrompt'> {
  const { direction, customPrompt } = loadStylizeSettings();
  const offered = offeredDirections();
  return { direction: offered.includes(direction) ? direction : offered[0]!, customPrompt };
}

/* ── The provider connection ─────────────────────────────── */

/** The model-list request, injectable so a test drives the form without a network. `null` is an
 *  endpoint that will not enumerate. */
export type StylizeListModels = (
  dialect: StylizeDialect, cfg: DialectConfig, signal: AbortSignal,
) => Promise<string[] | null>;

export const defaultListModels: StylizeListModels = (dialect, cfg, signal) => dialect.listModels(cfg, signal);

/** The provider's row, or the first provider for an id this build no longer offers. */
function providerRow(id: StylizeProvider['id']): StylizeProvider {
  return STYLIZE_PROVIDERS.find((p) => p.id === id) ?? STYLIZE_PROVIDERS[0]!;
}

/** What a connection draft talks to: the provider's dialect and the request settings, with the
 *  provider's own address unless it asks for one. */
export function connectionTarget(provider: StylizeProvider['id'], draft: { key: string; baseUrl: string; model: string }) {
  const row = providerRow(provider);
  const baseUrl = row.needsBaseUrl ? sanitizeEndpointUrl(draft.baseUrl) : row.baseUrl;
  return { row, baseUrl, dialect: DIALECTS[row.dialect], cfg: { key: draft.key, baseUrl, model: draft.model } satisfies DialectConfig };
}

/** The stored connection: its provider, address and model, and the key the vault opens, if any. */
export async function readStylizeConnection(): Promise<{ provider: StylizeProvider['id']; baseUrl: string; model: string; key: string | null }> {
  const stored = loadStylizeSettings();
  const key = await loadStylizeKey();
  return { provider: stored.provider, baseUrl: stored.customBaseUrl, model: stored.model, key };
}

/** The status slot's word for a refused request, or null for a cancellation. */
export const connectionStatus = (err: unknown): StylizeStatus | null => toStylizeStatus(err);

/** Tests the connection with the model-list request and, on success, files it: the settings written
 *  and the key sealed. Where the endpoint will not enumerate, the typed model stands and the first
 *  generation is the test. Throws what the provider refused. */
export async function fileStylizeConnection(
  connection: { provider: StylizeProvider['id']; model: string; baseUrl: string; key: string },
  dialect: StylizeDialect, cfg: DialectConfig, listModels: StylizeListModels, signal: AbortSignal,
): Promise<void> {
  await listModels(dialect, cfg, signal);
  saveStylizeSettings({ ...loadStylizeSettings(), provider: connection.provider, model: connection.model, customBaseUrl: connection.baseUrl });
  await saveStylizeKey(connection.key);
}
