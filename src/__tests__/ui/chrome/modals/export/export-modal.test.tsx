// @vitest-environment jsdom
import { captureImageAttribution } from '../../../../../io/save/image-attribution';
vi.mock('../../../../../ui/chrome/modals/export/review/use-map-review', () => ({ useMapReview: () => ({ result: { status: 'clear' }, pending: false, previewReady: true, revision: '0', check: async () => ({ status: 'clear' }), retry: vi.fn(), cancel: vi.fn() }) }));
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { ExportPanel } from '../../../../../ui/chrome/modals/export/ExportModal';
import { ShareWindow } from '../../../../../ui/chrome/modals/export/ShareWindow';
import { useEditorStore } from '../../../../../state/store';
import { makeState } from '../../../../_support/map-state';
import { CommandExecutor } from '../../../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../../../rules';
import { I18nProvider } from '../../../../../i18n/context';
import { reviewText } from '../../../../../pipelines/moderation/text/reviewer';

const requestNotice = vi.hoisted(() => vi.fn(async (_hasPetitGlyph?: boolean) => true));
vi.mock('../../../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: requestNotice, notice: null }),
}));

vi.mock('../../../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../../../pipelines/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

// Synthetic test maps lack a registered template; preserve the real glyph footprint in the stub.
vi.mock('../../../../../io/share/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../io/share/export')>();
  const { encodeGlyph } = await import('../../../../../io/share/glyph/encode');
  const { moduleBaseFor } = await import('../../../../../io/share/glyph/geometry');
  return {
    ...actual,
    buildShareCode: vi.fn(async (_state, _summary, _meta, availableWidth: number) => {
      const moduleBase = moduleBaseFor(availableWidth);
      if (moduleBase === null) return null;
      return { ...encodeGlyph(new Uint8Array(32), moduleBase)!, payloadLen: 32, shareOriginalRecommended: false };
    }),
  };
});
// downloadBlob calls URL.createObjectURL, which jsdom doesn't implement; capture the Blob instead.
vi.mock('../../../../../io/export/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../io/export/download')>();
  return { ...actual, downloadBlob: vi.fn() };
});
// No 2D renderer is registered in jsdom; stand in for the view host's capture verb.
vi.mock('../../../../../editor/host/host', () => ({
  host: { capture2d: vi.fn(() => null), capture2dImage: vi.fn(() => null), capture2dTextureCap: () => 16384 },
}));

import { buildShareCode } from '../../../../../io/share/export';
import { downloadBlob } from '../../../../../io/export/download';
import { host } from '../../../../../editor/host/host';
import * as Toast from '../../../../../platform/channels/toast-bus';
import { setStoreState } from '../../../../_support/store';
import { createExecutor } from '../../../../../state/executor';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function mountStateWith(setupExec?: (e: CommandExecutor) => void) {
  const s = makeState(8, 8);
  const e = createExecutor(s, createDefaultRegistry());
  setupExec?.(e);
  setStoreState({ gridState: s, commandExecutor: e });
  useEditorStore.getState().openShare('friend');
}

/** Minimal proxy-based CanvasRenderingContext2D stub: property sets are stored; any method GET
 *  returns a no-op except the couple of read-backs the export painter/encoder actually need. */
function makeFakeCtx(): CanvasRenderingContext2D {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4), width: w, height: h });
      }
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

