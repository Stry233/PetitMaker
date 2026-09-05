import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeGlyphAsync } from '../../../../io/share/glyph/decode-async';
import { decodeGlyph } from '../../../../io/share/glyph/decode';

vi.mock('../../../../io/share/glyph/decode', () => ({ decodeGlyph: vi.fn(() => null) }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('background image decoding', () => {
  function installWorker(outcome: 'success' | 'empty' | 'error' | 'messageerror') {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: Uint8Array | null }) => void;
      onerror?: () => void;
      onmessageerror?: () => void;
      terminate = terminate;
      postMessage(...args: unknown[]) {
        postMessage(...args);
        queueMicrotask(() => {
          if (outcome === 'error') this.onerror?.();
          else if (outcome === 'messageerror') this.onmessageerror?.();
          else this.onmessage?.({ data: outcome === 'empty' ? null : new Uint8Array([7, 9]) });
        });
      }
    });
    return { terminate, postMessage };
  }

  it('returns the worker result without transferring ownership of input pixels', async () => {
    const worker = installWorker('success');
    const rgba = new Uint8Array([1, 2, 3, 255]);
    expect(await decodeGlyphAsync(rgba, 1, 1)).toEqual(new Uint8Array([7, 9]));
    expect(worker.postMessage.mock.calls).toEqual([[{ rgba, width: 1, height: 1 }]]);
    expect(rgba.byteLength).toBe(4);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(decodeGlyph).not.toHaveBeenCalled();
  });

  it('terminates the worker after an unreadable image without repeating recovery', async () => {
    const worker = installWorker('empty');
    expect(await decodeGlyphAsync(new Uint8Array(4), 1, 1)).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(decodeGlyph).not.toHaveBeenCalled();
  });

  it.each(['error', 'messageerror'] as const)('falls back and terminates after a worker %s', async (outcome) => {
    const worker = installWorker(outcome);
    const rgba = new Uint8Array(4);
    expect(await decodeGlyphAsync(rgba, 1, 1)).toBeNull();
    expect(decodeGlyph).toHaveBeenCalledWith(rgba, 1, 1);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('falls back when workers are unavailable or cannot start', async () => {
    vi.stubGlobal('Worker', undefined);
    await decodeGlyphAsync(new Uint8Array(4), 1, 1);
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Unavailable'); } });
    await decodeGlyphAsync(new Uint8Array(4), 1, 1);
    expect(decodeGlyph).toHaveBeenCalledTimes(2);
  });
});
