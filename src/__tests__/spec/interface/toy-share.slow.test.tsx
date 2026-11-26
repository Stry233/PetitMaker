// @vitest-environment jsdom
/**
 * The Bilibili Toy package's three ways to share, through the share window, the link a visitor
 * opens and the footer of the picture, against a `window.toy` double that answers like the App or
 * like a web browser.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';

vi.hoisted(() => { Object.assign(globalThis, { __PETIT_LITE__: true, __PETIT_LITE_HOST__: 'bilibili' }); });
// The Bilibili build's aliases, as `scripts/edition-build.mts` applies them.
vi.mock('../../../editor/export/host-deliveries', () => import('../../../editor/export/host-deliveries-bilibili'));
vi.mock('../../../platform/host/host-bridge', () => import('../../../platform/host/host-bridge-bilibili'));
vi.mock('../../../editor/review/edition-review', () => import('../../../editor/review/edition-review-bilibili'));
vi.mock('../../../pipelines/moderation/text/reviewer', () => import('../../../pipelines/moderation/text/reviewer-lite'));
// The acknowledgement's few seconds and the composition's canvas work are another requirement's.
vi.mock('../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: async () => true, notice: null }),
}));
vi.mock('../../../io/export/run-image-export', () => ({ runImageExport: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...await original<typeof import('../../../io/export/download')>(), downloadBlob: vi.fn(),
}));
vi.mock('../../../view/map2d/PixiCanvas', () => ({ PixiCanvas: () => null }));

import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_support/store';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { openSave } from '../../../io/import/open-save';
import { getMapTemplate } from '../../../config/maps';
import { TerrainType, type GridState } from '../../../core/model/types';
import { runImageExport } from '../../../io/export/run-image-export';
import { downloadBlob } from '../../../io/export/download';
import { LiteShareWindow } from '../../../ui/lite/LiteShareWindow';
import { LiteWindows } from '../../../ui/lite/LiteWindows';
import { inspectMapLink } from '../../../io/import/file';
import { canonicalize, toSaveFile } from '../../../io/save/canonical';

const QR = 'data:image/png;base64,iVBORw0KGgo=';
const TOY_ROOT = 'https://www.bilibili.com/toy/petitmaker/';

type Verdict = 'ok' | 'rejected' | 'unavailable';

/** A `window.toy` double: the App answers every ability, a web browser only the QR. Its text check
 *  answers each text with the next of `verdicts`, `ok` once none is left. */
function installToy(where: 'app' | 'web', ...verdicts: Verdict[]) {
  const app = where === 'app';
  const toy = {
    checkInputSafety: vi.fn(async (_request: { text: string; scene?: string }) => {
      const status = verdicts.shift() ?? 'ok';
      return { passed: status === 'ok', status };
    }),
    isSupport: vi.fn(async (ability: string) => ability === 'getQrCode' || app),
    saveImageToAlbum: vi.fn(async (_options: { base64Data?: string; url?: string; hintMsg?: string }) => ({ localPath: '/album/map.png' })),
    share: vi.fn(async (_options: { path: string }) => undefined),
    getQrCode: vi.fn(async ({ path }: { path?: string; size?: number } = {}) => ({ base64: QR, url: TOY_ROOT + (path ?? 'index.html') })),
  };
  (window as unknown as { toy: typeof toy }).toy = toy;
  return toy;
}

/** A small map on a built-in planet, with a mountain the link must carry, and `notes` as its words. */
function seedMap(notes?: GridState['notes']) {
  const raw = readFileSync('src/__tests__/fixtures/saves/petit-planet-hexia-1782022830197.json', 'utf8');
  const state = openSave(raw, getMapTemplate('hexia'));
  if (notes) state.notes = notes;
  for (let x = 20; x < 24; x++) state.cells[20]![x]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
  setStoreState({ gridState: state, commandExecutor: createExecutor(state, createDefaultRegistry()), locale: 'en' });
  return state;
}

/** The exported picture, `bytes` long. */
function exportsPicture(bytes: number) {
  vi.mocked(runImageExport).mockResolvedValue({ status: 'done', blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), carriesCode: false, codeTooSmall: false, codeFailed: false, codeNotice: null });
}

const Wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

async function openShareWindow() {
  const view = render(<LiteShareWindow />, { wrapper: Wrapper });
  act(() => { useEditorStore.getState().setModal('share', true); });
  await screen.findByRole('button', { name: 'Save picture' });
  return view;
}

