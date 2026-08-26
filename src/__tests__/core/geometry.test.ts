/**
 * `largestComponent`, pinned where it is actually reachable.
 *
 * The golden hashes cannot stand in for these: at their 64x64 scale the generator never reaches
 * `carveCrown`, so the function is called zero times and every hash stays green with the search
 * broken. It is called 42 times on a real-scale map, and it is the reason a terrace has one summit
 * rather than two, so it earns its own pins.
 */
import { describe, expect, it } from 'vitest';
import { largestComponent } from '../../core/model/geometry';

const W = 10;
const idx = (x: number, y: number): number => y * W + x;

describe('largestComponent', () => {
  it('keeps the largest component, not the first one found', () => {
    // A 1-cell island BEFORE a 3-cell run in input order: a search that returned the first
    // component it completed would answer with the island.
    const island = [idx(1, 1)];
    const run = [idx(5, 5), idx(6, 5), idx(7, 5)];
    expect(largestComponent([...island, ...run], W).sort((a, b) => a - b)).toEqual(run);
  });

  it('walks all four orthogonal neighbours', () => {
    // A plus centred at (5,5): each arm is reachable only through one of the four steps, so a
    // dropped direction leaves the centre in a component of 4 instead of 5 and the answer becomes
    // one of the arms.
    const plus = [idx(5, 5), idx(4, 5), idx(6, 5), idx(5, 4), idx(5, 6)];
    expect(largestComponent(plus, W).length).toBe(5);
  });

  it('a diagonal touch is not a connection', () => {
    // 4-connected, so two cells meeting at a corner are two components of one.
    expect(largestComponent([idx(2, 2), idx(3, 3)], W).length).toBe(1);
  });

  it('an empty set has no component', () => {
    expect(largestComponent([], W)).toEqual([]);
  });
});
