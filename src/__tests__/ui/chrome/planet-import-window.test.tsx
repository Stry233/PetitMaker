/**
 * Import planet's window: it asks how to import, routes a planet file to Change Planet's picker and
 * a game video through the guide, the reading and its stages, Cancel, and each refusal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { PlanetImportWindow } from '../../../ui/chrome/modals/planet/PlanetImportWindow';
import { FAILURE_COPY } from '../../../ui/chrome/modals/planet/VideoImportGuide';
import { STAGE_COPY } from '../../../ui/chrome/modals/planet/VideoImportProgress';
import { translations } from '../../../i18n/translations';
import { SCAN_FAILURES } from '../../../io/planet-scan/errors';
import { VideoImportError, type ImportFailure, type ScanVideo, type ScanVideoOptions } from '../../../io/planet-scan/import-video';
import type { ScanOutcome } from '../../../io/planet-scan/run';
import type { ScanPreview } from '../../../io/planet-scan/preview';
import { seconds } from '../../../ui/design/motion';
import { planetFixture } from '../../fixtures/planet';
import { ChangePlanetModal } from '../../../ui/chrome/modals/ChangePlanetModal';
import { newMap } from '../../../kit/operations/map';
import { setStoreState } from '../../_store';

const t = (key: string) => translate(key);

/** How long the planet read takes to appear in the picture, in ms. */
const FINISH_MS = seconds('scan.preview.finish') * 1000;
const PREVIEW: ScanPreview = { kind: 'coverage', x: 0, y: 0, unitW: 16, unitH: 16, cols: 2, rows: 1, classes: new Uint8Array([0b1101]), view: { x: 0, y: 0, w: 32, h: 16 } };

const OUTCOME: ScanOutcome = { template: planetFixture(), rimSand: [], review: [3, 4], landmark: { detected: false }, coverage: 1, partial: false };

/** A scripted scan: each call parks until the test settles it, and records its options. */
function scripted() {
  const calls: { options: ScanVideoOptions; resolve: (o: ScanOutcome) => void; reject: (e: unknown) => void }[] = [];
  const scan: ScanVideo = (_file, options) => new Promise((resolve, reject) => {
    calls.push({ options, resolve, reject });
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  });
  return { scan, calls };
}

function mount(props: Partial<Parameters<typeof PlanetImportWindow>[0]> = {}, reduced = false) {
  const onClose = vi.fn();
  const onScanned = vi.fn((_: ScanOutcome) => true);
  const onPickFile = vi.fn();
  const utils = render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider>
        <PlanetImportWindow open onClose={onClose} onScanned={onScanned} onPickFile={onPickFile} canEdit {...props} />
      </I18nProvider>
    </MotionConfig>,
  );
  return { ...utils, onClose, onScanned, onPickFile };
}

const video = () => new File([new Uint8Array(16)], 'scan.mp4', { type: 'video/mp4' });
const choose = (file = video()) => fireEvent.change(screen.getByTestId('scan-file'), { target: { files: [file] } });

