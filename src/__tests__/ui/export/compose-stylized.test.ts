// compose-stylized: the stylized band is one flat picture — generation, then the editor's grid, then
// the user's ink, then the disclosure watermark baked into the pixels' own bottom-right corner. The watermark lives HERE
// and never in the footer band, which is the user's own line — and it belongs to MODEL pixels
// alone: the callers pass an empty label for a procedurally drawn version, whose pixels carry no
// disclosure duty, and the empty label draws nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { composeStylizedBaseMap } from '../../../ui/chrome/modals/export/stylize/compose-stylized';

interface Draw { args: unknown[] }
interface Text { text: string; x: number; y: number }

function spyContext() {
  const draws: Draw[] = [];
  const texts: Text[] = [];
  const ctx = {
    canvas: null as unknown,
    fillStyle: '#000',
    font: '',
    textBaseline: 'alphabetic',
    drawImage: (...args: unknown[]) => { draws.push({ args }); },
    fillText: (text: string, x: number, y: number) => { texts.push({ text, x, y }); },
    measureText: (t: string) => ({ width: t.length * 8 }),
    beginPath: () => {}, moveTo: () => {}, arcTo: () => {}, closePath: () => {}, fill: () => {},
  };
  return { ctx, draws, texts };
}

describe('composeStylizedBaseMap', () => {
  let spy: ReturnType<typeof spyContext>;
  beforeEach(() => {
    spy = spyContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(spy.ctx as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => vi.restoreAllMocks());

  const stylized = { width: 1000, height: 830 } as HTMLCanvasElement;
  const ink = { width: 500, height: 415 } as HTMLImageElement;

  it('layers generation, ink and the watermark into one canvas', () => {
    composeStylizedBaseMap(stylized, ink, '插画由 AI 绘制');
    expect(spy.draws).toHaveLength(2);
    expect(spy.draws[0]!.args[0]).toBe(stylized);
    expect(spy.draws[1]!.args[0]).toBe(ink);
    // The ink stretches over the same rect as the generation.
    expect(spy.draws[1]!.args.slice(1)).toEqual([0, 0, 1000, 830]);

    const mark = spy.texts.find((t) => t.text === '插画由 AI 绘制');
    expect(mark).toBeTruthy();
    // Bottom-right corner of the band, inside its margins.
    expect(mark!.x).toBeGreaterThan(1000 * 0.6);
    expect(mark!.y).toBeGreaterThan(830 * 0.85);
    expect(mark!.x).toBeLessThan(1000);
    expect(mark!.y).toBeLessThan(830);
  });

  it('lays the grid between the picture and the ink, stretched over the same rect', () => {
    const grid = { width: 500, height: 415 } as HTMLImageElement;
    composeStylizedBaseMap(stylized, ink, '', grid);
    expect(spy.draws.map((d) => d.args[0])).toEqual([stylized, grid, ink]);
    expect(spy.draws[1]!.args.slice(1)).toEqual([0, 0, 1000, 830]);
  });

  it('skips the ink layer when there is none, never a model take\'s watermark', () => {
    composeStylizedBaseMap(stylized, null, 'Illustration drawn by AI');
    expect(spy.draws).toHaveLength(1);
    expect(spy.texts.some((t) => t.text === 'Illustration drawn by AI')).toBe(true);
  });

  it('an empty label draws no watermark at all, which is how procedural pixels ride through', () => {
    composeStylizedBaseMap(stylized, ink, '');
    expect(spy.draws).toHaveLength(2);
    expect(spy.texts).toHaveLength(0);
  });
});
