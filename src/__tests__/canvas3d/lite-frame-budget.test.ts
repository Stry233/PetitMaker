import { describe, expect, it } from 'vitest';
import { LiteFrameBudget } from '../../canvas/map3d/scene/lite-frame-budget';

describe('Lite 3D fallback', () => {
  it('raises resolution only after sustained measured headroom and explicit eligibility', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 120 }, (_, i) => budget.sample(1000 + i * 16, 5, true, true, true, true));
    expect(actions).toContain('increase');
    budget.reset();
    const busy = Array.from({ length: 120 }, (_, i) => budget.sample(1000 + i * 33, 20, false, true, true, true));
    expect(busy).not.toContain('increase');
  });
  it('does not treat idle time as evidence for a resolution increase', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 30; i++) expect(budget.sample(1000 + i * 500, 3, false, true, false, true)).toBeNull();
  });
  it('keeps a responsive crowded map in 3D after quality reaches its minimum', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 600 }, (_, i) => budget.sample(1000 + i * 16, 5, true, false));
    expect(actions.every(action => action === null)).toBe(true);
  });
  it('lowers quality when resource pressure coincides with missing the 30 FPS budget', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 120 }, (_, i) => budget.sample(1000 + i * 40, 35, true, true));
    expect(actions).toContain('reduce');
    expect(actions).not.toContain('fallback');
  });
  it('preserves the chosen quality while a crowded scene remains responsive', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 600; i++) expect(budget.sample(1000 + i * 16, 5, true, true)).toBeNull();
  });
  it('falls back only after sustained slow frames at minimum quality', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 40 }, (_, i) => budget.sample(1000 + i * 80, 65, false, false));
    expect(actions).toContain('fallback');
  });
  it.each([1000 / 30, 1000 / 15, 100, 250])('keeps responsive rendering in 3D with %s ms host callback intervals', (interval) => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 240 }, (_, i) => budget.sample(1000 + i * interval, 2, true, false, true, true));
    expect(actions.every(action => action === null)).toBe(true);
  });
  it('reduces quality for slow delivery but stays in 3D once reductions are exhausted', () => {
    const budget = new LiteFrameBudget();
    let reductions = 3;
    const actions = Array.from({ length: 300 }, (_, i) => {
      const action = budget.sample(1000 + i * 80, 2, false, reductions > 0);
      if (action === 'reduce') reductions--;
      return action;
    });
    expect(reductions).toBe(0);
    expect(actions).not.toContain('fallback');
  });
  it('requires sustained render cost rather than occasional slow renders in a throttled host', () => {
    const budget = new LiteFrameBudget();
    const actions = Array.from({ length: 240 }, (_, i) => budget.sample(1000 + i * 100, i % 10 === 0 ? 80 : 3, false, false));
    expect(actions).not.toContain('fallback');
  });
  it('clears render pressure after a pause or an idle redraw', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 12; i++) budget.sample(1000 + i * 80, 65, false, false);
    budget.reset();
    for (let i = 0; i < 12; i++) budget.sample(2000 + i * 80, 65, false, false);
    expect(budget.sample(3000, 2, false, false, false)).toBeNull();
    for (let i = 1; i < 120; i++) expect(budget.sample(3000 + i * 100, 2, false, false)).toBeNull();
  });
  it('ignores idle cursor redraw intervals and a single compilation stall', () => {
    const budget = new LiteFrameBudget();
    for (let i = 0; i < 30; i++) expect(budget.sample(1000 + i * 500, 3, false, false, false)).toBeNull();
    budget.reset();
    expect(budget.sample(20000, 1000, false, false)).toBeNull();
    for (let i = 1; i < 160; i++) expect(budget.sample(21000 + i * 16, 5, false, false)).toBeNull();
  });
});
