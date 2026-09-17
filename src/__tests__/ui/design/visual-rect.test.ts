/**
 * Chromium before 128 reports a zoomed subtree's rects in that subtree's own CSS pixels, while
 * standardized engines report screen pixels. The helper probes once and converts legacy readings so
 * every measurement site sees screen pixels.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetVisualRectProbe, effectiveZoom, visualRect } from '../../../ui/design/visual-rect';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
}) as DOMRect;

/** Per-element zoom the mocked `getComputedStyle` answers with; jsdom's CSSOM drops `zoom`. */
const zooms = new WeakMap<Element, string>();
/** Per-element transform the mocked `getComputedStyle` answers with; 'none' unless posed. */
const transforms = new WeakMap<Element, string>();

/** Every element under `probeWidth` control: the probe box reads `probeWidth`, others their stub. */
function engine(probeWidth: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return (this as Element & { __rect?: DOMRect }).__rect ?? rect(0, 0, probeWidth, 10);
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => ({ zoom: zooms.get(el) ?? '1', transform: transforms.get(el) ?? 'none' }) as CSSStyleDeclaration);
}

function measured(el: Element, r: DOMRect): Element {
  (el as Element & { __rect?: DOMRect }).__rect = r;
  return el;
}

beforeEach(() => { __resetVisualRectProbe(); });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('visualRect', () => {
  it('returns the measured rect unchanged on an engine that reports screen pixels', () => {
    engine(100);
    const parent = document.createElement('div');
    zooms.set(parent, '0.5');
    const child = measured(document.createElement('div'), rect(10, 20, 30, 40));
    parent.append(child);
    document.body.append(parent);
    const r = visualRect(child);
    expect([r.left, r.top, r.width, r.height]).toEqual([10, 20, 30, 40]);
  });

  it('scales a legacy engine reading by the product of the ancestor zooms', () => {
    engine(200);
    const outer = document.createElement('div');
    zooms.set(outer, '0.5');
    const inner = document.createElement('div');
    zooms.set(inner, '0.8');
    const child = measured(document.createElement('div'), rect(100, 50, 40, 20));
    inner.append(child);
    outer.append(inner);
    document.body.append(outer);
    const r = visualRect(child);
    expect([r.left, r.top, r.width, r.height]).toEqual([40, 20, 16, 8]);
    expect([r.right, r.bottom]).toEqual([56, 28]);
  });

  it('leaves a legacy engine reading alone outside any zoomed ancestor', () => {
    engine(200);
    const el = measured(document.createElement('div'), rect(7, 8, 9, 10));
    document.body.append(el);
    const r = visualRect(el);
    expect([r.left, r.top, r.width, r.height]).toEqual([7, 8, 9, 10]);
  });

  it('scales a range reading by the zoom around its container', () => {
    engine(200);
    const parent = document.createElement('div');
    zooms.set(parent, '0.5');
    parent.append(document.createTextNode('caret'));
    document.body.append(parent);
    const range = document.createRange();
    range.selectNodeContents(parent);
    range.getBoundingClientRect = () => rect(20, 10, 40, 8);
    const r = visualRect(range);
    expect([r.left, r.top, r.width, r.height]).toEqual([10, 5, 20, 4]);
  });

  it('corrects a reading the size of the element\'s own layout box under zoom, whatever the probe concluded', () => {
    engine(100);
    const parent = document.createElement('div');
    zooms.set(parent, '0.5');
    const child = measured(document.createElement('div'), rect(10, 20, 30, 40));
    Object.defineProperty(child, 'offsetWidth', { value: 30 });
    parent.append(child);
    document.body.append(parent);
    const r = visualRect(child);
    expect([r.left, r.top, r.width, r.height]).toEqual([5, 10, 15, 20]);
  });

  it('keeps a screen-pixel reading whose width is the layout box times the zoom', () => {
    engine(100);
    const parent = document.createElement('div');
    zooms.set(parent, '0.5');
    const child = measured(document.createElement('div'), rect(10, 20, 15, 20));
    Object.defineProperty(child, 'offsetWidth', { value: 30 });
    parent.append(child);
    document.body.append(parent);
    const r = visualRect(child);
    expect([r.left, r.top, r.width, r.height]).toEqual([10, 20, 15, 20]);
  });

  it('defers to the probe when a transform sits between the element and its zoom', () => {
    engine(100);
    const parent = document.createElement('div');
    zooms.set(parent, '0.5');
    transforms.set(parent, 'matrix(1, 0, 0, 1, 0, 0)');
    const child = measured(document.createElement('div'), rect(10, 20, 30, 40));
    Object.defineProperty(child, 'offsetWidth', { value: 30 });
    parent.append(child);
    document.body.append(parent);
    const r = visualRect(child);
    expect([r.left, r.top, r.width, r.height]).toEqual([10, 20, 30, 40]);
  });

  it('treats a probe that cannot lay out as screen pixels', () => {
    engine(0);
    const parent = document.createElement('div');
    zooms.set(parent, '0.5');
    const child = measured(document.createElement('div'), rect(10, 20, 30, 40));
    parent.append(child);
    document.body.append(parent);
    expect(visualRect(child).left).toBe(10);
  });
});

describe('effectiveZoom', () => {
  it('multiplies every ancestor zoom and ignores unreadable values', () => {
    engine(200);
    const outer = document.createElement('div');
    zooms.set(outer, '0.5');
    const middle = document.createElement('div');
    zooms.set(middle, 'normal');
    const child = document.createElement('div');
    zooms.set(child, '2');
    middle.append(child);
    outer.append(middle);
    document.body.append(outer);
    expect(effectiveZoom(child)).toBe(1);
    expect(effectiveZoom(middle)).toBe(0.5);
  });
});
