// @vitest-environment jsdom
/**
 * The 2D plan-notes layer, headless: every note kind builds its own node without a GPU, the eye
 * hides the layer, an unchanged note keeps the node it has (its label raster included), an edited
 * one rebuilds only itself, and an arriving or leaving note fades rather than popping — skipped to
 * the end state under reduced motion, which is also what makes removal synchronous here.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Graphics, Text, type Container } from 'pixi.js-legacy';
import { AnnotationLayer } from '../../../../view/map2d/layers/annotation-layer';
import { setReducedMotion, __resetMotionState } from '../../../../platform/channels/motion-state';
import type { AnnotationsState, MeasureNote, ZoneNote } from '../../../../core/model/annotations';
import type { MacroCoord } from '../../../../core/model/types';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { ANNOTATION_LINE, annotationLineCells } from '../../../../view/shared/annotation/annotation-line';

const data = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }], color: '#FF8A7A', tag: 'homes', num: 1 },
    { kind: 'chip', id: 't1', x: 4.5, y: 4.5, tag: 'plaza', size: 'm', color: '#FFB347' },
    { kind: 'chip', id: 't2', x: 6, y: 6, tag: 'entrance', size: 'l', color: '#FFFEE3' },
    { kind: 'route', id: 'r1', points: [{ x: 1, y: 8 }, { x: 4, y: 8 }, { x: 6, y: 5 }], color: '#FFFEE3', dashed: true },
  ],
  visible: true,
  locked: false,
});

const OPTS = { draft: null, selectionIds: [] as string[], inkScale: 1, tagLabel: (tag: string) => tag };

const passes = (layer: AnnotationLayer) => ({
  wash: layer.container.children[0] as Container,
  route: layer.container.children[1] as Container,
  label: layer.container.children[2] as Container,
});

describe('AnnotationLayer', () => {
  beforeEach(() => setReducedMotion(true));
  afterEach(() => __resetMotionState());

  it('builds every kind into its pass', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw(data(), OPTS);
    const p = passes(layer);
    // A zone is its wash and its border.
    expect(p.wash.children).toHaveLength(2);
    expect(p.route.children).toHaveLength(1);
    // The zone's caption group plus the two chips.
    expect(p.label.children).toHaveLength(3);
    expect(layer.container.visible).toBe(true);
    layer.destroy();
  });

  it('draws and rebuilds a brush draft whose patches meet diagonally', () => {
    const layer = new AnnotationLayer(() => {});
    const draft: ZoneNote = {
      kind: 'zone', id: 'draft', num: 0, color: '#2FBF9B', tag: 'farm',
      cells: [{ x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 2 }],
    };
    layer.draw({ items: [], visible: true, locked: false }, { ...OPTS, draft });
    layer.draw({ items: [], visible: true, locked: false }, { ...OPTS, draft: { ...draft, cells: [...draft.cells, { x: 2, y: 1 }] } });
    expect(passes(layer).wash.children).toHaveLength(2);
    layer.destroy();
  });

  it('the eye hides the whole layer', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw({ ...data(), visible: false }, OPTS);
    expect(layer.container.visible).toBe(false);
    layer.draw(null, OPTS);
    expect(layer.container.visible).toBe(true);
    layer.destroy();
  });

  it('a draft draws like a committed note', () => {
    const layer = new AnnotationLayer(() => {});
    const draft: ZoneNote = { kind: 'zone', id: 'draft', cells: [{ x: 8, y: 8 }, { x: 9, y: 8 }], color: '#2FBF9B', tag: 'farm', num: 5 };
    layer.draw({ items: [], visible: true, locked: false }, { ...OPTS, draft });
    expect(passes(layer).wash.children).toHaveLength(2);
    layer.destroy();
  });

  it('an unchanged note keeps its node; an edited one rebuilds only itself; a removed one goes', () => {
    const layer = new AnnotationLayer(() => {});
    const d = data();
    layer.draw(d, OPTS);
    const before = [...passes(layer).label.children];
    layer.draw(d, OPTS);
    expect([...passes(layer).label.children]).toEqual(before);
    const edited = { ...d, items: d.items.map((n) => (n.id === 't1' ? { ...n, tag: 'farm' } : n)) };
    layer.draw(edited as AnnotationsState, OPTS);
    const after = [...passes(layer).label.children];
    expect(after).toHaveLength(3);
    expect(after.filter((n) => before.includes(n))).toHaveLength(2);
    layer.draw({ ...d, items: d.items.filter((n) => n.id !== 't1') }, OPTS);
    expect(passes(layer).label.children).toHaveLength(2);
    layer.destroy();
  });

  it('refreshes existing tags when their translation changes without editing the notes', () => {
    const layer = new AnnotationLayer(() => {});
    const notes = data();
    let language = 'en';
    const opts = { ...OPTS, tagLabel: (tag: string) => `${language}:${tag}` };
    layer.draw(notes, opts);
    const previousLabels = [...passes(layer).label.children];
    const route = passes(layer).route.children[0];
    language = 'zh';
    layer.draw(notes, opts);
    const labels = [...passes(layer).label.children] as Container[];
    expect(labels.every((label) => !previousLabels.includes(label))).toBe(true);
    expect(labels.flatMap((label) => label.children.filter((child): child is Text => child instanceof Text).map((text) => text.text)))
      .toEqual(['1', 'zh:homes', 'zh:plaza', 'zh:entrance']);
    expect(passes(layer).route.children[0]).toBe(route);
    layer.draw(notes, { ...opts, tagLabel: (tag) => `zh:${tag}` });
    expect(passes(layer).label.children).toEqual(labels);
    layer.destroy();
  });

  it('with motion on, a removed note LEAVES: its node stands while its fade runs', () => {
    setReducedMotion(false);
    const layer = new AnnotationLayer(() => {});
    const d = data();
    layer.draw(d, OPTS);
    layer.draw({ ...d, items: d.items.filter((n) => n.id !== 't1') }, OPTS);
    // Still mounted mid-fade — the tick, not the draw, is what retires it.
    expect(passes(layer).label.children).toHaveLength(3);
    layer.destroy();
  });

  it('a numbered zone caption carries the disc, its digit and the tag label', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw(data(), OPTS);
    const withNum = passes(layer).label.children[0] as Container;
    expect(withNum.children).toHaveLength(3);
    layer.destroy();
  });

  it('closes the selected chip outline along its left edge', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw(data(), { ...OPTS, selectionIds: ['t1'] });
    const chip = passes(layer).label.children[1] as Container;
    const outline = chip.children[2] as Graphics;
    outline.getLocalBounds();
    const shapes = outline.geometry.graphicsData.map((entry) => entry.shape as { points: number[]; closeStroke: boolean });
    const left = Math.min(...shapes.flatMap((shape) => shape.points.filter((_, i) => i % 2 === 0)));
    // Each frame is one closed path, so its left edge is a real side joined at both corners.
    expect(shapes.every((shape) => shape.closeStroke)).toBe(true);
    expect(shapes.every((shape) => shape.points.filter((x, i) => i % 2 === 0 && x === left).length >= 2)).toBe(true);
    layer.destroy();
  });

  it('centers trimmed glyph ink on the chip and number-disc centers', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw(data(), OPTS);
    const caption = passes(layer).label.children[0] as Container;
    const digit = caption.children[1] as Text;
    const disc = (caption.children[0] as Graphics).geometry.graphicsData[0]!.shape as { y: number };
    expect(digit.style.trim).toBe(true);
    expect(digit.y).toBe(disc.y);
    const chip = passes(layer).label.children[1] as Container;
    const text = chip.children[1] as Text;
    const plate = (chip.children[0] as Graphics).geometry.graphicsData[0]!.shape as { y: number; height: number };
    expect(text.style.trim).toBe(true);
    expect(text.y).toBe(plate.y + plate.height / 2);
    layer.destroy();
  });

  it('the zone caption sizes with the note, not the arming', () => {
    const layer = new AnnotationLayer(() => {});
    const d = data();
    layer.draw(d, OPTS);
    const m = (passes(layer).label.children[0] as Container).getLocalBounds().height;
    const zone = { ...d.items.find((n) => n.id === 'z1')!, size: 'l' as const };
    layer.draw({ ...d, items: d.items.map((n) => (n.id === 'z1' ? zone : n)) }, OPTS);
    const l = (passes(layer).label.children[0] as Container).getLocalBounds().height;
    expect(l).toBeGreaterThan(m);
    layer.destroy();
  });

  it('draws every line in one width and restrokes them in place only past the zoom drift', () => {
    const layer = new AnnotationLayer(() => {});
    const measure: MeasureNote = { kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 1, y: 4 }, { x: 9, y: 4 }] as [MacroCoord, MacroCoord] };
    layer.draw({ ...data(), items: [...data().items, measure] }, OPTS);
    const lines = () => {
      const p = passes(layer);
      const dims = (p.label.children[p.label.children.length - 1] as Container).children[0] as Graphics;
      return [p.wash.children[1] as Graphics, p.route.children[0] as Graphics, dims];
    };
    const widths = (g: Graphics) => [
      ...new Set(g.geometry.graphicsData.filter((d) => d.lineStyle.width > 0).map((d) => d.lineStyle.width))
    ].sort((a, b) => a - b);
    const expected = (cellPx: number) => {
      const w = annotationLineCells(cellPx) * TILE_SIZE;
      return [w, w * ANNOTATION_LINE.halo.scale];
    };
    const before = lines();
    for (const g of before.slice(0, 1).concat(before.slice(2))) {
      for (const [i, w] of widths(g).entries()) expect(w).toBeCloseTo(expected(TILE_SIZE)[i]!);
    }
    layer.setCellPixels(TILE_SIZE * 1.02);
    expect(widths(before[0]!)[0]).toBeCloseTo(expected(TILE_SIZE)[0]!);
    layer.setCellPixels(8);
    expect(lines()).toEqual(before);
    for (const g of [before[0]!, before[2]!]) {
      for (const [i, w] of widths(g).entries()) expect(w).toBeCloseTo(expected(8)[i]!);
    }
    expect(widths(before[1]!)).toContain(expected(8)[0]);
    layer.setCellPixels(8 * 1.02, true);
    expect(widths(before[0]!)[0]).toBeCloseTo(expected(8 * 1.02)[0]!);
    layer.destroy();
  });

  it('strokes each zone outline as one closed path', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw(data(), OPTS);
    const border = passes(layer).wash.children[1] as Graphics;
    const strokes = border.geometry.graphicsData.filter((d) => d.lineStyle.width > 0);
    // The halo and the line, each one closed polygon round the L.
    expect(strokes).toHaveLength(2);
    expect(strokes.every((d) => (d.shape as { closeStroke?: boolean }).closeStroke)).toBe(true);
    layer.destroy();
  });

  it('the ink scales with the map, so a big template draws readable notes', () => {
    const layer = new AnnotationLayer(() => {});
    layer.draw(data(), OPTS);
    const small = (passes(layer).label.children[1] as Container).getLocalBounds().height;
    layer.draw(data(), { ...OPTS, inkScale: 3 });
    const big = (passes(layer).label.children[1] as Container).getLocalBounds().height;
    expect(big).toBeGreaterThan(small * 2);
    layer.destroy();
  });
});

it('renders the inclusive measurement and live region extents as numeric labels', () => {
  const layer = new AnnotationLayer(() => {});
  setReducedMotion(true);
  layer.draw({ items: [{ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 1, y: 4 }, { x: 84, y: 4 }] }], visible: true, locked: false }, OPTS);
  const texts = (node: Container): string[] => node instanceof Text ? [node.text] : node.children.flatMap(child => texts(child as Container));
  expect(texts(layer.container)).toEqual(['84']);
  const zone: ZoneNote = { kind: 'zone', id: 'z', color: '#FFB347', cells: [{ x: 1, y: 1 }, { x: 5, y: 3 }], tag: null, num: 0 };
  layer.draw(null, { ...OPTS, draft: zone });
  expect(texts(layer.container)).toEqual(['5', '3']);
  layer.draw({ items: [zone], visible: true, locked: false }, OPTS);
  expect(texts(layer.container)).toEqual([]);
  layer.destroy(); __resetMotionState();
});

it('omits a zone width and height when dimensions are hidden, and brings them back when shown', () => {
  const layer = new AnnotationLayer(() => {});
  setReducedMotion(true);
  const texts = (node: Container): string[] => node instanceof Text ? [node.text] : node.children.flatMap(child => texts(child as Container));
  const zone: ZoneNote = { kind: 'zone', id: 'z', color: '#FFB347', cells: [{ x: 1, y: 1 }, { x: 5, y: 3 }], tag: null, num: 0 };
  layer.draw({ items: [zone], visible: true, locked: false }, { ...OPTS, selectionIds: ['z'], zoneDimensions: false });
  expect(texts(layer.container)).toEqual([]);
  layer.draw({ items: [zone], visible: true, locked: false }, { ...OPTS, selectionIds: ['z'], zoneDimensions: true });
  expect(texts(layer.container)).toEqual(['5', '3']);
  layer.draw(null, { ...OPTS, draft: zone, zoneDimensions: false });
  expect(texts(layer.container)).toEqual([]);
  layer.destroy(); __resetMotionState();
});

it('draws a zone with no text without its caption, in both views', async () => {
  const { AnnotationLayer3D } = await import('../../../../view/map3d/layers/annotation-layer');
  const { makeState } = await import('../../../_support/map-state');
  const layer = new AnnotationLayer(() => {});
  setReducedMotion(true);
  const zone: ZoneNote = { kind: 'zone', id: 'z', color: '#FFB347', cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], tag: 'homes', num: 4, size: 'none' };
  layer.draw({ items: [zone], visible: true, locked: false }, OPTS);
  expect(passes(layer).label.children).toHaveLength(0);
  expect(passes(layer).wash.children).toHaveLength(2);
  layer.draw({ items: [{ ...zone, size: 'm' }], visible: true, locked: false }, OPTS);
  expect(passes(layer).label.children).toHaveLength(1);
  layer.destroy(); __resetMotionState();
  const scene = new AnnotationLayer3D();
  scene.update(makeState(12, 12), { items: [zone], visible: true, locked: false }, { draft: null, tagLabel: (tag: string) => tag });
  expect(scene.group.children.some((node) => node.type === 'Sprite')).toBe(false);
  scene.dispose();
});

it('widens a route line, its halo and its arrowhead together with its width', () => {
  setReducedMotion(true);
  const shape = (width?: number) => {
    const layer = new AnnotationLayer(() => {});
    layer.draw({ items: [{ kind: 'route', id: 'r', points: [{ x: 1, y: 8 }, { x: 9, y: 8 }], color: '#FFB347', dashed: false, ...(width ? { width } : {}) }], visible: true, locked: false }, OPTS);
    const g = passes(layer).route.children[0] as Graphics;
    const lines = [
      ...new Set(g.geometry.graphicsData.filter((d) => d.lineStyle.width > 0 && d.fillStyle.visible === false).map((d) => d.lineStyle.width))
    ].sort((a, b) => a - b);
    const head = g.geometry.graphicsData.find((d) => d.fillStyle.visible)!.shape as { points: number[] };
    const xs = head.points.filter((_, i) => i % 2 === 0);
    const out = { lines, head: Math.max(...xs) - Math.min(...xs) };
    layer.destroy();
    return out;
  };
  const one = shape(), three = shape(3);
  expect(three.lines.map((w, i) => w / one.lines[i]!)).toEqual([3, 3]);
  expect(three.head / one.head).toBeCloseTo(3);
  __resetMotionState();
});

it.each([['far', 3.2], ['default', 7], ['near', 40]] as const)('leaves a clear gap between drawn dashes at %s zoom', (_name, cellPx) => {
  setReducedMotion(true);
  const layer = new AnnotationLayer(() => {});
  layer.draw({ items: [{ kind: 'route', id: 'r', points: [{ x: 1, y: 8 }, { x: 60, y: 8 }], color: '#FFB347', dashed: true }], visible: true, locked: false }, OPTS);
  layer.setCellPixels(cellPx, true);
  const g = passes(layer).route.children[0] as Graphics;
  const halo = g.geometry.graphicsData.filter((d) => d.lineStyle.width > 0 && !d.fillStyle.visible);
  const haloWidth = Math.max(...halo.map((d) => d.lineStyle.width));
  const runs = halo.filter((d) => d.lineStyle.width === haloWidth).map((d) => (d.shape as { points: number[] }).points);
  expect(runs.length).toBeGreaterThan(3);
  const zoom = cellPx / TILE_SIZE;
  const line = haloWidth / ANNOTATION_LINE.halo.scale;
  for (let i = 1; i < runs.length; i++) {
    const end = runs[i - 1]!, start = runs[i]!;
    // World px between two runs, less the halo caps' reach, as css px on screen.
    const clear = (Math.hypot(start[0]! - end[end.length - 2]!, start[1]! - end[end.length - 1]!) - haloWidth) * zoom;
    expect(clear).toBeGreaterThanOrEqual(1.5 * line * zoom - 1e-6);
  }
  layer.destroy(); __resetMotionState();
});
