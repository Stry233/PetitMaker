/**
 * resolveErrorFlashCells — the pure half of the error flash: resolves each
 * error's grid ('micro' terrain / 'macro' object, falling back to the
 * command-type default) and dedupes evidence cells so overlapping errors from
 * multiple rules don't stack alpha.
 */
import { describe, it, expect } from 'vitest';
import { errorFlashSignature, shouldFlashErrors, resolveErrorFlashCells } from '../../canvas/map2d/layers/error-flash';
import type { ValidationError } from '../../core/model/types';

function err(cells: { x: number; y: number }[], grid?: 'macro' | 'micro'): ValidationError {
  return { ruleId: 'T', message: 'test', cells, severity: 'error', ...(grid ? { grid } : {}) };
}

describe('resolveErrorFlashCells', () => {
  it('falls back to the command-type default when an error carries no grid', () => {
    expect(resolveErrorFlashCells([err([{ x: 1, y: 2 }])], true))
      .toEqual([{ x: 1, y: 2, micro: true }]);
    expect(resolveErrorFlashCells([err([{ x: 1, y: 2 }])], false))
      .toEqual([{ x: 1, y: 2, micro: false }]);
  });

  it('a per-error grid overrides the default, per error', () => {
    const out = resolveErrorFlashCells(
      [err([{ x: 1, y: 1 }], 'micro'), err([{ x: 2, y: 2 }])],
      false,
    );
    expect(out).toEqual([
      { x: 1, y: 1, micro: true },
      { x: 2, y: 2, micro: false },
    ]);
  });

  it('dedupes identical cells on the same grid, keeps same coord on different grids', () => {
    const out = resolveErrorFlashCells(
      [err([{ x: 3, y: 3 }, { x: 3, y: 3 }], 'macro'), err([{ x: 3, y: 3 }], 'macro'), err([{ x: 3, y: 3 }], 'micro')],
      false,
    );
    expect(out).toEqual([
      { x: 3, y: 3, micro: false },
      { x: 3, y: 3, micro: true },
    ]);
  });
});


describe('repeat-violation gate', () => {
  const cells = [{ x: 1, y: 1, micro: false }, { x: 2, y: 1, micro: false }];
  const sig = errorFlashSignature(cells);

  it('the same evidence within the cooldown does not retrigger (no strobing under a held brush)', () => {
    expect(shouldFlashErrors(null, sig, 1000, 900)).toBe(true);
    expect(shouldFlashErrors({ sig, at: 1000 }, sig, 1300, 900)).toBe(false);
    expect(shouldFlashErrors({ sig, at: 1000 }, sig, 1850, 900)).toBe(false);
  });

  it('the same evidence after the cooldown flashes again (a soft periodic reminder)', () => {
    expect(shouldFlashErrors({ sig, at: 1000 }, sig, 1901, 900)).toBe(true);
  });

  it('different evidence flashes immediately, regardless of timing', () => {
    const other = errorFlashSignature([{ x: 5, y: 5, micro: true }]);
    expect(shouldFlashErrors({ sig, at: 1000 }, other, 1050, 900)).toBe(true);
  });

  it('signatures distinguish grid, not just coordinates', () => {
    expect(errorFlashSignature([{ x: 1, y: 1, micro: true }]))
      .not.toBe(errorFlashSignature([{ x: 1, y: 1, micro: false }]));
  });
});
