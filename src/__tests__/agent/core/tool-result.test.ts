import { describe, expect, it } from 'vitest';
import { resultStatus, retainedWrite } from '../../../agent/core/tool-result';

describe('retainedWrite', () => {
  it('counts retained parts of rejected strokes and ignores explicit no-ops', () => {
    expect(retainedWrite({ write: true, isError: true, detail: { cells: 3 } })).toBe(true);
    expect(retainedWrite({ write: true, isError: true, detail: { reverted: true, partialRevert: true, cells: 2 } })).toBe(true);
    expect(retainedWrite({ write: true, isError: true, detail: { reverted: true, cells: 2 } })).toBe(false);
    expect(retainedWrite({ write: true, isError: false, detail: { cells: 0, objects: 0 } })).toBe(false);
    expect(retainedWrite({ write: false, isError: false, detail: { objects: 3 } })).toBe(false);
  });
});

describe('resultStatus', () => {
  it('reads a rollback before a region refusal before a plain failure', () => {
    expect(resultStatus({ isError: true, detail: { reverted: true, partialRevert: true } })).toBe('revert');
    expect(resultStatus({ isError: true, detail: { regionBlocked: true } })).toBe('blocked');
    expect(resultStatus({ isError: true })).toBe('error');
    expect(resultStatus({ isError: false, detail: { cells: 2 } })).toBe('ok');
  });
});
