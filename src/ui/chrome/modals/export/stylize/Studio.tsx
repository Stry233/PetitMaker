/* Illustration workspace. Takes remain in memory for the current map state, and only the Generate
 * action is disabled while a job is running. */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { host } from '../../../../../kit/host';
import {
  CUSTOM_DIRECTION_ID,
  STYLE_PACKS,
  StylizeError,
  isProcPackId,
  procPackMeta,
  loadProcRenderer,
  loadStylizeSettings,
  resolveRecipe,
  runEngine,
  saveStylizeSettings,
  versionStore,
  type DialectConfig,
  type DirectionId,
  type EngineDeps,
  type Recipe,
  type StylizeDialect,
  type StylizeDirection,
  type StylizeStatus,
} from '../../../../../io/stylize';
import { packSampleUrl, packSwatchUrl } from './sample-assets';
import { useStylizeVersions } from './use-stylize-versions';
import { GearGlyph, GhostVerb, IconVerb, PrimaryVerb, StatusSlot, WindowFoot, type SlotStatus } from './atoms';
import { DirectionBooklet, directionRow } from './DirectionBooklet';
import { DirectionPane } from './DirectionPane';
import { StudioCanvas, type Picture } from './StudioCanvas';
import { VersionShelf, versionSrc } from './VersionShelf';

/** Injectable provider-backed generation runner. */
export type RunStylize = (
  deps: EngineDeps,
  direction: DirectionId,
  customText: string | undefined,
  recipe: Recipe,
  signal?: AbortSignal,
) => Promise<{ image: HTMLImageElement }>;

export interface StudioProps {
  /** Provider connection; local directions do not require one. */
  dialect: StylizeDialect | null;
  cfg: DialectConfig | null;
  connected: boolean;
  onSettings: () => void;
  onDone: () => void;
  run?: RunStylize;
  captureOriginal?: () => string | null;
  /** Injectable local renderer module. */
  procRenderer?: typeof loadProcRenderer;
}

/** Local render width matching the largest export preset. */
const PROC_RENDER_PX = 2400;

function statusOf(err: unknown): StylizeStatus {
  return err instanceof StylizeError ? err.status : 'network';
}

function loadDataUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new StylizeError('bad_response'));
    img.src = url;
  });
}

