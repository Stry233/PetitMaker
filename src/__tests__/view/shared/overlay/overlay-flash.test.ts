/**
 * The pure half of the flashes, shared by both views: what each one covers and on which grid.
 * An error resolves to cells on the grid it names, deduped so overlapping rules don't stack alpha — or, where the cause
 * is an object, to the exact body it accuses, which whole cells can only round out from. An
 * undo/redo resolves to everything the step changed, each part on its own grid.
 */
import { describe, it, expect } from 'vitest';
import { FlashPolicy, resolveHistoryFlash } from '../../../../view/shared/overlay/error-flash';
import type { PlacedObject, ValidationError } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import type { GridId } from '../../../../core/grid/grids';
import { bodyEvidence } from '../../../../core/grid/footprint';
import { PLAZA_RECT } from '../../../_support/planet';
import { cellSet, evidenceOn } from '../../../../core/grid/grids';

function err(cells: { x: number; y: number }[], grid: GridId): ValidationError {
  return { ruleId: 'T', message: 'test', ...evidenceOn(grid, cells) };
}

/** What one fresh policy lights for `errors`: the cells and the bodies, each empty when none. */
const resolveErrorFlashCells = (errors: ValidationError[]) => new FlashPolicy(() => 0).errors(errors)?.cells ?? [];
const resolveErrorFlashRects = (errors: ValidationError[]) => new FlashPolicy(() => 0).errors(errors)?.rects ?? [];
/** The cells a commit flash over `sets` lights. */
const flashCells = (sets: Parameters<FlashPolicy['commit']>[0]) => new FlashPolicy(() => 0).commit(sets)?.cells ?? [];

/** A policy on a clock the test moves: `at(ms, errors)` reports whether the flash plays. */
function gated() {
  let now = 0;
  const policy = new FlashPolicy(() => now);
  return (ms: number, errors: ValidationError[]): boolean => { now = ms; return policy.errors(errors) !== null; };
}

function bodyErr(rects: Rect[], grid: GridId): ValidationError {
  return { ruleId: 'T', message: 'test', ...evidenceOn(grid, bodyEvidence(rects).cells), rects: bodyEvidence(rects).rects };
}

describe('resolveErrorFlashCells', () => {
  it('puts the cells of each error on the grid that error names', () => {
    const out = resolveErrorFlashCells([err([{ x: 1, y: 1 }], 'terrain'), err([{ x: 2, y: 2 }], 'object')]);
    expect(out).toEqual([
      { x: 1, y: 1, grid: 'terrain' },
      { x: 2, y: 2, grid: 'object' },
    ]);
  });

  it('dedupes identical cells on the same grid, keeps same coord on different grids', () => {
    const out = resolveErrorFlashCells(
      [err([{ x: 3, y: 3 }, { x: 3, y: 3 }], 'object'), err([{ x: 3, y: 3 }], 'object'), err([{ x: 3, y: 3 }], 'terrain')],
    );
    expect(out).toEqual([
      { x: 3, y: 3, grid: 'object' },
      { x: 3, y: 3, grid: 'terrain' },
    ]);
  });
});


describe('body evidence (ValidationError.rects)', () => {
  it('an error that names a body is drawn as the body, never as the cells it rounds out to', () => {
    const e = bodyErr([{ ...PLAZA_RECT }], 'object');
    // The whole-cell evidence is still reported (non-drawing readers), but the flash takes the rect.
    expect(e.cells.length).toBe((PLAZA_RECT.w + 1) * (PLAZA_RECT.h + 1));
    expect(resolveErrorFlashCells([e])).toEqual([]);
    expect(resolveErrorFlashRects([e]))
      .toEqual([{ ...PLAZA_RECT, grid: 'object' }]);
  });

  it('a body takes its error\'s grid', () => {
    expect(resolveErrorFlashRects([bodyErr([{ x: 1, y: 1, w: 2, h: 2 }], 'terrain')]))
      .toEqual([{ x: 1, y: 1, w: 2, h: 2, grid: 'terrain' }]);
    expect(resolveErrorFlashRects([bodyErr([{ x: 1, y: 1, w: 2, h: 2 }], 'object')]))
      .toEqual([{ x: 1, y: 1, w: 2, h: 2, grid: 'object' }]);
  });

  it('dedupes identical bodies across rules and drops empty ones', () => {
    const a = bodyErr([{ x: 2, y: 2, w: 1.5, h: 1 }], 'object');
    const b = bodyErr([{ x: 2, y: 2, w: 1.5, h: 1 }], 'object');
    expect(resolveErrorFlashRects([a, b])).toHaveLength(1);
    expect(resolveErrorFlashRects([bodyErr([{ x: 2, y: 2, w: 0, h: 1 }], 'object')])).toEqual([]);
  });

  it('cell errors and body errors coexist: each keeps its own form', () => {
    const out = resolveErrorFlashCells([err([{ x: 1, y: 1 }], 'terrain'), bodyErr([{ x: 3, y: 3, w: 2, h: 2 }], 'object')]);
    expect(out).toEqual([{ x: 1, y: 1, grid: 'terrain' }]);
    expect(resolveErrorFlashRects([err([{ x: 1, y: 1 }], 'terrain')])).toEqual([]);
  });

  it('an empty body is dropped from BOTH halves, so it can never starve the cells', () => {
    // A rect with no extent cannot be drawn. `bodyEvidence` drops it where the pair is derived, so
    // the cells it would have produced never exist either...
    const derived = bodyEvidence([{ x: 2, y: 2, w: 0, h: 3 }, { x: 5, y: 5, w: 2, h: 1 }]);
    expect(derived.rects).toEqual([{ x: 5, y: 5, w: 2, h: 1 }]);
    expect(derived.cells).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    // ...and a hand-written error whose only rects are empty still flashes its cells, rather than
    // having them skipped in favour of a body with nothing to show.
    const starved: ValidationError = {
      ruleId: 'T', message: 'test', ...evidenceOn('object', [{ x: 9, y: 9 }]),
      rects: [{ x: 9, y: 9, w: 0, h: 0 }],
    };
    expect(resolveErrorFlashRects([starved])).toEqual([]);
    expect(resolveErrorFlashCells([starved])).toEqual([{ x: 9, y: 9, grid: 'object' }]);
  });

  it('the repeat gate distinguishes bodies, not only cells', () => {
    const at = gated();
    expect(at(1000, [bodyErr([{ x: 1, y: 1, w: 2, h: 2 }], 'object')])).toBe(true);
    expect(at(1050, [bodyErr([{ x: 1, y: 1, w: 3, h: 2 }], 'object')])).toBe(true);
  });
});

