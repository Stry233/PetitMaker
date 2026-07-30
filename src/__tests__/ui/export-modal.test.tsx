// src/__tests__/ui/export-modal.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { ExportModal } from '../../ui/chrome/export/ExportModal';
import { useEditorStore } from '../../state/store';
import { makeState } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { I18nProvider } from '../../i18n/context';

// buildShareCode runs the real PetitGlyph v2 encode pipeline (canonicalize + SHA-256 + RS coding),
// which needs a template registered in config/maps — the synthetic `makeState` template isn't one.
// Stub it to a small fixed code so the export flow can be exercised end to end in jsdom.
vi.mock('../../io/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/share')>();
  return {
    ...actual,
    buildShareCode: vi.fn(async () => ({
      rgba: new Uint8Array(4 * 4 * 4).fill(180),
      width: 4,
      height: 4,
      tier: { id: 0, div: 1, bits: 3, colors: 8, dataCols: 132, dataRows: 27, payloadCap: 184 },
      payloadLen: 32,
    })),
  };
});
// downloadBlob calls URL.createObjectURL, which jsdom doesn't implement — capture the Blob instead.
vi.mock('../../io/image-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/image-export')>();
  return { ...actual, downloadBlob: vi.fn() };
});

import { buildShareCode } from '../../io/share';
import { downloadBlob } from '../../io/image-export';
import { setStoreState } from '../_store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function mountStateWith(setupExec?: (e: CommandExecutor) => void) {
  const s = makeState(8, 8);
  const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry());
  setupExec?.(e);
  setStoreState({ gridState: s, commandExecutor: e, exportModalOpen: true });
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
  beforeEach(() => { setStoreState({ locale: 'en' }); });

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
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeFakeCtx());
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(['fake-png']));
      });
      (window as unknown as { __petitCaptureFullMap?: () => string }).__petitCaptureFullMap = () => 'data:image/png;base64,AAAA';
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete (window as unknown as { __petitCaptureFullMap?: unknown }).__petitCaptureFullMap;
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

    it('a Plain export never requests a share code', async () => {
      mountStateWith();
      render(<ExportModal />, { wrapper: Wrapper });
      fireEvent.click(screen.getByText('Plain Image'));
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));

      await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalled());
      expect(vi.mocked(buildShareCode)).not.toHaveBeenCalled();
    });

    it('the preview shows NO image while the code is encoding (no placeholder), then the real one', async () => {
      mountStateWith();
      const { container } = render(<ExportModal />, { wrapper: Wrapper });
      // Before the debounced build resolves the preview must stay in its loading state — the
      // composition (with any stand-in band) is never shown.
      await new Promise((r) => setTimeout(r, 250));
      expect(vi.mocked(buildShareCode)).not.toHaveBeenCalled();
      expect(container.querySelector('img')).toBeNull();
      // Once the real code exists, the preview paints and the image appears.
      await waitFor(() => expect(container.querySelector('img')).toBeTruthy(), { timeout: 3000 });
      expect(vi.mocked(buildShareCode)).toHaveBeenCalledTimes(1);
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
        // …but ExportModal itself did NOT: onClose (setExportModalOpen(false)) was never
        // invoked, so the store's exportModalOpen stays true and the modal's own controls
        // are still present.
        expect(useEditorStore.getState().exportModalOpen).toBe(true);
        expect(screen.getByRole('button', { name: 'Export image' })).toBeTruthy();
      } finally {
        MotionGlobalConfig.skipAnimations = false;
      }
    });
  });
});
