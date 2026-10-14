/** The generation kinds' trait table is the one place a kind's behaviour is read from. */
import { describe, expect, it } from 'vitest';
import { GENERATE_KIND, fillTakesElevation, fillTakesItem, type GenerateKind } from '../../../../../ui/shell/bars/generate/generate-shelf';
import { isStencilKind, kindConfig } from '../../../../../tools/generation/kinds';
import { HELP_PAGES } from '../../../../../ui/help/catalog';
import { translations } from '../../../../../i18n/translations';

const KINDS = Object.keys(GENERATE_KIND) as GenerateKind[];

describe('generation kind traits', () => {
  it('give a stencil kind its materials and a built kind none', () => {
    for (const kind of KINDS) {
      const traits = GENERATE_KIND[kind];
      expect(isStencilKind(kind), kind).toBe(traits.input !== null);
      expect(traits.fills.length > 0, kind).toBe(traits.input !== null);
      expect(traits.algorithm === 'stencil', kind).toBe(traits.input !== null);
    }
  });

  it('name a tab, a Help page and an object material that exist', () => {
    for (const kind of KINDS) {
      const traits = GENERATE_KIND[kind];
      expect(translations.en[traits.labelKey], kind).toBeTruthy();
      expect(translations.en[traits.objectFillKey], kind).toBeTruthy();
      expect(HELP_PAGES[traits.helpPage], kind).toBeTruthy();
    }
  });

  it('let only a kind that picks an item ask for one, and a letter follow its base surface', () => {
    expect(KINDS.filter((kind) => fillTakesItem(kind, 'object'))).toEqual(KINDS.filter((kind) => GENERATE_KIND[kind].pickItem));
    for (const kind of KINDS.filter((k) => GENERATE_KIND[k].elevation === 'none')) {
      for (const fill of GENERATE_KIND[kind].fills) expect(fillTakesElevation(kind, fill)).toBe(false);
    }
  });

  it('carry entrance marks only for a kind with gates', () => {
    const gates = { entrance: { x: 1, y: 1 }, exit: { x: 2, y: 2 } } as never;
    const stencil = { width: 1, height: 1, coverage: new Uint8Array([255]), color: new Uint32Array(1) };
    const stencilPlan = { read: 'shape' as const, stencil, origin: { x: 0, y: 0 } };
    for (const kind of KINDS) {
      const config = kindConfig({
        kind, seed: 1, richness: 50, maxElevation: 3, corridorWidth: 1, gates, ...(isStencilKind(kind) ? { stencilPlan } : {}),
      });
      expect('mazeGates' in config, kind).toBe(GENERATE_KIND[kind].gates);
    }
  });
});
