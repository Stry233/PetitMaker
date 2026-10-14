import { describe, it, expect } from 'vitest';
import { AnchorChain, ShapeGesture } from '../../../../tools/pointer/paint/gestures';

/** The longest gap, in ms between releases, that still reads as a double click. */
const CHAIN_DOUBLE_CLICK_MS = 400;

const at = (x: number, y: number) => ({ x, y });

/** A chain on a clock the test moves. */
function chain() {
  let time = 0;
  const c = new AnchorChain(() => time);
  const click = (x: number, y: number) => { c.down(at(x, y)); return c.up(at(x, y)); };
  return { c, click, wait: (ms: number) => { time += ms; } };
}

describe('AnchorChain', () => {
  it('drops an anchor per click and finishes on a second click on the same cell', () => {
    const { c, click, wait } = chain();
    expect(click(1, 1)).toBe('standing');
    wait(500);
    expect(click(5, 1)).toBe('standing');
    wait(100);
    expect(click(5, 1)).toBe('finish');
    expect(c.points).toEqual([at(1, 1), at(5, 1)]);
  });

  it('does not finish on a second click after the double-click window, or with one anchor', () => {
    const { c, click, wait } = chain();
    click(1, 1);
    wait(50);
    expect(click(1, 1), 'one anchor cannot finish').toBe('standing');
    click(4, 4);
    wait(CHAIN_DOUBLE_CLICK_MS + 1);
    expect(click(4, 4)).toBe('standing');
    expect(c.length).toBe(2);
  });

  it('measures the double-click window between release timestamps, however late each handler runs', () => {
    const { c, wait } = chain();
    c.down(at(1, 1)); c.up(at(1, 1), 1000);
    c.down(at(5, 1)); c.up(at(5, 1), 1500);
    wait(5000);
    c.down(at(5, 1));
    expect(c.up(at(5, 1), 1500 + CHAIN_DOUBLE_CLICK_MS - 50), 'taps inside the window on the event clock').toBe('finish');
  });

  it('refuses a pair whose release timestamps fall outside the window, however fast the handlers run', () => {
    const { c } = chain();
    c.down(at(1, 1)); c.up(at(1, 1), 0);
    c.down(at(5, 1)); c.up(at(5, 1), 100);
    c.down(at(5, 1));
    expect(c.up(at(5, 1), 100 + CHAIN_DOUBLE_CLICK_MS + 1)).toBe('standing');
  });

  it('drops the second anchor where a press dragged out from the first is released', () => {
    const { c } = chain();
    c.down(at(1, 1));
    expect(c.up(at(6, 2))).toBe('standing');
    expect(c.points).toEqual([at(1, 1), at(6, 2)]);
  });

  it('moves a placed anchor on a drag, which never counts toward a double-click', () => {
    const { c, click, wait } = chain();
    click(1, 1); click(5, 1);
    wait(500);
    c.down(at(5, 1));
    expect(c.dragging).toBe(true);
    expect(c.move(at(5, 3))).toBe(true);
    expect(c.up(at(5, 3))).toBe('standing');
    wait(50);
    expect(click(5, 3), 'the drag was not the first click of a pair').toBe('standing');
    expect(c.points).toEqual([at(1, 1), at(5, 3)]);
  });

  it('takes back only the anchor a cancelled press dropped', () => {
    const { c, click } = chain();
    click(1, 1); click(5, 1);
    c.down(at(9, 9));
    c.cancelPress();
    expect(c.points).toEqual([at(1, 1), at(5, 1)]);
    c.down(at(5, 1));
    c.cancelPress();
    expect(c.points, 'a cancelled drag of a placed anchor keeps it').toEqual([at(1, 1), at(5, 1)]);
    expect(c.dragging).toBe(false);
  });

  it('steps back one anchor at a time, and forgets the click a step took back', () => {
    const { c, click, wait } = chain();
    click(1, 1); click(5, 1); click(8, 1);
    expect(c.undoStep()).toBe(true);
    expect(c.points).toEqual([at(1, 1), at(5, 1)]);
    wait(10);
    expect(click(8, 1)).toBe('standing');
    c.clear();
    expect(c.undoStep()).toBe(false);
  });
});

describe('the dragged figure', () => {
  it('lays nothing before its press, and snaps the end only while constrain is held', () => {
    const d = new ShapeGesture().drag;
    expect(d.active).toBe(false);
    expect(d.cells('rect', at(3, 3), 1)).toEqual([]);
    d.begin(at(0, 0));
    expect(d.end(at(4, 1), 'rect', false)).toEqual(at(4, 1));
    expect(d.end(at(4, 1), 'rect', true)).toEqual(at(4, 4));
    expect(d.cells('rect', at(1, 1), 1)).toHaveLength(4);
    expect(d.spans('rect', at(1, 1))).toEqual([{ x: 0, y: 0, w: 2 }, { x: 0, y: 1, w: 2 }]);
    d.clear();
    expect(d.active).toBe(false);
  });
});

describe('ShapeGesture', () => {
  it('sweeps a freehand press into an edge-connected band, once per new cell', () => {
    const g = new ShapeGesture();
    expect(g.sweep(at(3, 0), 1)).toBeNull();
    g.beginFree(at(0, 0));
    expect(g.sweep(at(0, 0), 1)).toBeNull();
    expect(g.sweep(at(2, 1), 1)).toEqual([at(0, 0), at(1, 0), at(1, 1), at(2, 1)]);
    expect(g.endFree()).toEqual(at(2, 1));
    expect(g.freehand).toBe(false);
  });

  it('shows the hover footprint, the dragged figure and the curve run on to the pointer', () => {
    const g = new ShapeGesture();
    expect(g.ghost(at(4, 4), 'rect', 3, false)).toEqual({ cells: [at(4, 4)], at: at(4, 4) });
    g.drag.begin(at(0, 0));
    expect(g.ghost(at(1, 1), 'rect', 3, false)).toEqual({ spans: [{ x: 0, y: 0, w: 2 }, { x: 0, y: 1, w: 2 }], at: at(1, 1) });
    expect(g.releaseFigure(at(2, 0), 'line', 1, false)).toEqual({ cells: [at(0, 0), at(1, 0), at(2, 0)], end: at(2, 0) });
    expect(g.releaseFigure(at(2, 0), 'line', 1, false)).toBeNull();
    g.chain.down(at(0, 0));
    g.chain.up(at(0, 0));
    expect('cells' in g.ghost(at(3, 0), 'curve', 1, false)).toBe(true);
    g.clear();
    expect(g.chain.length).toBe(0);
  });
});