beforeEach(() => { setStoreState({ locale: 'en' }); useEditorStore.getState().setModal('planetImport', true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Import planet window', () => {
  it('asks how to import, and From a planet file opens the planet file picker', () => {
    const { onPickFile, onClose } = mount();
    expect(screen.getByTestId('planet-import-file').textContent).toContain(t('planet.import_file'));
    expect(screen.getByTestId('planet-import-video').textContent).toContain(t('planet.import_video'));
    expect(screen.getByTestId('planet-import-video-tag').textContent).toBe(t('app.beta'));
    expect(screen.queryByTestId('planet-import-file-tag')).toBeNull();
    fireEvent.click(screen.getByTestId('planet-import-file'));
    expect(onClose).toHaveBeenCalled();
    expect(onPickFile).toHaveBeenCalled();
  });

  it('From a game video opens the guide with the protocol and a muted, looping example', async () => {
    mount();
    fireEvent.click(screen.getByTestId('planet-import-video'));
    const steps = await screen.findByTestId('scan-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(6);
    expect(steps.textContent).toContain(t('planet.scan_step_region'));
    expect(steps.querySelector('li')!.textContent).toBe(t('planet.scan_step_window'));
    expect(screen.getByTestId('planet-import-beta').textContent).toBe(t('app.beta'));
    const example = screen.getByTestId('scan-example-video') as HTMLVideoElement;
    expect(example.muted).toBe(true);
    expect(example.loop).toBe(true);
    expect(example.autoplay).toBe(true);
    expect(example.getAttribute('poster')).toBeTruthy();
    expect(example.querySelectorAll('source')).toHaveLength(2);
    expect(screen.queryByTestId('scan-example-play')).toBeNull();
  });

  it('rests the example on its poster under reduced motion and plays it when asked', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    mount({}, true);
    fireEvent.click(screen.getByTestId('planet-import-video'));
    const example = await screen.findByTestId('scan-example-video') as HTMLVideoElement;
    expect(example.autoplay).toBe(false);
    expect(example.getAttribute('preload')).toBe('none');
    fireEvent.click(screen.getByTestId('scan-example-play'));
    expect(play).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('scan-example-play')).toBeNull());
  });

  it('waits for the planet editor before it offers the video import', () => {
    mount({ canEdit: false });
    expect((screen.getByTestId('planet-import-video') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the stages as the reading goes, and hands the planet to the editor', async () => {
    const { scan, calls } = scripted();
    const { onScanned, onClose } = mount({ scan });
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    const stage = (s: string) => screen.getByTestId(`scan-stage-${s}`).getAttribute('data-state');
    expect([stage('reading'), stage('tracking'), stage('ground')]).toEqual(['active', 'pending', 'pending']);
    expect(screen.getByTestId('scan-picture')).toBeTruthy();
    act(() => calls[0]!.options.onProgress!({ stage: 'reading', share: 0.5, preview: PREVIEW }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    act(() => calls[0]!.options.onProgress!({ stage: 'tracking', share: null }));
    expect([stage('reading'), stage('tracking'), stage('ground')]).toEqual(['done', 'active', 'pending']);
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => calls[0]!.options.onProgress!({ stage: 'ground', share: 0.25, preview: { ...PREVIEW, kind: 'ground', chunk: 16 } }));
    expect([stage('reading'), stage('tracking'), stage('ground')]).toEqual(['done', 'done', 'active']);
    // The planet read stands in the picture for a moment, then opens.
    await act(async () => { calls[0]!.resolve(OUTCOME); });
    expect(screen.getByTestId('scan-finished')).toBeTruthy();
    expect([stage('reading'), stage('tracking'), stage('ground')]).toEqual(['done', 'done', 'done']);
    expect(onScanned).not.toHaveBeenCalled();
    await waitFor(() => expect(onScanned).toHaveBeenCalledWith(OUTCOME), { timeout: 2 * FINISH_MS + 1000 });
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the planet read at once under reduced motion', async () => {
    const { scan, calls } = scripted();
    const { onScanned } = mount({ scan }, true);
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    await act(async () => { calls[0]!.resolve(OUTCOME); });
    expect(onScanned).toHaveBeenCalledWith(OUTCOME);
  });

  it('keeps the planet read from opening when Cancel is pressed while it stands', async () => {
    const { scan, calls } = scripted();
    const { onScanned } = mount({ scan });
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    await act(async () => { calls[0]!.resolve(OUTCOME); });
    fireEvent.click(screen.getByTestId('planet-import-cancel'));
    await screen.findByTestId('scan-file');
    await new Promise((r) => setTimeout(r, 2 * FINISH_MS + 100));
    expect(onScanned).not.toHaveBeenCalled();
  });

  it.each(Object.keys(FAILURE_COPY) as ImportFailure[])('brings the guide back with the reason for %s', async (reason) => {
    const { scan, calls } = scripted();
    const { onScanned } = mount({ scan });
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    await act(async () => { calls[0]!.reject(new VideoImportError(reason)); });
    const shown = await screen.findByTestId('scan-failure');
    expect(shown.textContent).toBe(t(FAILURE_COPY[reason]));
    expect(screen.getByTestId('scan-steps')).toBeTruthy();
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('cancels the reading, and a second video reads afresh', async () => {
    const { scan, calls } = scripted();
    const { onScanned } = mount({ scan });
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    fireEvent.click(screen.getByTestId('planet-import-cancel'));
    expect(calls[0]!.options.signal.aborted).toBe(true);
    await screen.findByTestId('scan-file');
    expect(screen.queryByTestId('scan-failure')).toBeNull();
    choose();
    await screen.findByTestId('scan-progress');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.options.signal.aborted).toBe(false);
    await act(async () => { calls[1]!.resolve(OUTCOME); });
    await waitFor(() => expect(onScanned).toHaveBeenCalledTimes(1), { timeout: 2 * FINISH_MS + 1000 });
  });

  it('cancels a reading when the window closes', async () => {
    const { scan, calls } = scripted();
    const { onClose } = mount({ scan });
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]!.options.signal.aborted).toBe(true);
  });
});

describe('a planet the editor cannot open yet', () => {
  it('keeps the planet with the reason and opens it on a second try', async () => {
    const { scan, calls } = scripted();
    let allowed = false;
    const onScanned = vi.fn(() => allowed);
    const onClose = vi.fn();
    render(<I18nProvider><PlanetImportWindow open onClose={onClose} onScanned={onScanned} canEdit scan={scan} /></I18nProvider>);
    fireEvent.click(screen.getByTestId('planet-import-video'));
    await screen.findByTestId('scan-file');
    choose();
    await screen.findByTestId('scan-progress');
    await act(async () => { calls[0]!.resolve(OUTCOME); });
    expect((await screen.findByTestId('scan-open-failed')).textContent).toBe(t('planet.scan_open_failed'));
    expect(onClose).not.toHaveBeenCalled();
    allowed = true;
    fireEvent.click(screen.getByTestId('planet-import-retry'));
    expect(onScanned).toHaveBeenCalledTimes(2);
    expect(onScanned).toHaveBeenLastCalledWith(OUTCOME);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Change Planet', () => {
  it('opens Import planet as its own window, and From a planet file reaches the planet file picker', async () => {
    newMap('hexia');
    act(() => { useEditorStore.getState().setModal('planetImport', false); });
    render(<I18nProvider><ChangePlanetModal onSwitch={() => {}} onClose={() => {}} onEditPlanet={() => {}} /></I18nProvider>);
    const input = screen.getByTestId('planet-file') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByTestId('planet-import'));
    expect(useEditorStore.getState().modals.planetImport).toBe(true);
    fireEvent.click(await screen.findByTestId('planet-import-file'));
    expect(click).toHaveBeenCalled();
    expect(useEditorStore.getState().modals.planetImport).toBe(false);
  });
});

describe('the video import\'s copy', () => {
  it('names a refusal for every scan failure and defines each refusal and stage in every locale', () => {
    for (const reason of SCAN_FAILURES) expect(FAILURE_COPY[reason]).toBeTruthy();
    const keys = [...Object.values(FAILURE_COPY), ...Object.values(STAGE_COPY), 'planet.scan_stage_reading_again'];
    for (const [locale, table] of Object.entries(translations)) for (const key of keys) expect(table[key], `${locale} ${key}`).toBeTruthy();
  });
});
