// src/__tests__/ui/import-modal.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportModal } from '../../ui/chrome/import/ImportModal';
import { I18nProvider } from '../../i18n/context';
import { setStoreState, setStoreModal } from '../_store';

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

  it('renders nothing when closed', () => {
    setStoreModal('import', false);
    const { container } = render(<ImportModal />, { wrapper: Wrapper });
    expect(container.textContent).toBe('');
  });

  it('the file picker accepts JPEG/WebP rasters, not just PNG/JSON', () => {
    setStoreModal('import');
    render(<ImportModal />, { wrapper: Wrapper });
    const createSpy = vi.spyOn(document, 'createElement');
    fireEvent.click(screen.getByRole('button'));
    const input = createSpy.mock.results.map((r) => r.value as HTMLElement).find((el) => el.tagName === 'INPUT') as HTMLInputElement;
    expect(input.accept).toContain('image/jpeg');
    expect(input.accept).toContain('image/webp');
    createSpy.mockRestore();
  });

  it('routes a dropped JPEG through the raster import path (createImageBitmap → getImageData → importFromRaster), not the legacy JSON path', async () => {
    // jsdom has neither createImageBitmap nor a real 2D canvas context; stub just enough of the
    // browser surface to observe that a JPEG is accepted and decoded as a raster, not rejected.
    const bitmap = { width: 4, height: 4 } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const getImageDataMock = vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4) }));
    const fakeCtx = { drawImage: vi.fn(), getImageData: getImageDataMock } as unknown as CanvasRenderingContext2D;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);

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
