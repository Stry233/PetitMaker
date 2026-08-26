/**
 * The Settings panel's view preferences survive a reload.
 *
 * `motionPref`, `showGrid` and `showChunkBounds` were session-only for a long time, which read
 * as a broken panel: a choice made in Settings was silently gone the next visit, while its
 * neighbours (uiZoom, quality3d, systemCursors) stuck. Each pin here is the same shape: the
 * setter writes through the PREFS table's key, and a freshly-booted slice reads it back.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createPrefsSlice, type PrefsSlice } from '../../state/slices/prefs';

/** A slice booted the way the store boots one at page load — reading prefs, holding defaults. */
function boot(): PrefsSlice {
  return createPrefsSlice((() => {}) as never, (() => ({})) as never, {} as never);
}

beforeEach(() => {
  localStorage.clear();
});

describe('motion preference persists', () => {
  it('the setter writes the storage key and a fresh boot reads it back', () => {
    useEditorStore.getState().setMotionPref('reduced');
    expect(localStorage.getItem('petit-planet-motion')).toBe('reduced');
    expect(boot().motionPref).toBe('reduced');
  });

  it('defaults to system when nothing is stored', () => {
    expect(boot().motionPref).toBe('system');
  });
});

describe('grid-lines visibility persists', () => {
  it('the setter writes the storage key and a fresh boot reads it back', () => {
    useEditorStore.getState().setShowGrid(false);
    expect(localStorage.getItem('petit-planet-show-grid')).toBe('0');
    expect(boot().showGrid).toBe(false);
  });

  it('defaults to shown when nothing is stored', () => {
    expect(boot().showGrid).toBe(true);
  });
});

describe('the cursor default is the painted set, everywhere', () => {
  // Held even on desktop Linux, where Wayland Chromium under fractional display scaling draws
  // custom bitmaps at the wrong size (see cursor-css.ts's header) — a platform-keyed default
  // would trade one platform's defect for a split default. The Settings cursor choice is the way out.
  it('an unset preference reads as painted, and a stored choice reads as stored', () => {
    expect(boot().systemCursors).toBe(false);
    localStorage.setItem('petit-planet-system-cursors', '1');
    expect(boot().systemCursors).toBe(true);
  });
});

describe('chunk-bounds visibility persists', () => {
  it('the setter writes the storage key and a fresh boot reads it back', () => {
    useEditorStore.getState().setShowChunkBounds(false);
    expect(localStorage.getItem('petit-planet-chunk-bounds')).toBe('0');
    expect(boot().showChunkBounds).toBe(false);
  });

  it('defaults to shown when nothing is stored', () => {
    expect(boot().showChunkBounds).toBe(true);
  });
});
