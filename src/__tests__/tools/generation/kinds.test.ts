/** The generation kinds' engine table is the one place a kind's algorithm, materials and knobs are read from. */
import { describe, expect, it } from 'vitest';
import { KIND_ENGINE, fillTakesElevation, fillTakesItem, isStencilKind, kindConfig, kindNeeds, type GenerateKind } from '../../../tools/generation/kinds';

const KINDS = Object.keys(KIND_ENGINE) as GenerateKind[];

describe('generation kind traits', () => {
  it('give a stencil kind its materials and a built kind none', () => {
    for (const kind of KINDS) {
      const traits = KIND_ENGINE[kind];
      expect(isStencilKind(kind), kind).toBe(traits.input !== null);
      expect(traits.fills.length > 0, kind).toBe(traits.input !== null);
      expect(traits.algorithm === 'stencil', kind).toBe(traits.input !== null);
    }
  });

  it('let only a kind that picks an item ask for one, and a letter follow its base surface', () => {
    expect(KINDS.filter((kind) => fillTakesItem(kind, 'object'))).toEqual(KINDS.filter((kind) => KIND_ENGINE[kind].pickItem));
    for (const kind of KINDS.filter((k) => KIND_ENGINE[k].elevation === 'none')) {
      for (const fill of KIND_ENGINE[kind].fills) expect(fillTakesElevation(kind, fill)).toBe(false);
    }
  });

  it('ask the build for a capability only where a kind reads an input', () => {
    for (const kind of KINDS) expect(kindNeeds(kind) !== null, kind).toBe(KIND_ENGINE[kind].input !== null);
  });

  it('carry entrance marks only for a kind with gates', () => {
    const gates = { entrance: { x: 1, y: 1 }, exit: { x: 2, y: 2 } } as never;
    const stencil = { width: 1, height: 1, coverage: new Uint8Array([255]), color: new Uint32Array(1) };
    const stencilPlan = { read: 'shape' as const, stencil, origin: { x: 0, y: 0 } };
    for (const kind of KINDS) {
      const config = kindConfig({
        kind, seed: 1, richness: 50, maxElevation: 3, corridorWidth: 1, gates, ...(isStencilKind(kind) ? { stencilPlan } : {}),
      });
      expect('mazeGates' in config, kind).toBe(KIND_ENGINE[kind].gates);
    }
  });
});
