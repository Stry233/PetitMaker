/**
 * The pure half of the flashes, shared by both views: what each one covers and on which grid.
 * An error resolves to cells on its own grid ('micro' terrain / 'macro' object, falling back to
 * the command-type default), deduped so overlapping rules don't stack alpha — or, where the cause
 * is an object, to the exact BODY it accuses, which whole cells can only round out from. An
 * undo/redo resolves to everything the step changed, each part on its own grid.
 */
import { describe, it, expect } from 'vitest';
import { errorFlashSignature, shouldFlashErrors, resolveErrorFlashCells, resolveErrorFlashRects, resolveHistoryFlash, resolveCellsFlash } from '../../canvas/map2d/layers/error-flash';
import { ItemCategory, type GridState, type PlacedObject, type Rect, type ValidationError } from '../../core/model/types';
import { bodyEvidence } from '../../core/model/grid-model';
import { makeState } from '../rules/_helpers';
import { registerCatalogItem } from '../../state/catalog';

function err(cells: { x: number; y: number }[], grid?: 'macro' | 'micro'): ValidationError {
  return { ruleId: 'T', message: 'test', cells, severity: 'error', ...(grid ? { grid } : {}) };
}

function bodyErr(rects: Rect[], grid?: 'macro' | 'micro'): ValidationError {
  return { ruleId: 'T', message: 'test', ...bodyEvidence(rects), severity: 'error', ...(grid ? { grid } : {}) };
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


describe('body evidence (ValidationError.rects)', () => {
  it('an error that names a body is drawn as the body, never as the cells it rounds out to', () => {
    const e = bodyErr([{ x: 76.5, y: 58.5, w: 20, h: 27 }], 'macro');
    // The whole-cell evidence is still reported (non-drawing readers), but the flash takes the rect.
    expect(e.cells.length).toBe(21 * 28);
    expect(resolveErrorFlashCells([e], false)).toEqual([]);
    expect(resolveErrorFlashRects([e], false))
      .toEqual([{ x: 76.5, y: 58.5, w: 20, h: 27, micro: false }]);
  });

  it('a body takes its error\'s grid, falling back to the command-type default', () => {
    expect(resolveErrorFlashRects([bodyErr([{ x: 1, y: 1, w: 2, h: 2 }])], true))
      .toEqual([{ x: 1, y: 1, w: 2, h: 2, micro: true }]);
    expect(resolveErrorFlashRects([bodyErr([{ x: 1, y: 1, w: 2, h: 2 }], 'macro')], true))
      .toEqual([{ x: 1, y: 1, w: 2, h: 2, micro: false }]);
  });

  it('dedupes identical bodies across rules and drops empty ones', () => {
    const a = bodyErr([{ x: 2, y: 2, w: 1.5, h: 1 }], 'macro');
    const b = bodyErr([{ x: 2, y: 2, w: 1.5, h: 1 }], 'macro');
    expect(resolveErrorFlashRects([a, b], false)).toHaveLength(1);
    expect(resolveErrorFlashRects([bodyErr([{ x: 2, y: 2, w: 0, h: 1 }], 'macro')], false)).toEqual([]);
  });

  it('cell errors and body errors coexist: each keeps its own form', () => {
    const out = resolveErrorFlashCells([err([{ x: 1, y: 1 }], 'micro'), bodyErr([{ x: 3, y: 3, w: 2, h: 2 }], 'macro')], false);
    expect(out).toEqual([{ x: 1, y: 1, micro: true }]);
    expect(resolveErrorFlashRects([err([{ x: 1, y: 1 }], 'micro')], false)).toEqual([]);
  });

  it('an empty body is dropped from BOTH halves, so it can never starve the cells', () => {
    // A rect with no extent cannot be drawn. `bodyEvidence` drops it where the pair is derived, so
    // the cells it would have produced never exist either...
    const derived = bodyEvidence([{ x: 2, y: 2, w: 0, h: 3 }, { x: 5, y: 5, w: 2, h: 1 }]);
    expect(derived.rects).toEqual([{ x: 5, y: 5, w: 2, h: 1 }]);
    expect(derived.cells).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    // ...and a hand-written error whose ONLY rects are empty still flashes its cells, rather than
    // having them skipped in favour of a body with nothing to show.
    const starved: ValidationError = {
      ruleId: 'T', message: 'test', cells: [{ x: 9, y: 9 }],
      rects: [{ x: 9, y: 9, w: 0, h: 0 }], grid: 'macro', severity: 'error',
    };
    expect(resolveErrorFlashRects([starved], false)).toEqual([]);
    expect(resolveErrorFlashCells([starved], false)).toEqual([{ x: 9, y: 9, micro: false }]);
  });

  it('the repeat gate distinguishes bodies, not only cells', () => {
    const small = errorFlashSignature([], [{ x: 1, y: 1, w: 2, h: 2, micro: false }]);
    const large = errorFlashSignature([], [{ x: 1, y: 1, w: 3, h: 2, micro: false }]);
    expect(small).not.toBe(large);
    expect(shouldFlashErrors({ sig: small, at: 1000 }, large, 1050, 900)).toBe(true);
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

describe('resolveHistoryFlash (what an undo/redo acknowledges)', () => {
  const obj = (id: string, x: number, y: number): PlacedObject =>
    ({ id, catalogId: 'unknown-item', position: { x, y }, rotation: 0, elevation: 0 });

  it('terrain-only steps flash their cells on the micro grid', () => {
    expect(resolveHistoryFlash([{ x: 2, y: 3 }], undefined))
      .toEqual({ cells: [{ x: 2, y: 3, micro: true }] });
  });

  it('object-only steps flash each footprint on the macro grid', () => {
    expect(resolveHistoryFlash([], [obj('a', 4, 5)]))
      .toEqual({ cells: [{ x: 4, y: 5, micro: false }] });
  });

  it('a MIXED step flashes both parts, each on its own grid', () => {
    // A stroke whose road reconcile took a coating with it changes terrain AND objects; flashing
    // one of them leaves the other half of the undo unacknowledged.
    const out = resolveHistoryFlash([{ x: 2, y: 3 }], [obj('r', 7, 8)])!;
    expect(out.cells).toEqual([
      { x: 7, y: 8, micro: false },
      { x: 2, y: 3, micro: true },
    ]);
  });

  it('keeps a half-grid anchor, and reports nothing for an empty step', () => {
    expect(resolveHistoryFlash([], [obj('h', 10.5, 12.5)]))
      .toEqual({ cells: [{ x: 10.5, y: 12.5, micro: false }] });
    expect(resolveHistoryFlash([], [])).toBeNull();
    expect(resolveHistoryFlash([], undefined)).toBeNull();
  });

  it('the same cell on both grids is kept twice — they are different places on screen', () => {
    const out = resolveHistoryFlash([{ x: 4, y: 5 }], [obj('a', 4, 5)])!;
    expect(out.cells).toHaveLength(2);
  });
});

describe('resolveCellsFlash (a bare cell list, with no grid stated)', () => {
  registerCatalogItem({
    id: 'flash-house', category: ItemCategory.Building, name: { en: 'Flash House' },
    width: 2, height: 2, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
  });

  function mapWith(objs: PlacedObject[]): GridState {
    const s = makeState(40, 40) as GridState;
    for (const o of objs) s.objects.set(o.id, o);
    return s;
  }
  const house = (id: string, x: number, y: number): PlacedObject =>
    ({ id, catalogId: 'flash-house', position: { x, y }, rotation: 0, elevation: 0 });

  it('a cell with nothing on it is a TERRAIN cell', () => {
    expect(resolveCellsFlash(mapWith([]), [{ x: 3, y: 4 }]))
      .toEqual([{ x: 3, y: 4, micro: true }]);
  });

  it('a cell an object covers flashes that object\'s whole body, on the macro grid', () => {
    // The agent reports the anchor it placed at; the thing that appeared is the footprint.
    const out = resolveCellsFlash(mapWith([house('h', 5, 6)]), [{ x: 5, y: 6 }]);
    expect(out).toEqual([
      { x: 5, y: 6, micro: false }, { x: 6, y: 6, micro: false },
      { x: 5, y: 7, micro: false }, { x: 6, y: 7, micro: false },
    ]);
  });

  it('one write of terrain AND objects resolves each cell on its own grid', () => {
    const out = resolveCellsFlash(mapWith([house('h', 5, 6)]), [{ x: 1, y: 1 }, { x: 5, y: 6 }]);
    expect(out[0]).toEqual({ x: 1, y: 1, micro: true });
    expect(out.filter((c) => !c.micro)).toHaveLength(4);
  });

  it('expands each covering object once, however many of its cells the list names', () => {
    const out = resolveCellsFlash(mapWith([house('h', 5, 6)]), [{ x: 5, y: 6 }, { x: 6, y: 7 }]);
    expect(out).toHaveLength(4);
  });

  it('keeps a half-grid body at its own anchor', () => {
    const plaza: PlacedObject = {
      id: '__plaza__', catalogId: '__plaza__', position: { x: 10.5, y: 12.5 },
      width: 2, height: 1, rotation: 0, elevation: 1, locked: true,
    };
    expect(resolveCellsFlash(mapWith([plaza]), [{ x: 11, y: 12 }]))
      .toEqual([{ x: 10.5, y: 12.5, micro: false }, { x: 11.5, y: 12.5, micro: false }]);
  });
});
