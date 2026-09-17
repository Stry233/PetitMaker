/**
 * The 2D plan-notes layer, headless: every note kind builds its own node without a GPU, the eye
 * hides the layer, an unchanged note keeps the node it has (its label raster included), an edited
 * one rebuilds only itself, and an arriving or leaving note FADES rather than popping — skipped to
 * the end state under reduced motion, which is also what makes removal synchronous here.
 */
import './_pixi-env';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Graphics, Text, type Container } from 'pixi.js-legacy';
import { AnnotationLayer } from '../../canvas/map2d/layers/annotation-layer';
import { setReducedMotion, __resetMotionState } from '../../canvas/map2d/motion-state';
import type { AnnotationsState, ZoneNote } from '../../core/model/annotations';

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
    const layer = new AnnotationLayer();
    layer.draw(data(), OPTS);
    const p = passes(layer);
    expect(p.wash.children).toHaveLength(1);
    expect(p.route.children).toHaveLength(1);
    // The zone's caption group plus the two chips.
    expect(p.label.children).toHaveLength(3);
    expect(layer.container.visible).toBe(true);
    layer.destroy();
  });

  it('draws and rebuilds a brush draft whose patches meet diagonally', () => {
    const layer = new AnnotationLayer();
    const draft: ZoneNote = {
      kind: 'zone', id: 'draft', num: 0, color: '#2FBF9B', tag: 'farm',
      cells: [{ x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 2 }],
    };
    layer.draw({ items: [], visible: true, locked: false }, { ...OPTS, draft });
    layer.draw({ items: [], visible: true, locked: false }, { ...OPTS, draft: { ...draft, cells: [...draft.cells, { x: 2, y: 1 }] } });
    expect(passes(layer).wash.children).toHaveLength(1);
    layer.destroy();
  });

  it('the eye hides the whole layer', () => {
    const layer = new AnnotationLayer();
    layer.draw({ ...data(), visible: false }, OPTS);
    expect(layer.container.visible).toBe(false);
    layer.draw(null, OPTS);
    expect(layer.container.visible).toBe(true);
    layer.destroy();
  });

  it('a draft draws like a committed note', () => {
    const layer = new AnnotationLayer();
    const draft: ZoneNote = { kind: 'zone', id: 'draft', cells: [{ x: 8, y: 8 }, { x: 9, y: 8 }], color: '#2FBF9B', tag: 'farm', num: 5 };
    layer.draw({ items: [], visible: true, locked: false }, { ...OPTS, draft });
    expect(passes(layer).wash.children).toHaveLength(1);
    layer.destroy();
  });

  it('an unchanged note keeps its node; an edited one rebuilds only itself; a removed one goes', () => {
    const layer = new AnnotationLayer();
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
    const layer = new AnnotationLayer();
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
    const layer = new AnnotationLayer();
    const d = data();
    layer.draw(d, OPTS);
    layer.draw({ ...d, items: d.items.filter((n) => n.id !== 't1') }, OPTS);
    // Still mounted mid-fade — the tick, not the draw, is what retires it.
    expect(passes(layer).label.children).toHaveLength(3);
    layer.destroy();
  });

  it('a numbered zone caption carries the disc, its digit and the tag label', () => {
    const layer = new AnnotationLayer();
    layer.draw(data(), OPTS);
    const withNum = passes(layer).label.children[0] as Container;
    expect(withNum.children).toHaveLength(3);
    layer.destroy();
  });

  it('closes the selected chip outline along its left edge', () => {
    const layer = new AnnotationLayer();
    layer.draw(data(), { ...OPTS, selectionIds: ['t1'] });
    const chip = passes(layer).label.children[1] as Container;
    const outline = chip.children[2] as Graphics;
    outline.getLocalBounds();
    const paths = outline.geometry.graphicsData.map((entry) => (entry.shape as { points?: number[] }).points ?? []);
    const left = Math.min(...paths.flatMap((points) => points.filter((_, i) => i % 2 === 0)));
    expect(paths.some((points) => points.some((x, i) => i % 2 === 0 && i + 3 < points.length
      && x === left && points[i + 2] === left && points[i + 1] !== points[i + 3]))).toBe(true);
    layer.destroy();
  });

  it('centers trimmed glyph ink on the chip and number-disc centers', () => {
    const layer = new AnnotationLayer();
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
    const layer = new AnnotationLayer();
    const d = data();
    layer.draw(d, OPTS);
    const m = (passes(layer).label.children[0] as Container).getLocalBounds().height;
    const zone = { ...d.items.find((n) => n.id === 'z1')!, size: 'l' as const };
    layer.draw({ ...d, items: d.items.map((n) => (n.id === 'z1' ? zone : n)) }, OPTS);
    const l = (passes(layer).label.children[0] as Container).getLocalBounds().height;
    expect(l).toBeGreaterThan(m);
    layer.destroy();
  });

  it('the ink scales with the map, so a big template draws readable notes', () => {
    const layer = new AnnotationLayer();
    layer.draw(data(), OPTS);
    const small = (passes(layer).label.children[1] as Container).getLocalBounds().height;
    layer.draw(data(), { ...OPTS, inkScale: 3 });
    const big = (passes(layer).label.children[1] as Container).getLocalBounds().height;
    expect(big).toBeGreaterThan(small * 2);
    layer.destroy();
  });
});
