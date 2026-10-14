// paint.ts's drawFooter: the band carries only the user's own template line. The AI-illustration
// disclosure is baked into the stylized band's pixels (compose-stylized.ts), never injected here,
// so a user-authored footer is never rearranged by the system and removing the footer removes
// nothing but the user's own line. A fake 2D context records fill/fillText calls; everything else
// (frame, map fallback, brand band) is real paintComposition drawing this suite never asserts on.
import { describe, it, expect } from 'vitest';
import { paintComposition, type CompositionAssets } from '../../../io/export/paint';
import type { ExportComposition } from '../../../io/export/types';
import type { GridState } from '../../../core/model/types';
import type { MapProvenanceSummary } from '../../../core/provenance/types';

interface RectCall { x: number; y: number; w: number; h: number; fillStyle: unknown }
interface TextCall { text: string; x: number; y: number; fillStyle: unknown; textAlign: string }

function fakeCtx() {
  let fillStyle: unknown = '#000';
  let textAlign = 'left';
  let path: { x: number; y: number }[] = [];
  const rects: RectCall[] = [];
  const texts: TextCall[] = [];
  const fills: RectCall[] = [];
  const noop = () => {};
  const ctx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v: unknown) { fillStyle = v; },
    set strokeStyle(_v: unknown) {},
    set lineWidth(_v: number) {},
    font: '',
    get textAlign() { return textAlign; },
    set textAlign(v: string) { textAlign = v; },
    textBaseline: 'alphabetic',
    save: noop, restore: noop, clip: noop, stroke: noop, drawImage: noop,
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push({ x, y }); },
    lineTo(x: number, y: number) { path.push({ x, y }); },
    arcTo(x1: number, y1: number, x2: number, y2: number) { path.push({ x: x1, y: y1 }, { x: x2, y: y2 }); },
    closePath: noop,
    fill() {
      const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      fills.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, fillStyle });
    },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, fillStyle }); },
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y, fillStyle, textAlign }); },
    measureText(text: string) { return { width: text.length * 6 } as TextMetrics; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts, fills };
}

function baseAssets(overrides: Partial<CompositionAssets> = {}): CompositionAssets {
  return {
    baseMap: null,
    state: {} as GridState,
    summary: {} as MapProvenanceSummary,
    title: '', description: '',
    translate: (k) => (k === 'export.ai_tag' ? 'AI-TAG' : k),
    brand: { lockup: null, url: 'https://x.example', label: 'x.example', powerText: 'Made with x' },
    footerTemplate: '{name}{fill}{date}',
    footerTokens: { name: 'Hexia', date: '2026-08-29' },
    ...overrides,
  };
}

function baseComp(): ExportComposition {
  return {
    width: 400, height: 560, scale: 1,
    map: { x: 0, y: 0, w: 400, h: 460 },
    footer: { x: 0, y: 500, w: 400, h: 40 },
    brand: { x: 0, y: 540, w: 400, h: 20 },
    badges: [],
  };
}

describe('drawFooter: the user-owned band', () => {
  it('draws only the template text at its full width, no injected pill', () => {
    const { ctx, fills, texts } = fakeCtx();
    paintComposition(ctx, baseComp(), baseAssets());

    expect(fills.some((f) => f.fillStyle === 'rgba(87,73,53,0.10)')).toBe(false);
    expect(texts.some((t) => t.text === 'AI-TAG')).toBe(false);
    const right = texts.find((t) => t.text === '2026-08-29' && t.textAlign === 'right')!;
    expect(right.x).toBe(386); // rect.x + w - pad, nothing reserved beside the user's line

    const left = texts.find((t) => t.text === 'Hexia')!;
    expect(left.x).toBe(14);
  });
});

/** True when the string holds an unpaired UTF-16 surrogate, which paints as a replacement box. */
const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe('header and footer text in any script', () => {
  const withHeader = (): ExportComposition => ({ ...baseComp(), header: { x: 0, y: 0, w: 400, h: 60 } });
  const headerLines = (texts: TextCall[]) => texts.filter((t) => t.y < 60);

  it('wraps a description without spaces into two lines that fit, marking the dropped text', () => {
    const { ctx, texts } = fakeCtx();
    paintComposition(ctx, withHeader(), baseAssets({ description: '星布谷地的河边花园'.repeat(20) }));
    const lines = headerLines(texts);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(ctx.measureText(line.text).width).toBeLessThanOrEqual(400 - 12);
    expect(lines[1]!.text.endsWith('…')).toBe(true);
    expect(lines[0]!.text.startsWith('星布谷地')).toBe(true);
  });

  it('breaks an overlong word in a spaced script and keeps short words whole', () => {
    const { ctx, texts } = fakeCtx();
    paintComposition(ctx, withHeader(), baseAssets({ description: `${'a'.repeat(90)} river` }));
    const lines = headerLines(texts);
    expect(lines.map((l) => l.text)).toEqual(['a'.repeat(64), `${'a'.repeat(26)} river`]);
  });

  it('never splits a character outside the basic plane when it shortens a title or a footer', () => {
    const { ctx, texts } = fakeCtx();
    const wide = '𠮷野家🌊'.repeat(40);
    paintComposition(ctx, withHeader(), baseAssets({ title: wide, description: wide, footerTokens: { name: wide, date: '2026-08-29' } }));
    expect(texts.length).toBeGreaterThan(2);
    for (const t of texts) expect(hasLoneSurrogate(t.text), t.text).toBe(false);
  });

  it('shortens right-to-left footer text from its logical end and keeps it inside the band', () => {
    const { ctx, texts } = fakeCtx();
    const rtl = 'حديقة النهر '.repeat(12);
    paintComposition(ctx, baseComp(), baseAssets({ footerTokens: { name: rtl, date: '2026-08-29' } }));
    const left = texts.find((t) => t.textAlign === 'left' && t.y > 500)!;
    expect(left.text.startsWith('حديقة')).toBe(true);
    expect(left.text.endsWith('…')).toBe(true);
    expect(ctx.measureText(left.text).width).toBeLessThanOrEqual(400 - 28 - 12);
  });
});
