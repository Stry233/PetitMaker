// The quick-hints level: a persisted store field the hint panel reads. The panel has no home in
// this interface yet and Settings carries no row for it, so what is pinned here is the persistence
// path alone (default, write-through, corrupt value).
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { PREFS, readPref } from '../../../core/runtime/prefs';
import { setStoreState } from '../../_store';

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en', hintLevel: 'full' });
});

describe('hint level setting', () => {
  // The seeded store field can only report the seed, so the DEFAULT is asserted against
  // the detector the initializer calls, not against `getState()`.
  it('defaults to full with nothing, or nothing valid, stored', () => {
    expect(readPref('hintLevel')).toBe('full');
    localStorage.setItem(PREFS.hintLevel.key, 'banana');
    expect(readPref('hintLevel')).toBe('full');
  });

  it('detects only valid stored values', () => {
    localStorage.setItem(PREFS.hintLevel.key, 'concise');
    expect(readPref('hintLevel')).toBe('concise');
    localStorage.setItem(PREFS.hintLevel.key, 'off');
    expect(readPref('hintLevel')).toBe('off');
  });

  it('persists the chosen level', () => {
    useEditorStore.getState().setHintLevel('concise');
    expect(useEditorStore.getState().hintLevel).toBe('concise');
    expect(localStorage.getItem(PREFS.hintLevel.key)).toBe('concise');
  });
});