const pressWhenReady = async (name: string) => {
  const button = await screen.findByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(runImageExport).mockReset();
  vi.mocked(downloadBlob).mockClear();
  // jsdom loads no pictures; the QR's image counts as loaded once its source is set.
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get(this: HTMLImageElement) { return this.getAttribute('src') ?? ''; },
    set(this: HTMLImageElement, value: string) {
      this.setAttribute('src', value);
      queueMicrotask(() => this.dispatchEvent(new Event('load')));
    },
  });
  exportsPicture(1000);
});
afterEach(() => {
  cleanup();
  delete (window as { toy?: unknown }).toy;
  useEditorStore.getState().setModal('share', false);
  history.replaceState(null, '', '/');
});

describe('saving the picture on Bilibili', () => {
  spec('UI-72', 'keeps the picture in the App\'s album and downloads nothing', async () => {
    const toy = installToy('app');
    seedMap();
    await openShareWindow();
    await pressWhenReady('Save picture');
    await waitFor(() => expect(toy.saveImageToAlbum).toHaveBeenCalledTimes(1));
    expect(toy.saveImageToAlbum.mock.calls[0]![0].base64Data).toMatch(/^data:image\/png;base64,/);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  spec('UI-72', 'downloads the picture in a web browser, where the Toy has no album', async () => {
    const toy = installToy('web');
    seedMap();
    await openShareWindow();
    await pressWhenReady('Save picture');
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadBlob).mock.calls[0]![1]).toMatch(/\.png$/);
    expect(toy.saveImageToAlbum).not.toHaveBeenCalled();
  });

  spec('UI-72', 'never sends a picture past the album\'s limit, and offers a size that fits', async () => {
    const toy = installToy('app');
    seedMap();
    await openShareWindow();
    // Over five million characters once written as base64.
    exportsPicture(4_000_000);
    await pressWhenReady('Save picture');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/too large/i);
    expect(toy.saveImageToAlbum).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
    exportsPicture(1000);
    const offer = screen.getByRole('button', { name: /^Save at / });
    fireEvent.click(offer);
    await waitFor(() => expect(toy.saveImageToAlbum).toHaveBeenCalledTimes(1));
    const sizes = vi.mocked(runImageExport).mock.calls.map(([, request]) => request.options.resolution);
    expect(sizes).toHaveLength(2);
    expect(sizes[1]).not.toBe(sizes[0]);
  });
});

describe('sharing a link that opens the map', () => {
  spec('UI-72', 'shares a Toy link whose parameter carries the map', async () => {
    const toy = installToy('app');
    const state = seedMap();
    await openShareWindow();
    await pressWhenReady('Share link');
    await waitFor(() => expect(toy.share).toHaveBeenCalledTimes(1));
    const { path } = toy.share.mock.calls[0]![0];
    const link = new URL(path, TOY_ROOT);
    expect(link.pathname).toBe('/toy/petitmaker/index.html');
    const code = link.searchParams.get('map')!;
    const opened = await inspectMapLink(code);
    if (opened.status !== 'ready') throw new Error(`link refused: ${opened.status}`);
    expect(JSON.stringify(toSaveFile(canonicalize(opened.preview.state)))).toBe(JSON.stringify(toSaveFile(canonicalize(state))));
  });

  spec('UI-72', 'shows no Share link in a web browser', async () => {
    installToy('web');
    seedMap();
    await openShareWindow();
    expect(screen.queryByRole('button', { name: 'Share link' })).toBeNull();
  });

  spec('UI-72', 'asks before a linked map replaces the open one, and replaces it only on confirm', async () => {
    const toy = installToy('app');
    const linked = seedMap();
    await openShareWindow();
    await pressWhenReady('Share link');
    await waitFor(() => expect(toy.share).toHaveBeenCalledTimes(1));
    const { path } = toy.share.mock.calls[0]![0];
    cleanup();
    useEditorStore.getState().setModal('share', false);

    for (const answer of ['Cancel', 'Replace'] as const) {
      const open = openSave(readFileSync('src/__tests__/fixtures/saves/petit-planet-hexia-1782022830197.json', 'utf8'), getMapTemplate('hexia'));
      for (let x = 2; x < 9; x++) open.cells[30]![x]!.terrain = { type: TerrainType.Water, elevation: 0 };
      setStoreState({ gridState: open, commandExecutor: createExecutor(open, createDefaultRegistry()) });
      history.replaceState(null, '', `/toy/petitmaker/${path}`);
      render(<LiteWindows />, { wrapper: Wrapper });
      await screen.findByTestId('import-confirm');
      expect(useEditorStore.getState().gridState, 'nothing replaced while it asks').toBe(open);
      fireEvent.click(screen.getByRole('button', { name: answer }));
      if (answer === 'Cancel') {
        await waitFor(() => expect(screen.queryByTestId('import-confirm')).toBeNull());
        expect(useEditorStore.getState().gridState).toBe(open);
      } else {
        await waitFor(() => expect(useEditorStore.getState().gridState).not.toBe(open));
        expect(JSON.stringify(toSaveFile(canonicalize(useEditorStore.getState().gridState!)))).toBe(JSON.stringify(toSaveFile(canonicalize(linked))));
      }
      expect(location.search, 'a reload does not ask again').toBe('');
      cleanup();
    }
  });
});

