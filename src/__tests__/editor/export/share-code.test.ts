/** The share picture's code band as a preview asks for it: when a band is built at all, the wait for
 *  changes to settle, and what a failed build says. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spec } from '../../_support/spec';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import type { GridState } from '../../../core/model/types';
import { createShareCodeBand, type ShareCodeRequest } from '../../../editor/export/share-code';
import { recordTextVerdict } from '../../../state/text-verdicts';

vi.mock('../../../io/share', async (orig) => ({ ...(await orig<typeof import('../../../io/share')>()), buildShareCode: vi.fn(async () => null) }));
import { buildShareCode } from '../../../io/share';

/** A map with `n` dirt roads stacked on one cell. */
function stacked(n: number): GridState {
  const s = createGridState(getMapTemplate('hexia'));
  for (let i = 0; i < n; i++) {
    s.objects.set(`r${i}`, { id: `r${i}`, catalogId: 'path-overgrown-dirt', position: { x: 29, y: 108 }, rotation: 0, elevation: 0 });
  }
  return s;
}

const ask = (over: Partial<ShareCodeRequest> = {}): ShareCodeRequest => ({
  state: stacked(1), summary: () => null, importable: true, resolution: 'standard', createdAt: '2026-11-07T00:00:00.000Z', ...over,
});

beforeEach(() => { vi.useFakeTimers(); vi.mocked(buildShareCode).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('the share code band', () => {
  spec('FILE-24', 'an image size too small for a code, or a picture that carries none, builds no band and waits for none', () => {
    const band = createShareCodeBand();
    for (const request of [ask({ resolution: 'compact' }), ask({ importable: false }), null]) {
      band.request(request);
      expect(band.snapshot()).toEqual({ asset: null, pending: false, issue: null });
    }
    vi.runAllTimers();
    expect(buildShareCode).not.toHaveBeenCalled();
  });

  it('waits for changes to settle and builds once for the last of them', async () => {
    const band = createShareCodeBand();
    const heard = vi.fn();
    band.subscribe(heard);
    band.request(ask());
    band.request(ask({ resolution: 'high' }));
    expect(band.snapshot().pending).toBe(true);
    await vi.runAllTimersAsync();
    expect(buildShareCode).toHaveBeenCalledTimes(1);
    expect(band.snapshot()).toEqual({ asset: null, pending: false, issue: null });
    expect(heard).toHaveBeenCalled();
  });

  it('gives the bands of one window session one timestamp, and the next session another', async () => {
    const band = createShareCodeBand();
    const stamps = (): unknown[] => vi.mocked(buildShareCode).mock.calls.map(([, , meta]) => (meta as { createdAt: string }).createdAt);
    vi.setSystemTime(new Date('2026-11-07T00:00:00.000Z'));
    band.request(ask({ createdAt: undefined }));
    await vi.runAllTimersAsync();
    vi.setSystemTime(new Date('2026-11-07T00:05:00.000Z'));
    band.request(ask({ createdAt: undefined, resolution: 'high' }));
    await vi.runAllTimersAsync();
    expect(stamps()).toEqual(['2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z']);
    band.request(null);
    vi.setSystemTime(new Date('2026-11-07T00:10:00.000Z'));
    band.request(ask({ createdAt: undefined }));
    await vi.runAllTimersAsync();
    expect(stamps()[2]).toBe('2026-11-07T00:10:00.000Z');
  });

  spec('FILE-24', 'a failed build says why, naming stacked objects where they stopped it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(buildShareCode).mockRejectedValueOnce(new Error('overlap')).mockRejectedValueOnce(new Error('other'));
    const band = createShareCodeBand();
    band.request(ask({ state: stacked(10) }));
    await vi.runAllTimersAsync();
    expect(band.snapshot().issue).toBe('export.code_overlap');
    band.request(ask());
    await vi.runAllTimersAsync();
    expect(band.snapshot().issue).toBe('export.code_failed');
  });

  it('builds again only when what the band carries moved: its words, or a tag\'s verdict landing', async () => {
    const band = createShareCodeBand();
    // Bands other tests left asked for hear the verdicts too; this one's builds carry its own timestamp.
    const createdAt = '2026-11-08T00:00:00.000Z';
    const builds = (): number => vi.mocked(buildShareCode).mock.calls.filter(([, , meta]) => (meta as { createdAt: string }).createdAt === createdAt).length;
    const request = ask({ createdAt, notesKey: 'one' });
    band.request(request);
    await vi.runAllTimersAsync();
    band.request({ ...request });
    await vi.runAllTimersAsync();
    expect(builds()).toBe(1);

    band.request({ ...request, notesKey: 'two' });
    await vi.runAllTimersAsync();
    expect(builds()).toBe(2);

    recordTextVerdict('a tag the map carries', true);
    await vi.runAllTimersAsync();
    expect(builds()).toBe(3);

    band.release();
    recordTextVerdict('another tag', true);
    await vi.runAllTimersAsync();
    expect(builds()).toBe(3);
  });

  it('reports nothing for a request withdrawn before its build lands', async () => {
    const band = createShareCodeBand();
    band.request(ask());
    band.request(null);
    await vi.runAllTimersAsync();
    expect(buildShareCode).not.toHaveBeenCalled();
    expect(band.snapshot()).toEqual({ asset: null, pending: false, issue: null });
  });
});
