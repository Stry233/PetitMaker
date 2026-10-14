import { describe, it, expect } from 'vitest';
import { ImportError } from '../../../io/save/import-error';

describe('ImportError', () => {
  it('carries a code and message', () => {
    const e = new ImportError('future-version', 'Saved by a newer version.');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('future-version');
    expect(e.name).toBe('ImportError');
  });
});