describe('repeat-violation gate', () => {
  const same = () => [err([{ x: 1, y: 1 }, { x: 2, y: 1 }], 'object')];

  it('the same evidence within the cooldown does not retrigger (no strobing under a held brush)', () => {
    const at = gated();
    expect(at(1000, same())).toBe(true);
    expect(at(1300, same())).toBe(false);
    expect(at(1850, same())).toBe(false);
  });

  it('the same evidence after the cooldown flashes again (a soft periodic reminder)', () => {
    const at = gated();
    expect(at(1000, same())).toBe(true);
    expect(at(1901, same())).toBe(true);
  });

  it('different evidence flashes immediately, regardless of timing', () => {
    const at = gated();
    expect(at(1000, same())).toBe(true);
    expect(at(1050, [err([{ x: 5, y: 5 }], 'terrain')])).toBe(true);
  });

  it('signatures distinguish grid, not just coordinates', () => {
    const at = gated();
    expect(at(1000, [err([{ x: 1, y: 1 }], 'terrain')])).toBe(true);
    expect(at(1050, [err([{ x: 1, y: 1 }], 'object')])).toBe(true);
  });

  it('nothing to light plays nothing', () => {
    expect(gated()(1000, [])).toBe(false);
  });
});

describe('resolveHistoryFlash (what an undo/redo acknowledges)', () => {
  const obj = (id: string, x: number, y: number): PlacedObject =>
    ({ id, catalogId: 'unknown-item', position: { x, y }, rotation: 0, elevation: 0 });

  it('terrain-only steps flash their cells on the terrain grid', () => {
    expect(resolveHistoryFlash([cellSet('terrain', [{ x: 2, y: 3 }])], undefined))
      .toEqual([cellSet('terrain', [{ x: 2, y: 3 }])]);
  });

  it('object-only steps flash each footprint on the placement grid', () => {
    expect(resolveHistoryFlash([], [obj('a', 4, 5)]))
      .toEqual([cellSet('object', [{ x: 4, y: 5 }])]);
  });

  it('a MIXED step flashes both parts, each on its own grid', () => {
    // A stroke whose road reconcile took a coating with it changes terrain and objects; flashing
    // one of them leaves the other half of the undo unacknowledged.
    expect(resolveHistoryFlash([cellSet('terrain', [{ x: 2, y: 3 }])], [obj('r', 7, 8)])).toEqual([
      cellSet('object', [{ x: 7, y: 8 }]),
      cellSet('terrain', [{ x: 2, y: 3 }]),
    ]);
  });

  it('keeps a half-grid anchor, and reports no set for an empty step', () => {
    expect(resolveHistoryFlash([], [obj('h', 10.5, 12.5)]))
      .toEqual([cellSet('object', [{ x: 10.5, y: 12.5 }])]);
    expect(resolveHistoryFlash([], [])).toEqual([]);
    expect(resolveHistoryFlash([], undefined)).toEqual([]);
  });

  it('the same cell on both grids is kept twice — they are different places on screen', () => {
    expect(flashCells(resolveHistoryFlash([cellSet('terrain', [{ x: 4, y: 5 }])], [obj('a', 4, 5)]))).toHaveLength(2);
  });
});

describe('the cells a commit flash draws', () => {
  it('tags each cell with its set\'s grid and dedupes per grid', () => {
    expect(flashCells([
      cellSet('terrain', [{ x: 1, y: 1 }, { x: 1, y: 1 }]),
      cellSet('object', [{ x: 1, y: 1 }]),
    ])).toEqual([{ x: 1, y: 1, grid: 'terrain' }, { x: 1, y: 1, grid: 'object' }]);
  });
});
