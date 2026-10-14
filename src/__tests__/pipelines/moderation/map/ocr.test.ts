/**
 * The map's letter check over a stubbed tesseract worker: a suspicious line that a close reading
 * confirms blocks, and running out of confirmation budget before every line is read is an
 * unavailable check rather than a clear one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Line = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
const pages: Line[][] = [];
const closeReadings: string[] = [];

vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: '11', SINGLE_LINE: '7' },
  createWorker: vi.fn(async () => {
    let page = 0;
    return {
      setParameters: vi.fn(async () => undefined),
      recognize: vi.fn(async (_canvas: unknown, _opts?: unknown, output?: { blocks?: boolean }) => {
        if (output?.blocks) return { data: { blocks: [{ paragraphs: [{ lines: pages[page++] ?? [] }] }] } };
        return { data: { text: closeReadings.shift() ?? '', confidence: 90 } };
      }),
      terminate: vi.fn(async () => undefined),
    };
  }),
}));
vi.mock('wasm-feature-detect', () => ({ simd: async () => true }));
vi.mock('../../../../pipelines/moderation/map/raster', () => ({ crop: () => ({}) }));
vi.mock('../../../../pipelines/moderation/map/evidence', () => ({
  restrictedReading: (text: string) => ({ provisional: false, verdict: text.startsWith('suspect') }),
  confirmedReading: (_text: string, close: string) => ({ provisional: false, verdict: close === 'confirmed' }),
}));

const { checkLetters } = await import('../../../../pipelines/moderation/map/ocr');

const view = { width: 400, height: 400 } as unknown as OffscreenCanvas;
const line = (text: string): Line => ({ text, confidence: 90, bbox: { x0: 10, y0: 10, x1: 80, y1: 30 } });

beforeEach(() => { pages.length = 0; closeReadings.length = 0; });

describe('checkLetters', () => {
  it('blocks a suspicious line the close reading confirms', async () => {
    pages.push([line('suspect one')]);
    closeReadings.push('confirmed');
    expect(await checkLetters([view], 'https://app.example/')).toBe('blocked');
  });

  it('is clear when no line is suspicious', async () => {
    pages.push([line('market street'), line('north pond')]);
    expect(await checkLetters([view], 'https://app.example/')).toBe('clear');
  });

  it('reports unavailable when unconfirmed suspicious lines exhaust the budget before the rest is read', async () => {
    pages.push([line('suspect 1'), line('suspect 2'), line('suspect 3'), line('suspect 4'), line('suspect 5'), line('suspect 6')]);
    closeReadings.push('no', 'no', 'no', 'no', 'no', 'confirmed');
    expect(await checkLetters([view], 'https://app.example/')).toBe('unavailable');
  });
});
