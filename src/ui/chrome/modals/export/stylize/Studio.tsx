/* Illustration workspace. Takes remain in memory for the current map state, and only the Generate
 * action is disabled while a job is running. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../../../../../i18n/context';
import { host } from '../../../../../editor/host/host';
import type { GridState } from '../../../../../core/model/types';
import { renderThumbnail } from '../../../../../view/map2d/capture/thumbnail';
import { CUSTOM_DIRECTION_ID, STYLE_PACKS, isProcPackId, type StylizeDirection } from '../../../../../pipelines/stylize/facts';
import {
  StylizeStudioJobs, loadProcRenderer, retainNeuralRuntime, runEngine, storedStylizeInputs,
  type DialectConfig, type RunStylize, type StylizeDialect, type TakeOutcome,
} from '../../../../../editor/export/stylize';
import { versionStore, versionSrc } from '../../../../../state/stylize-versions';
import { packSampleUrl, packSwatchUrl } from './sample-assets';
import { useStylizeVersions } from './use-stylize-versions';
import { GearGlyph, GhostVerb, IconVerb, PrimaryVerb, StatusSlot, WindowFoot, type SlotStatus } from './stylize-parts';
import { DirectionBooklet, directionRow } from './DirectionBooklet';
import { DirectionPane } from './DirectionPane';
import { StudioCanvas, type Picture } from './StudioCanvas';
import { VersionShelf } from './VersionShelf';
import { scrollBleed } from '../../../../primitives/use-scroll-row';
import { WindowBody } from '../../../../primitives/Window';
import { STACKED_PREVIEW_HEIGHT, TWO_COLUMNS_FROM, useWindowColumns } from '../../use-window-columns';

/** The room, in css px, the body holds at each side for the bleed its rows reach outside their boxes
 *  (`DirectionBooklet`, `VersionShelf`), handed back through its margin; a row reaching past it is cut. */
const BODY_BLEED = 8;

/** In one column the picture keeps the stacked preview height and its versions stand under it, the
 *  direction stands below at its full height, and the body is the one scroller; the footer stays fixed. */
const stackedPicture: CSSProperties = { display: 'grid', gridTemplateRows: `${STACKED_PREVIEW_HEIGHT}px auto`, gap: 10, minHeight: 0 };
const stackedControls: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'max-content max-content', gap: 10, minHeight: 0 };

export type { RunStylize };

interface StudioProps {
  /** Provider connection; local directions do not require one. */
  dialect: StylizeDialect | null;
  cfg: DialectConfig | null;
  connected: boolean;
  onSettings: () => void;
  onDone: () => void;
  run?: RunStylize;
  captureOriginal?: () => string | null;
  /** The map the original is drawn from where it is not the live one (a Help figure's); absent, the
   *  live map's view is captured. */
  subject?: GridState;
  /** Injectable local renderer module. */
  procRenderer?: typeof loadProcRenderer;
}

export function Studio({
  dialect, cfg, connected, onSettings, onDone, run = runEngine, captureOriginal, subject, procRenderer = loadProcRenderer,
}: StudioProps) {
  const t = useT();
  const [jobs] = useState(() => new StylizeStudioJobs());
  useEffect(() => () => jobs.dispose(), [jobs]);
  const { state } = useStylizeVersions();
  // Load persisted inputs once; edits in this page own their live values afterward.
  const [settings] = useState(storedStylizeInputs);
  const [direction, setDirection] = useState<StylizeDirection>(settings.direction);
  const [text, setText] = useState(settings.customPrompt);
  const [status, setStatus] = useState<SlotStatus | null>(null);
  const [tried, setTried] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [columns, bodyRef] = useWindowColumns(TWO_COLUMNS_FROM);
  const abortRef = useRef<AbortController | null>(null);

  // Capture the original once so comparison stays fixed throughout this studio session.
  const maxPx = dialect?.maxEdge ?? 2048;
  const capture = captureOriginal ?? (() => (subject ? null : host.capture2dImage({ maxPx, annotations: false })));
  const [originalSrc, setOriginalSrc] = useState(capture);
  // A map that is not the live one is drawn off the stage by the live renderer, without its notes.
  const [subjectShot] = useState(() => (subject && !captureOriginal ? renderThumbnail(subject, maxPx, { notes: null }) : null));
  useEffect(() => {
    if (!subjectShot) return undefined;
    let live = true;
    void subjectShot.then((png) => { if (live) setOriginalSrc(png); });
    return () => { live = false; };
  }, [subjectShot]);

  // Closing the window cancels its active generation.
  useEffect(retainNeuralRuntime, []);
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

  /** A finished take's word in the status slot; a kept or stale take shows the front picture again. */
  const settle = (outcome: TakeOutcome) => {
    if (outcome.status === 'failed') { setStatus(outcome.reason); return; }
    if (outcome.status === 'stale') setStatus('map_changed');
    setSwapped(false);
  };

  const generate = async () => {
    if (state.running) return;
    const dir = direction;
    if (isProcPackId(dir)) {
      setStatus(null);
      settle(await jobs.generateProc(dir, direction, procRenderer));
      return;
    }
    if (!dialect || !cfg) {
      onSettings();
      return;
    }
    const pack = STYLE_PACKS.find((p) => p.id === dir) ?? null;
    setStatus(null);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      settle(await jobs.generateModel({
        direction: dir, text, dialect, cfg, run, packAnchor: pack ? packSampleUrl(pack.id) ?? packSwatchUrl(pack.id) : null,
      }, abort.signal));
    } finally {
      abortRef.current = null;
    }
  };

  const controls = (
    <div key="controls" style={columns === 2 ? { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 } : stackedControls}>
      <DirectionBooklet value={direction} onPick={setDirection} enterIndex={0} scrolls={columns === 2} />
      <DirectionPane direction={direction} text={text} onText={setText} connected={connected} onConnect={onSettings} enterIndex={1} />
    </div>
  );
  const picture = (
    <div key="picture" style={columns === 2 ? { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 } : stackedPicture}>
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
  );

  return (
    <>
      {/* The measured box holds the card's width in both arrangements. In one column the picture and
          its versions stand above the direction in the window's body. */}
      <div ref={bodyRef} data-columns={columns} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 8 }}>
        {columns === 2 ? (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gap: 16, gridTemplateColumns: '250px 1fr',
            ...scrollBleed({ top: 0, right: BODY_BLEED, bottom: 0, left: BODY_BLEED }) }}>
            {controls}{picture}
          </div>
        ) : (
          <WindowBody bleed={BODY_BLEED}
            contentStyle={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'max-content max-content', alignContent: 'start' }}>
            {picture}{controls}
          </WindowBody>
        )}
      </div>

      <WindowFoot>
        <IconVerb label={t('stylize.back_settings')} onClick={onSettings}>
          <GearGlyph />
        </IconVerb>
        {/* The shelf card displays generation progress. */}
        <StatusSlot status={status} />
        <GhostVerb onClick={onDone}>{t('stylize.done_btn')}</GhostVerb>
        <PrimaryVerb
          disabled={state.running || (!connected && !isProcPackId(direction))}
          onClick={() => { void generate(); }}
        >
          {t('stylize.generate')}
        </PrimaryVerb>
      </WindowFoot>
    </>
  );
}
