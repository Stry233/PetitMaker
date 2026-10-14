import { describe, expect, it } from 'vitest';
import { LiteFrameBudget } from '../../../../view/map3d/scene/lite-frame-budget';

describe('Lite 3D fallback', () => {
  it('raises resolution only after sustained measured headroom and explicit eligibility', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 120 }, (_, i) => budget.sample(1000 + i * 16, 5, { overResources: true, canReduce: true, canIncrease: true }));
    expect(actions).toContain('increase');
    budget.reset();
    const busy = Array.from({ length: 120 }, (_, i) => budget.sample(1000 + i * 33, 20, { overResources: false, canReduce: true, canIncrease: true }));
    expect(busy).not.toContain('increase');
  });
  it('does not treat idle time as evidence for a resolution increase', () => {
    const budget = new LiteFrameBudget();
    const idle = { overResources: false, canReduce: true, continuous: false, canIncrease: true };
    for (let i = 0; i < 30; i++) expect(budget.sample(1000 + i * 500, 3, idle)).toBeNull();
  });
  it('keeps a responsive crowded map in 3D after quality reaches its minimum', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 600 }, (_, i) => budget.sample(1000 + i * 16, 5, { overResources: true, canReduce: false }));
    expect(actions.every(action => action === null)).toBe(true);
  });
  it('lowers quality when resource pressure coincides with missing the 30 FPS budget', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 120 }, (_, i) => budget.sample(1000 + i * 40, 35, { overResources: true, canReduce: true }));
    expect(actions).toContain('reduce');
    expect(actions).not.toContain('fallback');
  });
  it('preserves the chosen quality while a crowded scene remains responsive', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 600; i++) expect(budget.sample(1000 + i * 16, 5, { overResources: true, canReduce: true })).toBeNull();
  });
  it('falls back only after sustained slow frames at minimum quality', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 40 }, (_, i) => budget.sample(1000 + i * 80, 65, { overResources: false, canReduce: false }));
    expect(actions).toContain('fallback');
  });
  it.each([1000 / 30, 1000 / 15, 100, 250])('keeps responsive rendering in 3D with %s ms host callback intervals', (interval) => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 240 }, (_, i) => budget.sample(1000 + i * interval, 2, { overResources: true, canReduce: false, canIncrease: true }));
    expect(actions.every(action => action === null)).toBe(true);
  });
  it('reduces quality for slow delivery but stays in 3D once reductions are exhausted', () => {
    const budget = new LiteFrameBudget();
    let reductions = 3;
    const actions = Array.from({ length: 300 }, (_, i) => {
      const action = budget.sample(1000 + i * 80, 2, { overResources: false, canReduce: reductions > 0 });
      if (action === 'reduce') reductions--;
      return action;
    });
    expect(reductions).toBe(0);
    expect(actions).not.toContain('fallback');
  });
  it('requires sustained render cost rather than occasional slow renders in a throttled host', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 240 }, (_, i) => budget.sample(1000 + i * 100, i % 10 === 0 ? 80 : 3, { overResources: false, canReduce: false }));
    expect(actions).not.toContain('fallback');
  });
  it('clears render pressure after a pause or an idle redraw', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 12; i++) budget.sample(1000 + i * 80, 65, { overResources: false, canReduce: false });
    budget.reset();
    for (let i = 0; i < 12; i++) budget.sample(2000 + i * 80, 65, { overResources: false, canReduce: false });
    expect(budget.sample(3000, 2, { overResources: false, canReduce: false, continuous: false })).toBeNull();
    for (let i = 1; i < 120; i++) expect(budget.sample(3000 + i * 100, 2, { overResources: false, canReduce: false })).toBeNull();
  });
  it('ignores idle cursor redraw intervals and a single compilation stall', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 30; i++) expect(budget.sample(1000 + i * 500, 3, { overResources: false, canReduce: false, continuous: false })).toBeNull();
    budget.reset();
    expect(budget.sample(20000, 1000, { overResources: false, canReduce: false })).toBeNull();
    for (let i = 1; i < 160; i++) expect(budget.sample(21000 + i * 16, 5, { overResources: false, canReduce: false })).toBeNull();
  });
});

describe('the scene step', () => {
  let now = 1000;
  interface Run { n: number; interval: number; renderMs: number; lite: boolean; crowded?: boolean }
  const frames = (budget: LiteFrameBudget, { n, interval, renderMs, lite, crowded = false }: Run) =>
    Array.from({ length: n }, () => budget.step((now += interval), renderMs, {
      calls: crowded ? 101 : 10, triangles: 10, lite, continuous: true, canIncrease: () => true,
    }));

  it('enters lite before it lowers the scale, then lowers it to the floor and no further', () => {
    const budget = new LiteFrameBudget();
    expect(frames(budget, { n: 120, interval: 40, renderMs: 35, lite: false, crowded: true })).toContain('enter-lite');
    expect(budget.scale).toBe(1);
    for (let i = 0; i < 20; i++) frames(budget, { n: 120, interval: 40, renderMs: 35, lite: true, crowded: true });
    expect(budget.scale).toBe(0.5);
  });

  it('raises the scale on headroom up to its ceiling', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 40; i++) frames(budget, { n: 120, interval: 16, renderMs: 5, lite: true });
    expect(budget.scale).toBe(4);
  });
});
