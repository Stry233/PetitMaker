import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeGlyphAsync } from '../../../../io/share/glyph/decode-async';
import { readGlyph } from '../../../../io/share/glyph/decode';

const NOTHING = { payload: null, found: 'nothing' } as const;
vi.mock('../../../../io/share/glyph/decode', () => ({ readGlyph: vi.fn(() => ({ payload: null, found: 'nothing' })) }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('background image decoding', () => {
  function installWorker(outcome: 'success' | 'empty' | 'error' | 'messageerror') {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: unknown }) => void;
      onerror?: () => void;
      onmessageerror?: () => void;
      terminate = terminate;
      postMessage(...args: unknown[]) {
        postMessage(...args);
        queueMicrotask(() => {
          if (outcome === 'error') this.onerror?.();
          else if (outcome === 'messageerror') this.onmessageerror?.();
          else this.onmessage?.({ data: outcome === 'empty' ? NOTHING : { payload: new Uint8Array([7, 9]) } });
        });
      }
    });
    return { terminate, postMessage };
  }

  it('returns the worker result without transferring ownership of input pixels', async () => {
    const worker = installWorker('success');
    const rgba = new Uint8Array([1, 2, 3, 255]);
    expect(await decodeGlyphAsync(rgba, 1, 1)).toEqual({ payload: new Uint8Array([7, 9]) });
    expect(worker.postMessage.mock.calls).toEqual([[{ rgba, width: 1, height: 1 }]]);
    expect(rgba.byteLength).toBe(4);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(readGlyph).not.toHaveBeenCalled();
  });

  it('terminates the worker after an unreadable image without repeating recovery', async () => {
    const worker = installWorker('empty');
    expect(await decodeGlyphAsync(new Uint8Array(4), 1, 1)).toEqual(NOTHING);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(readGlyph).not.toHaveBeenCalled();
  });

  it.each(['error', 'messageerror'] as const)('falls back and terminates after a worker %s', async (outcome) => {
    const worker = installWorker(outcome);
    const rgba = new Uint8Array(4);
    expect(await decodeGlyphAsync(rgba, 1, 1)).toEqual(NOTHING);
    expect(readGlyph).toHaveBeenCalledWith(rgba, 1, 1);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('recovers detached pixels after a worker failure and retires the worker before decoding again', async () => {
    const rgba = new Uint8Array([1, 2, 3, 255]);
    const recovered = rgba.slice();
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class {
      onerror?: () => void;
      terminate = terminate;
      postMessage(data: unknown, transfer: Transferable[]) {
        structuredClone(data, { transfer });
        queueMicrotask(() => this.onerror?.());
      }
    });
    const recoverPixels = vi.fn(async () => {
      expect(terminate).toHaveBeenCalledOnce();
      return recovered;
    });
    await decodeGlyphAsync(rgba, 1, 1, { recoverPixels });
    expect(rgba.byteLength).toBe(0);
    expect(recoverPixels).toHaveBeenCalledOnce();
    expect(readGlyph).toHaveBeenCalledWith(recovered, 1, 1);
  });

  it('falls back when workers are unavailable or cannot start', async () => {
    vi.stubGlobal('Worker', undefined);
    await decodeGlyphAsync(new Uint8Array(4), 1, 1);
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Unavailable'); } });
    await decodeGlyphAsync(new Uint8Array(4), 1, 1);
    expect(readGlyph).toHaveBeenCalledTimes(2);
  });
});
