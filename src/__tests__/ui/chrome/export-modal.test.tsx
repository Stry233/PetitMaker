vi.mock('../../../ui/chrome/modals/export/review/use-map-review', () => ({ useMapReview: () => ({ result: { status: 'clear' }, pending: false, previewReady: true, revision: '0', check: async () => ({ status: 'clear' }), retry: vi.fn(), cancel: vi.fn() }) }));
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { ExportModal } from '../../../ui/chrome/modals/export/ExportModal';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { I18nProvider } from '../../../i18n/context';
import { roadLookup } from '../../../state/object-index';
import * as PreviewBridge from '../../../ui/chrome/modals/export/render-preview-bridge';
import { reviewText } from '../../../io/moderation/text/reviewer';

vi.mock('../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: async () => true, notice: null }),
}));

vi.mock('../../../io/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../io/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

// Synthetic test maps lack a registered template; preserve the real glyph footprint in the stub.
vi.mock('../../../io/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../io/share')>();
  const { encodeGlyph } = await import('../../../io/share/glyph/encode');
  return {
    ...actual,
    buildShareCode: vi.fn(async (_state, _summary, _meta, availableWidth: number) => {
      const moduleBase = actual.moduleBaseFor(availableWidth);
      if (moduleBase === null) return null;
      return { ...encodeGlyph(new Uint8Array(32), moduleBase)!, payloadLen: 32, shareOriginalRecommended: false };
    }),
  };
});
// downloadBlob calls URL.createObjectURL, which jsdom doesn't implement — capture the Blob instead.
vi.mock('../../../io/image-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../io/image-export')>();
  return { ...actual, downloadBlob: vi.fn() };
});
// No 2D renderer is registered in jsdom — stand in for the view host's capture verb.
vi.mock('../../../kit/host', () => ({
  host: { capture2d: vi.fn(() => null), capture2dRegionCanvas: vi.fn(() => null), capture2dTextureCap: () => 16384 },
}));

import { buildShareCode } from '../../../io/share';
import { downloadBlob } from '../../../io/image-export';
import { host } from '../../../kit/host';
import * as Toast from '../../../ui/chrome/floating/Toast';
import { setStoreState, setStoreModal } from '../../_store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function mountStateWith(setupExec?: (e: CommandExecutor) => void) {
  const s = makeState(8, 8);
  const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry(), roadLookup(s));
  setupExec?.(e);
  setStoreState({ gridState: s, commandExecutor: e });
  setStoreModal('export');
}