describe('the words a shared link carries', () => {
  const words = { title: 'Harvest bay', description: 'A small planet designed for walking' };

  spec('UI-72', 'checks the title and description once each before the link is shared', async () => {
    const toy = installToy('app');
    seedMap(words);
    await openShareWindow();
    await pressWhenReady('Share link');
    await waitFor(() => expect(toy.share).toHaveBeenCalledTimes(1));
    expect(toy.checkInputSafety.mock.calls.map(([request]) => request)).toEqual([
      { text: 'Harvest bay', scene: 'title' }, { text: 'A small planet designed for walking', scene: 'description' },
    ]);
    expect(Math.max(...toy.checkInputSafety.mock.invocationCallOrder)).toBeLessThan(toy.share.mock.invocationCallOrder[0]!);
  });

  spec('UI-72', 'refuses a link whose words the check rejects', async () => {
    const toy = installToy('app', 'ok', 'rejected');
    seedMap(words);
    await openShareWindow();
    await pressWhenReady('Share link');
    expect((await screen.findByRole('alert')).textContent).toContain('This text contains inappropriate words. Please revise Description.');
    expect(toy.share).not.toHaveBeenCalled();
  });

  spec('UI-72', 'holds the link while the check could not run, and shares it once checked again', async () => {
    const toy = installToy('app', 'unavailable');
    seedMap(words);
    await openShareWindow();
    await pressWhenReady('Share link');
    expect((await screen.findByRole('alert')).textContent).toContain('The text check could not finish.');
    expect(toy.share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await pressWhenReady('Share link');
    await waitFor(() => expect(toy.share).toHaveBeenCalledTimes(1));
    // The words Check again approved are not sent to the check a third time.
    expect(toy.checkInputSafety).toHaveBeenCalledTimes(3);
  });
});

describe('the picture\'s footer QR on Bilibili', () => {
  spec('UI-72', 'draws the QR the Toy SDK makes for this Toy', async () => {
    const toy = installToy('web');
    seedMap();
    await openShareWindow();
    await pressWhenReady('Save picture');
    await waitFor(() => expect(runImageExport).toHaveBeenCalledTimes(1));
    expect(toy.getQrCode).toHaveBeenCalled();
    const [{ path }] = toy.getQrCode.mock.calls.at(-1)! as [{ path: string }];
    expect(path).toMatch(/^index\.html(?:\?map=[\w-]+)?$/);
    const { brand } = vi.mocked(runImageExport).mock.calls[0]![1];
    expect((brand.qr as HTMLImageElement).src).toBe(QR);
    expect(brand.url).toBe(TOY_ROOT + path);
  });
});

describe('copy on Bilibili', () => {
  for (const locale of ['en', 'zh'] as const) {
    spec('UI-72', `the share window never names Xiaohongshu or its note (${locale})`, async () => {
      installToy('app');
      seedMap();
      setStoreState({ locale });
      render(<LiteShareWindow />, { wrapper: Wrapper });
      act(() => { useEditorStore.getState().setModal('share', true); });
      await waitFor(() => expect(document.body.textContent).toMatch(locale === 'en' ? /Save picture/ : /保存图片/));
      expect(document.body.textContent).not.toMatch(/Xiaohongshu|RedNote|小红书|Create a note|创建笔记/);
    });
  }
});