describe('ExportModal', () => {
  it('disables an original title and permits filling an empty description', () => {
    mountStateWith();
    const state = useEditorStore.getState().gridState!;
    state.notes = { title: 'Garden' };
    state.imageAttribution = captureImageAttribution(state);
    render(<ShareWindow />, { wrapper: Wrapper });
    expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A riverside walk' } });
    expect(state.notes).toEqual({ title: 'Garden', description: 'A riverside walk' });
  });
  // The window remembers its choices between openings; each test opens it fresh.
  beforeEach(() => {
    localStorage.clear(); setStoreState({ locale: 'en' });
    requestNotice.mockClear();
    vi.mocked(reviewText).mockReset().mockResolvedValue({ allowed: true });
  });

  it('a human-only map shows the provenance badge control DISABLED (not hidden) and no "No AI" text', () => {
    mountStateWith();
    render(<ShareWindow />, { wrapper: Wrapper });
    expect(screen.queryByText(/no ai/i)).toBeNull();
    const badge = screen.getByRole('switch', { name: 'Show provenance badge' });
    expect(badge.getAttribute('aria-disabled')).toBe('true'); // visible but disabled for human maps
  });

  it('exposes resolution choices and selects the clicked size', () => {
    mountStateWith();
    render(<ShareWindow />, { wrapper: Wrapper });
    const high = screen.getByText('High').closest('button')!;
    expect(high.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(high);
    expect(screen.getByText('High').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers only the two v2 presets (Share / Plain) — no Clean preset, no strip-mode picker', () => {
    mountStateWith();
    render(<ShareWindow />, { wrapper: Wrapper });
    expect(screen.getByText('Share Image')).toBeTruthy();
    expect(screen.getByText('Plain Image')).toBeTruthy();
    expect(screen.queryByText('Clean Image')).toBeNull();
    expect(screen.queryByText('Visible restore strip')).toBeNull();
  });

  describe('export path (jsdom canvas mocked)', () => {
    beforeEach(() => {
      vi.stubGlobal('Image', class {
        width = 800;
        height = 600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) { queueMicrotask(() => this.onload?.()); }
      });
      vi.stubGlobal('ImageData', class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height?: number) {
          this.data = data;
          this.width = width;
          this.height = height ?? data.length / (4 * width);
        }
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeFakeCtx() as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(['fake-png']));
      });
      vi.mocked(host.capture2dImage).mockReturnValue('data:image/png;base64,AAAA');
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.mocked(host.capture2dImage).mockReturnValue(null);
      vi.mocked(buildShareCode).mockClear();
      vi.mocked(downloadBlob).mockClear();
    });

    it('builds a share code, produces a Blob with the band, and downloads it', async () => {
      mountStateWith();
      render(<ShareWindow />, { wrapper: Wrapper });
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));

      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).toHaveBeenCalled(); // importable by default, so a band is built

      const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]!;
      expect(blob).toBeInstanceOf(Blob);
      expect(filename).toMatch(/^petitmaker-\d+\.png$/);
    });

    it.each([false, true])('completes an injected image delivery only while its export is active (closed: %s)', async closed => {
      mountStateWith();
      let complete!: () => void;
      const send = vi.fn((_image: Blob) => new Promise<void>(resolve => { complete = resolve; }));
      const done = vi.fn();
      const mark = vi.spyOn(useEditorStore.getState(), 'markExported');
      const deliveries = [{ id: 'album', label: 'Save to album', available: true, send }];
      const { rerender } = render(<ExportPanel open entered onDone={done} deliveries={deliveries} />, { wrapper: Wrapper });
      fireEvent.click(screen.getByRole('button', { name: 'Save to album' }));
      await waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(send.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
      expect(requestNotice).toHaveBeenCalled();
      expect(downloadBlob).not.toHaveBeenCalled();
      if (closed) rerender(<ExportPanel open={false} entered={false} onDone={done} deliveries={deliveries} />);
      await act(async () => complete());
      expect(done).toHaveBeenCalledTimes(closed ? 0 : 1);
      expect(mark).toHaveBeenCalledTimes(closed ? 0 : 1);
    });

    it('keeps a dense code exportable and recommends sharing its original file', async () => {
      const { encodeGlyph } = await import('../../../../../io/share/glyph/encode');
      vi.mocked(buildShareCode).mockResolvedValueOnce({
        ...encodeGlyph(new Uint8Array(7200), 12)!, payloadLen: 7200, shareOriginalRecommended: true, notesOmitted: false,
      });
      const toast = vi.spyOn(Toast, 'showToast');
      mountStateWith();
      const { baseElement: container } = render(<ShareWindow />, { wrapper: Wrapper });
      const message = 'This map may not import from a resized image. Share the original image or a map file.';
      await waitFor(() => expect(screen.getByText(message)).toBeTruthy(), { timeout: 3000 });
      await waitFor(() => expect(container.querySelector('[data-export-preview]')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));
      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenLastCalledWith(message, 'info');
    });

    it('a Plain export never requests a share code', async () => {
      mountStateWith();
      render(<ShareWindow />, { wrapper: Wrapper });
      fireEvent.click(screen.getByText('Plain Image'));
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));

      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).not.toHaveBeenCalled();
      expect(requestNotice).toHaveBeenCalledWith(false);
    });

    it.each(['compact', 'failed', 'unavailable'] as const)('omits image protection when the glyph is %s', async reason => {
      if (reason === 'failed') vi.mocked(buildShareCode).mockRejectedValueOnce(new Error('Cannot encode'));
      if (reason === 'unavailable') vi.mocked(buildShareCode).mockResolvedValueOnce(null);
      mountStateWith();
      render(<ShareWindow />, { wrapper: Wrapper });
      if (reason === 'compact') fireEvent.click(screen.getByText('Compact'));
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));
      await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
      expect(requestNotice).toHaveBeenCalledWith(false);
    });

    it('waits for confirmation of the finished image before downloading', async () => {
      let confirm!: (accepted: boolean) => void;
      requestNotice.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
      mountStateWith();
      render(<ShareWindow />, { wrapper: Wrapper });
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));
      await waitFor(() => expect(requestNotice).toHaveBeenCalledWith(true));
      expect(downloadBlob).not.toHaveBeenCalled();
      await act(async () => confirm(false));
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(useEditorStore.getState().modals.share).toBe(true);
    });




  });

  describe('nested FooterEditor Escape does not bubble to close the whole modal', () => {
    it('Escape closes the tag-insert menu but leaves ExportModal open (onClose not called)', async () => {
      // jsdom has no scrollIntoView; the menu's highlight-follow effect calls it on open.
      Element.prototype.scrollIntoView = vi.fn();
      // Skipping framer-motion exits lets DOM removal settle without racing animation timing.
      MotionGlobalConfig.skipAnimations = true;
      try {
        mountStateWith();
        render(<ShareWindow />, { wrapper: Wrapper });

        // Expand Appearance so the footer editor (footer defaults to on) is mounted.
        fireEvent.click(screen.getByText(/appearance/i));
        const insertBtn = screen.getByRole('button', { name: /insert tag/i });
        fireEvent.click(insertBtn);

        expect(screen.getByRole('menuitemradio', { name: /fill/i })).toBeTruthy();

        // Escape belongs to the foreground surface: the menu closes and the window stays.
        fireEvent.keyDown(insertBtn, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: /fill/i })).toBeNull());
        expect(useEditorStore.getState().modals.share).toBe(true);
        expect(screen.getByRole('button', { name: 'Export image' })).toBeTruthy();
      } finally {
        MotionGlobalConfig.skipAnimations = false;
      }
    });
  });
});