/** Minimal proxy-based CanvasRenderingContext2D stub — property sets are stored; any method GET
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
  // The window remembers its choices between openings; each test opens it fresh.
  beforeEach(() => {
    localStorage.clear(); setStoreState({ locale: 'en' });
    vi.mocked(reviewText).mockReset().mockResolvedValue({ allowed: true });
  });

  it('a human-only map shows the provenance badge control DISABLED (not hidden) and no "No AI" text', () => {
    mountStateWith();
    render(<ExportModal />, { wrapper: Wrapper });
    expect(screen.queryByText(/no ai/i)).toBeNull();
    const badge = screen.getByRole('switch', { name: 'Show provenance badge' });
    expect(badge.getAttribute('aria-disabled')).toBe('true'); // visible but disabled for human maps
  });

  it('exposes resolution choices and selects the clicked size', () => {
    mountStateWith();
    render(<ExportModal />, { wrapper: Wrapper });
    const high = screen.getByText('High').closest('button')!;
    expect(high.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(high);
    expect(screen.getByText('High').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('has no watermark control anywhere in the UI', () => {
    mountStateWith();
    render(<ExportModal />, { wrapper: Wrapper });
    expect(screen.queryByText(/watermark/i)).toBeNull();
  });

  it('offers only the two v2 presets (Share / Plain) — no Clean preset, no strip-mode picker', () => {
    mountStateWith();
    render(<ExportModal />, { wrapper: Wrapper });
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
      vi.mocked(host.capture2d).mockReturnValue('data:image/png;base64,AAAA');
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.mocked(host.capture2d).mockReturnValue(null);
      vi.mocked(buildShareCode).mockClear();
      vi.mocked(downloadBlob).mockClear();
    });

    it('builds a share code, produces a Blob with the band, and downloads it', async () => {
      mountStateWith();
      render(<ExportModal />, { wrapper: Wrapper });
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));

      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).toHaveBeenCalled(); // importable by default, so a band is built

      const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]!;
      expect(blob).toBeInstanceOf(Blob);
      expect(filename).toMatch(/^petit-planet-\d+\.png$/);
    });

    it('keeps a dense code exportable and recommends sharing its original file', async () => {
      const { encodeGlyph } = await import('../../../io/share/glyph/encode');
      vi.mocked(buildShareCode).mockResolvedValueOnce({
        ...encodeGlyph(new Uint8Array(7200), 12)!, payloadLen: 7200, shareOriginalRecommended: true,
      });
      const toast = vi.spyOn(Toast, 'showToast');
      mountStateWith();
      const { container } = render(<ExportModal />, { wrapper: Wrapper });
      const message = 'Image sharing: this map may not import after resizing. Share the original image or a map file.';
      await waitFor(() => expect(screen.getByText(message)).toBeTruthy(), { timeout: 3000 });
      await waitFor(() => expect(container.querySelector('[data-export-preview]')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));
      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenLastCalledWith(message, 'info');
    });

    it('a Plain export never requests a share code', async () => {
      mountStateWith();
      render(<ExportModal />, { wrapper: Wrapper });
      fireEvent.click(screen.getByText('Plain Image'));
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));

      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).not.toHaveBeenCalled();
    });

    it('fits the Native glyph to the reserved band width without clipping either finder', async () => {
      vi.stubGlobal('Image', class {
        width = 8192;
        height = 6000;
        onload: (() => void) | null = null;
        set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      });
      mountStateWith();
      render(<ExportModal />, { wrapper: Wrapper });
      fireEvent.click(screen.getByText('Native'));
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));

      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      const calls = vi.mocked(buildShareCode).mock.calls;
      expect(calls[calls.length - 1]![3]).toBe(7440);
      const result = await vi.mocked(buildShareCode).mock.results[calls.length - 1]!.value;
      expect(result?.width).toBe(7440);
    });

    it('the preview shows NO image while the code is encoding (no placeholder), then the real one', async () => {
      mountStateWith();
      const { container } = render(<ExportModal />, { wrapper: Wrapper });
      // Before the debounced build resolves the preview must stay in its loading state — the
      // composition (with any stand-in band) is never shown. Sampled inside the debounce window.
      await new Promise((r) => setTimeout(r, 120));
      expect(vi.mocked(buildShareCode)).not.toHaveBeenCalled();
      expect(container.querySelector('[data-export-preview]')).toBeNull();
      // Once the real code exists, the preview paints and the image appears.
      await waitFor(() => expect(container.querySelector('[data-export-preview]')).toBeTruthy(), { timeout: 3000 });
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
    });

    it('typing in the title repaints the image without rebuilding the glyph', async () => {
      const paints = vi.spyOn(PreviewBridge, 'paintPreview');
      mountStateWith();
      const { container } = render(<ExportModal />, { wrapper: Wrapper });
      await waitFor(() => expect(container.querySelector('[data-export-preview]')).toBeTruthy(), { timeout: 3000 });
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
      const paintsBefore = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.calls.length;

      // An IME hands the field a new value on every composition step.
      const input = screen.getByLabelText('Title');
      for (const value of ['山', '山下', '山下的家']) fireEvent.change(input, { target: { value } });

      // Inside the settle window nothing moves: no rebuild, no repaint, the picture stays up.
      await act(() => new Promise<void>((r) => setTimeout(r, 200)));
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.calls.length).toBe(paintsBefore);
      expect(container.querySelector('[data-export-preview]')).toBeTruthy();

      await waitFor(() => expect(paints.mock.calls.some(([args]) => args.options.title === '山下的家')).toBe(true), { timeout: 3000 });
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(buildShareCode).mock.calls[0]![2]).not.toHaveProperty('title');
      await waitFor(() => expect(container.querySelector('[data-export-preview]')).toBeTruthy());
    });

    it('the preview builds the REAL code once (debounced) and the export reuses it — one encode total', async () => {
      mountStateWith();
      render(<ExportModal />, { wrapper: Wrapper });

      // The cached preview asset arrives after the debounce, without any export click.
      await waitFor(() => expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1), { timeout: 3000 });
      // Built for the standard preset's export width — the same width compose will use.
      expect(vi.mocked(buildShareCode).mock.calls[0]![3]).toBe(1600);

      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));
      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      // The export reused the previewed canvas (same width + title + session createdAt) —
      // the band in the preview IS the band in the file.
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
    });
  });

  describe('nested FooterEditor Escape does not bubble to close the whole modal', () => {
    it('Escape closes the tag-insert menu but leaves ExportModal open (onClose not called)', async () => {
      // jsdom has no scrollIntoView — the menu's highlight-follow effect calls it on open.
      Element.prototype.scrollIntoView = vi.fn();
      // Both the menu's exit and (were it to fire) ModalShell's exit are framer-motion
      // transitions — skip them so DOM removal settles deterministically rather than
      // racing real animation timing (same pattern as src/__tests__/legal/a11y.test.tsx).
      MotionGlobalConfig.skipAnimations = true;
      try {
        mountStateWith();
        render(<ExportModal />, { wrapper: Wrapper });

        // Expand Appearance so the footer editor (footer defaults to on) is mounted.
        fireEvent.click(screen.getByText(/appearance/i));
        const insertBtn = screen.getByRole('button', { name: /insert tag/i });
        fireEvent.click(insertBtn);

        // The menu is open — its Fill row is a reliable, always-present marker.
        expect(screen.getByRole('button', { name: /fill/i })).toBeTruthy();

        // A probe capture-phase window listener, registered AFTER FooterEditor's own (like any
        // other future capture-phase Escape handler would be) — this is the piece that actually
        // distinguishes stopPropagation from stopImmediatePropagation: with plain stopPropagation,
        // FooterEditor's own dispatch-path short-circuit already happens to keep ModalShell's
        // (earlier-registered, bubble-phase) handler from firing, but a LATER-registered sibling
        // capture listener on the same node would still see the event; only
        // stopImmediatePropagation also suppresses it.
        let siblingCaptureListenerFired = false;
        window.addEventListener('keydown', () => { siblingCaptureListenerFired = true; }, true);

        // Escape while focus is inside the modal (not dispatched directly on window) so it
        // propagates capture-then-bubble through window exactly like a real keypress would.
        fireEvent.keyDown(insertBtn, { key: 'Escape' });

        expect(siblingCaptureListenerFired).toBe(false);

        // The insert-tag menu closed (AnimatePresence's unmount settles after a microtask
        // even with animations skipped)…
        await waitFor(() => expect(screen.queryByRole('button', { name: /fill/i })).toBeNull());
        // …but ExportModal itself stays open: onClose is never invoked, so the modal flag holds
        // and the modal's own controls are still present.
        expect(useEditorStore.getState().modals.export).toBe(true);
        expect(screen.getByRole('button', { name: 'Export image' })).toBeTruthy();
      } finally {
        MotionGlobalConfig.skipAnimations = false;
      }
    });
  });
});
