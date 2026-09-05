/**
 * The 2D plan-notes layer, headless: every note kind builds its own node without a GPU, the eye
 * hides the layer, an unchanged note keeps the node it has (its label raster included), an edited
 * one rebuilds only itself, and an arriving or leaving note FADES rather than popping — skipped to
 * the end state under reduced motion, which is also what makes removal synchronous here.
 */
import './_pixi-env';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Container } from 'pixi.js-legacy';
import { AnnotationLayer } from '../../canvas/map2d/layers/annotation-layer';
import { setReducedMotion, __resetMotionState } from '../../canvas/map2d/motion-state';
import type { AnnotationsState, ZoneNote } from '../../core/model/annotations';

const data = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }], color: '#FF8A7A', name: '住宅区', num: 1 },
    { kind: 'text', id: 't1', x: 4.5, y: 4.5, text: '中心广场', style: 'chip', size: 'm', color: '#FFB347' },
    { kind: 'text', id: 't2', x: 6, y: 6, text: '入口', style: 'label', size: 'l', color: '#FFFEE3' },
    { kind: 'route', id: 'r1', points: [{ x: 1, y: 8 }, { x: 4, y: 8 }, { x: 6, y: 5 }], color: '#FFFEE3', dashed: true },
  ],
  visible: true,
  locked: false,
});

const OPTS = { draft: null, selectionIds: [] as string[], inkScale: 1 };

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
    // The zone's label group plus the two text notes.
    expect(p.label.children).toHaveLength(3);
    expect(layer.container.visible).toBe(true);
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
    const draft: ZoneNote = { kind: 'zone', id: 'draft', cells: [{ x: 8, y: 8 }, { x: 9, y: 8 }], color: '#2FBF9B', name: '', num: 5 };
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
    const edited = { ...d, items: d.items.map((n) => (n.id === 't1' ? { ...n, text: '新广场' } : n)) };
    layer.draw(edited as AnnotationsState, OPTS);
    const after = [...passes(layer).label.children];
    expect(after).toHaveLength(3);
    expect(after.filter((n) => before.includes(n))).toHaveLength(2);
    layer.draw({ ...d, items: d.items.filter((n) => n.id !== 't1') }, OPTS);
    expect(passes(layer).label.children).toHaveLength(2);
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

  it('a numbered zone caption carries the disc, its digit and the name', () => {
    const layer = new AnnotationLayer();
    layer.draw(data(), OPTS);
    const withNum = passes(layer).label.children[0] as Container;
    expect(withNum.children).toHaveLength(3);
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