export function Studio({ dialect, cfg, connected, onSettings, onDone, run = runEngine, captureOriginal, procRenderer = loadProcRenderer }: StudioProps) {
  const t = useT();
  const { state } = useStylizeVersions();
  // Load persisted inputs once; edits in this page own their live values afterward.
  const [settings] = useState(loadStylizeSettings);
  const [direction, setDirection] = useState<StylizeDirection>(settings.direction);
  const [text, setText] = useState(settings.customPrompt);
  const [status, setStatus] = useState<SlotStatus | null>(null);
  const [tried, setTried] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Capture the original once so comparison stays fixed throughout this studio session.
  const capture = captureOriginal ?? (() => host.capture2d(dialect?.maxEdge ?? 2048, false, false));
  const [originalSrc] = useState(capture);

  // Closing the window cancels its active generation.
  useEffect(() => () => abortRef.current?.abort(), []);

  const original: Picture = { key: 'original', src: originalSrc, label: t('stylize.original') };
  const pictureOf = (id: string): Picture | null => {
    const version = state.versions.find((v) => v.id === id);
    if (!version) return null;
    return { key: version.id, src: versionSrc(version), label: t('stylize.version_label', { n: version.no }) };
  };

  const selected = state.selectedId ? pictureOf(state.selectedId) : null;
  const kept = selected ?? original;
  const corner = selected ? (swapped ? selected : original) : null;
  const front = swapped && selected ? original : kept;
  const triedPicture = tried === null ? null : tried === 'original' ? original : pictureOf(tried);
  const main = triedPicture ?? front;

  /** Selecting a custom take restores the prompt that produced it. */
  const pick = (id: string | null) => {
    versionStore.select(id);
    setSwapped(false);
    const version = id ? state.versions.find((v) => v.id === id) : null;
    if (version?.direction === CUSTOM_DIRECTION_ID && version.prompt !== undefined) {
      setDirection(CUSTOM_DIRECTION_ID);
      setText(version.prompt);
    }
  };

  const generate = async () => {
    if (state.running) return;
    const gridState = useEditorStore.getState().gridState;
    const dir = direction;
    if (isProcPackId(dir)) {
      await generateProc(dir);
      return;
    }
    if (!dialect || !cfg) {
      onSettings();
      return;
    }
    const custom = dir === CUSTOM_DIRECTION_ID;
    const pack = STYLE_PACKS.find((p) => p.id === dir) ?? null;
    // Prefer a retained take of the same direction as the style reference, then the pack sample.
    const kept = state.selectedId ? state.versions.find((v) => v.id === state.selectedId) : null;
    const keptSrc = kept && kept.direction === dir ? versionSrc(kept) : null;
    const packAnchor = pack ? packSampleUrl(pack.id) ?? packSwatchUrl(pack.id) : null;
    const styleRef = keptSrc
      ? { url: keptSrc, kind: 'take' as const }
      : packAnchor
        ? { url: packAnchor, kind: 'pack' as const }
        : null;
    setStatus(null);
    versionStore.setRunning(true);
    const abort = new AbortController();
    abortRef.current = abort;
    // Record the fingerprint before capture so concurrent map edits make the result stale.
    const fingerprint = versionStore.currentFingerprint();
    try {
      if (!gridState) throw new StylizeError('bad_response');
      const { image } = await run(
        {
          captureMap: () => host.capture2d(dialect.maxEdge, false, false),
          state: gridState,
          dialect,
          cfg,
          pack,
          ...(styleRef ? { styleRef } : {}),
        },
        dir,
        custom ? text : undefined,
        resolveRecipe(dialect),
        abort.signal,
      );
      const minted = versionStore.mint({
        kind: 'model',
        direction: dir,
        ...(custom ? { prompt: text } : {}),
        image,
        fingerprint,
      });
      if (!minted) setStatus('map_changed');
      setSwapped(false);
      saveStylizeSettings({ ...loadStylizeSettings(), direction: dir, customPrompt: text });
    } catch (err: unknown) {
      setStatus(statusOf(err));
    } finally {
      abortRef.current = null;
      versionStore.setRunning(false);
    }
  };

  /** Generate a local procedural or neural pack without a provider connection. */
  const generateProc = async (packId: string) => {
    setStatus(null);
    versionStore.setRunning(true);
    const fingerprint = versionStore.currentFingerprint();
    try {
      const gridState = useEditorStore.getState().gridState;
      if (!gridState) throw new StylizeError('bad_response');
      // Yield once so the running card paints before synchronous rendering starts.
      const [{ renderProcPackAsync, takeSeed }] = await Promise.all([
        procRenderer(),
        new Promise((resolve) => setTimeout(resolve, 30)),
      ]);
      // Derive the next variation from live shelf state so concurrent requests receive distinct seeds.
      const roll = versionStore.getState().versions.reduce(
        (m, v) => (v.direction === packId && v.roll !== undefined ? Math.max(m, v.roll + 1) : m), 0);
      // Headless callers fall back to the renderer's field-based source.
      const shot = host.capture2d(PROC_RENDER_PX, false, false);
      const sourceImage = shot ? await loadDataUrl(shot) : undefined;
      const canvas = await renderProcPackAsync({
        state: gridState, packId, maxPx: PROC_RENDER_PX, seed: takeSeed(gridState, roll),
        locale: useEditorStore.getState().locale,
        ...(sourceImage ? { sourceImage } : {}),
      });
      if (!canvas) throw new StylizeError('bad_response');
      const image = await loadDataUrl(canvas.toDataURL('image/png'));
      // Neural output carries the AI disclosure; non-neural procedural output does not.
      const minted = versionStore.mint({ kind: procPackMeta(packId)?.neural ? 'model' : 'proc', direction: packId as StylizeDirection, image, fingerprint, roll });
      if (!minted) setStatus('map_changed');
      setSwapped(false);
      saveStylizeSettings({ ...loadStylizeSettings(), direction });
    } catch (err: unknown) {
      setStatus(statusOf(err));
    } finally {
      versionStore.setRunning(false);
    }
  };

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, paddingTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <DirectionBooklet value={direction} onPick={setDirection} enterIndex={0} />
          <DirectionPane direction={direction} text={text} onText={setText} connected={connected} onConnect={onSettings} enterIndex={1} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <StudioCanvas main={main} corner={corner} onSwap={() => setSwapped((s) => !s)} enterIndex={2} />
          <VersionShelf
            versions={state.versions}
            selectedId={state.selectedId}
            running={state.running}
            runningBand={directionRow(direction).band}
            originalSrc={originalSrc}
            onTry={setTried}
            onPick={pick}
            onRetire={(id) => { versionStore.retire(id); setSwapped(false); }}
            enterIndex={3}
          />
        </div>
      </div>

      <WindowFoot>
        <IconVerb label={t('stylize.back_settings')} onClick={onSettings}>
          <GearGlyph />
        </IconVerb>
        {/* The shelf card displays generation progress. */}
        <StatusSlot status={status} />
        <PrimaryVerb
          disabled={state.running || (!connected && !isProcPackId(direction))}
          onClick={() => { void generate(); }}
        >
          {t('stylize.generate')}
        </PrimaryVerb>
        <GhostVerb onClick={onDone}>{t('stylize.done_btn')}</GhostVerb>
      </WindowFoot>
    </>
  );
}
