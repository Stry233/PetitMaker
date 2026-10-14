/** Whether the map holds edits made since its last export. */
import { describe, it, expect } from 'vitest';
import { hasUnsavedEdits } from '../../state/unsaved-edits';

describe('hasUnsavedEdits', () => {
  it('counts edits past the export mark, and none on an untouched map', () => {
    expect(hasUnsavedEdits(0, null)).toBe(false);
    expect(hasUnsavedEdits(undefined, null)).toBe(false);
    expect(hasUnsavedEdits(3, null)).toBe(true);
    expect(hasUnsavedEdits(3, 3)).toBe(false);
    expect(hasUnsavedEdits(4, 3)).toBe(true);
  });
});
