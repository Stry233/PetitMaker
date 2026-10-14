// @vitest-environment jsdom
/**
 * A planet file or a game video brought to a map import surface (the page-level drop, Import map's
 * drop zone and picker) gets a card saying what it is, and going on opens Change Planet with the
 * file handed over: a planet file is read as From a planet file reads one, a video starts reading
 * in Import planet's window. Import planet's window takes drops anywhere and sends a map file back
 * the same way.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider, translate } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { setToastPresenter } from '../../../../../platform/channels/toast-bus';
import { newMap } from '../../../../../editor/operations/map';
import { editorPort } from '../../../../../editor/session/context';
import { writePlanetFile } from '../../../../../io/save/planet-codec';
import { listPlanets } from '../../../../../io/storage/planet-library';
import { serialize } from '../../../../../io/save/json-codec';
import type { ScanOutcome } from '../../../../../pipelines/planet-scan/run';
import { DropImportOverlay } from '../../../../../ui/chrome/modals/import/DropImportOverlay';
import { ImportModal } from '../../../../../ui/chrome/modals/import/ImportModal';
import { ChangePlanetModal } from '../../../../../ui/chrome/modals/planet/ChangePlanetModal';
import { planetFixture } from '../../../../_support/planet';
import type { TextKey } from '../../../../../i18n/keys';

const scanCalls: File[] = [];
vi.mock('../../../../../pipelines/planet-scan/import-video', async (actual) => ({
  ...(await actual<typeof import('../../../../../pipelines/planet-scan/import-video')>()),
  scanVideo: (file: File) => { scanCalls.push(file); return new Promise<ScanOutcome>(() => {}); },
}));

const inspectSpy = vi.fn();
vi.mock('../../../../../io/import/file', async (actual) => {
  const real = await actual<typeof import('../../../../../io/import/file')>();
  return {
    ...real,
    inspectImportFile: (...args: Parameters<typeof real.inspectImportFile>) => { inspectSpy(...args); return real.inspectImportFile(...args); },
  };
});

const t = (key: TextKey, params?: Record<string, string | number>) => translate(key, params);
const PLANET = planetFixture();
/** A jsdom File that also reads as text, as a browser's does. */
const textFile = (text: string, name: string, type = '') => Object.assign(new File([text], name, { type }), { text: async () => text });
const planetFile = () => textFile(writePlanetFile('Bay', PLANET), 'Bay.planet.json', 'application/json');
const videoFile = () => new File([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])], 'scan.mp4', { type: 'video/mp4' });
const mapFile = () => {
  const state = useEditorStore.getState().gridState!;
  return textFile(serialize(state), 'garden.json', 'application/json');
};

function Host() {
  const open = useEditorStore((s) => s.modals.newProject);
  const setModal = useEditorStore((s) => s.setModal);
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <DropImportOverlay />
        <ImportModal />
        <ChangePlanetModal open={open} takesHandedFiles onSwitch={() => {}} onClose={() => setModal('newProject', false)} onEditPlanet={() => {}} />
      </I18nProvider>
    </MotionConfig>
  );
}

function dropOnWindow(file: File) {
  const e = (type: string) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files: [file] } });
  act(() => { window.dispatchEvent(e('dragenter')); window.dispatchEvent(e('drop')); });
}

const modals = () => useEditorStore.getState().modals;

// Change Planet loads Import planet's window lazily; loading it once up front keeps the first video
// case from spending its query budget on the module transform.
beforeAll(async () => { await import('../../../../../ui/chrome/modals/planet/PlanetImportWindow'); });

beforeEach(() => {
  localStorage.clear();
  scanCalls.length = 0;
  inspectSpy.mockClear();
  act(() => {
    newMap(editorPort, 'hexia');
    useEditorStore.setState({ locale: 'en', handedImport: null });
    for (const id of ['import', 'newProject', 'planetImport'] as const) useEditorStore.getState().setModal(id, false);
  });
});
afterEach(() => { cleanup(); });

describe('the page-level drop', () => {
  it('adds a dropped planet file to My planets in Change Planet without asking', async () => {
    render(<Host />);
    dropOnWindow(planetFile());
    await waitFor(() => expect(modals().newProject).toBe(true));
    expect(screen.queryByTestId('import-redirect')).toBeNull();
    expect(inspectSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(listPlanets().map((e) => e.template.id)).toEqual([PLANET.id]));
    expect(useEditorStore.getState().handedImport).toBeNull();
    expect(modals().planetImport).toBe(false);
  });

  it('starts reading a dropped video in Import planet without asking', async () => {
    render(<Host />);
    const video = videoFile();
    dropOnWindow(video);
    expect(await screen.findByTestId('scan-progress')).toBeTruthy();
    expect(screen.queryByTestId('import-redirect')).toBeNull();
    expect(modals()).toMatchObject({ newProject: true, planetImport: true });
    expect(scanCalls).toEqual([video]);
    expect(useEditorStore.getState().handedImport).toBeNull();
  });

  it('still reads a map file as a map', async () => {
    render(<Host />);
    dropOnWindow(mapFile());
    expect(await screen.findByTestId('import-confirm')).toBeTruthy();
    expect(inspectSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('import-redirect')).toBeNull();
  });
});

