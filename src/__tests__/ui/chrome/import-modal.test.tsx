import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportModal } from '../../../ui/chrome/modals/import/ImportModal';
import { I18nProvider } from '../../../i18n/context';
import { setStoreState, setStoreModal } from '../../_store';
import { makeState, setTerrain } from '../../rules/_helpers';
import { TerrainType } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import { inspectImportFile } from '../../../io/import-file';

vi.mock('../../../io/import-file', async (orig) => {
  const actual = await orig<typeof import('../../../io/import-file')>();
  return { ...actual, inspectImportFile: vi.fn((...args: Parameters<typeof actual.inspectImportFile>) => actual.inspectImportFile(...args)) };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe('ImportModal', () => {
  beforeEach(() => { setStoreState({ locale: 'en' }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the drop zone and honest guidance when open', () => {
    setStoreModal('import');
    render(<ImportModal />, { wrapper: Wrapper });
    expect(screen.getByText('Drop a map image or .json file here, or click to choose')).toBeTruthy();
    // v2: any raster (JPEG/screenshot) with an intact share-code band is importable, not just the
    // original PNG — the copy should say so honestly.
    expect(screen.getByText(/JPEG/i)).toBeTruthy();
    expect(screen.getAllByText(/\.json/i).length).toBeGreaterThan(0); // copy still mentions JSON too
  });

  it('asks before replacing: shows the decoded title and description, installs on Import, and closes', async () => {
    const commit = vi.fn(() => ({ status: 'imported' as const, source: 'raster' as const, warnings: [] }));
    vi.mocked(inspectImportFile).mockResolvedValueOnce({ status: 'ready', preview: { source: 'raster', state: makeState(), warnings: [], notes: { title: 'River garden', description: 'Three homes by the bend.' } }, commit });
    setStoreState({ gridState: makeState() });
    setStoreModal('import');
    render(<ImportModal />, { wrapper: Wrapper });
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [new File(['x'], 'map.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByText('Import this map?')).toBeTruthy());
    expect(screen.getByText('River garden')).toBeTruthy();
    expect(screen.getByText('Three homes by the bend.')).toBeTruthy();
    expect(screen.queryByText('It replaces the map you are working on.')).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(commit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useEditorStore.getState().modals.import).toBe(false));
  });

  it('warns that an import replaces a map with content, and Cancel returns to the drop zone', async () => {
    const commit = vi.fn();
    vi.mocked(inspectImportFile).mockResolvedValueOnce({ status: 'ready', preview: { source: 'json', state: makeState(), warnings: [] }, commit });
    const withContent = makeState();
    setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
    setStoreState({ gridState: withContent });
    setStoreModal('import');
    render(<ImportModal />, { wrapper: Wrapper });
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [new File(['{}'], 'map.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText('It replaces the map you are working on.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(commit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Drop a map image or .json file here, or click to choose')).toBeTruthy());
    expect(useEditorStore.getState().modals.import).toBe(true);
  });

  it('renders nothing when closed', () => {
    setStoreModal('import', false);
    const { container } = render(<ImportModal />, { wrapper: Wrapper });
    expect(container.textContent).toBe('');
  });

  it('the file picker accepts JPEG/WebP rasters, not just PNG/JSON', () => {
    setStoreModal('import');
    render(<ImportModal />, { wrapper: Wrapper });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button'));
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(input.accept).toContain('image/jpeg');
    expect(input.accept).toContain('image/webp');
    clickSpy.mockRestore();
  });

  it('routes a dropped JPEG through the raster import path (createImageBitmap → getImageData → importFromRaster), not the legacy JSON path', async () => {
    // jsdom has neither createImageBitmap nor a real 2D canvas context; stub just enough of the
    // browser surface to observe that a JPEG is accepted and decoded as a raster, not rejected.
    const bitmap = { width: 4, height: 4 } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const getImageDataMock = vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4) }));
    const fakeCtx = { drawImage: vi.fn(), getImageData: getImageDataMock } as unknown as CanvasRenderingContext2D;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as never);

    setStoreModal('import');
    render(<ImportModal />, { wrapper: Wrapper });
    const file = new File([new Uint8Array([1, 2, 3])], 'map.jpg', { type: 'image/jpeg' });
    const dropzone = screen.getByRole('button');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(createImageBitmapMock).toHaveBeenCalledWith(file));
    await waitFor(() => expect(getImageDataMock).toHaveBeenCalled());
    // A synthetic all-zero raster carries no real share code, so import fails honestly rather than
    // crashing — the modal settles back to its idle state (busy → false) once decodeGlyph rejects it.
    await waitFor(() => expect(screen.getByText('Drop a map image or .json file here, or click to choose')).toBeTruthy());

    getContextSpy.mockRestore();
  });
});