describe('Import map', () => {
  it('says a picked planet file is a planet and hands it to Change Planet', async () => {
    act(() => { useEditorStore.getState().setModal('import', true); });
    render(<Host />);
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [planetFile()] } });
    expect(await screen.findByText(t('import.redirect_planet_title'))).toBeTruthy();
    fireEvent.click(screen.getByText(t('import.redirect_go', { window: t('planet.import') })));
    expect(modals()).toMatchObject({ import: false, newProject: true });
    await waitFor(() => expect(listPlanets().map((e) => e.template.id)).toEqual([PLANET.id]));
  });

  it('says a dropped video is a game video and starts reading it in Import planet', async () => {
    act(() => { useEditorStore.getState().setModal('import', true); });
    render(<Host />);
    const video = videoFile();
    fireEvent.drop(screen.getByRole('button', { name: /drop/i }), { dataTransfer: { files: [video] } });
    expect(await screen.findByText(t('import.redirect_video_title'))).toBeTruthy();
    fireEvent.click(screen.getByText(t('import.redirect_go', { window: t('planet.import') })));
    expect(await screen.findByTestId('scan-progress')).toBeTruthy();
    expect(scanCalls).toEqual([video]);
    expect(modals().import).toBe(false);
  });

  it('returns to its drop zone when the card is cancelled', async () => {
    act(() => { useEditorStore.getState().setModal('import', true); });
    render(<Host />);
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [planetFile()] } });
    await screen.findByText(t('import.redirect_planet_title'));
    fireEvent.click(screen.getByText(t('delete.cancel')));
    expect(await screen.findByText(t('import.title'))).toBeTruthy();
    expect(modals()).toMatchObject({ import: true, newProject: false });
    expect(useEditorStore.getState().handedImport).toBeNull();
  });

  it('offers videos in its picker', () => {
    act(() => { useEditorStore.getState().setModal('import', true); });
    render(<Host />);
    const accept = screen.getByTestId('import-file').getAttribute('accept')!.split(',');
    expect(accept).toEqual(expect.arrayContaining(['image/png', '.json', 'video/*', '.mp4', '.mkv']));
  });
});

describe('Import planet window', () => {
  const openImportPlanet = async () => {
    act(() => { useEditorStore.getState().setModal('newProject', true); useEditorStore.getState().setModal('planetImport', true); });
    render(<Host />);
    return (await screen.findAllByTestId('planet-import')).find((el) => el.tagName === 'DIV')!;
  };
  const dropOn = (el: HTMLElement, file: File) => fireEvent.drop(el, { dataTransfer: { types: ['Files'], files: [file] } });

  it('reads a video dropped on the chooser without a choice first', async () => {
    const video = videoFile();
    dropOn(await openImportPlanet(), video);
    expect(await screen.findByTestId('scan-progress')).toBeTruthy();
    expect(scanCalls).toEqual([video]);
  });

  it('reads a planet file dropped on it as From a planet file does', async () => {
    dropOn(await openImportPlanet(), planetFile());
    await waitFor(() => expect(listPlanets().map((e) => e.template.id)).toEqual([PLANET.id]));
    expect(modals()).toMatchObject({ newProject: true, planetImport: false });
  });

  it('says a map file is a map and offers Import map, which reads it', async () => {
    dropOn(await openImportPlanet(), mapFile());
    expect(await screen.findByText(t('planet.redirect_map_title'))).toBeTruthy();
    fireEvent.click(screen.getByText(t('import.redirect_go', { window: t('import.title') })));
    expect(modals()).toMatchObject({ import: true, newProject: false, planetImport: false });
    expect(await screen.findByTestId('import-confirm')).toBeTruthy();
    expect(inspectSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a file that is neither a planet file nor a video', async () => {
    const toasts: string[] = [];
    const stop = setToastPresenter((text) => toasts.push(text));
    try {
      dropOn(await openImportPlanet(), textFile('hello', 'notes.txt', 'text/plain'));
      await waitFor(() => expect(toasts).toContain(t('planet.import_unknown')));
      expect(scanCalls).toHaveLength(0);
      expect(modals()).toMatchObject({ newProject: true, planetImport: true, import: false });
    } finally {
      stop();
    }
  });
});
