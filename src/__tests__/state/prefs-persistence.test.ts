/**
 * The Settings panel's view preferences survive a reload.
 *
 * A session-only `motionPref`, `gridMode` or `showChunkBounds` reads as a broken panel: a choice
 * made in Settings is silently gone the next visit, while its neighbours (uiZoom, quality3d,
 * systemCursors) stick. Each pin here is the same shape: the
 * setter writes through the prefs table's key, and a freshly-booted slice reads it back.
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

describe('the grid choice persists', () => {
  it('the setter writes the storage key and a fresh boot reads it back', () => {
    useEditorStore.getState().setGridMode('terrain');
    expect(localStorage.getItem('petit-planet-grid-mode')).toBe('terrain');
    expect(boot().gridMode).toBe('terrain');
  });

  it('defaults to the grid that follows the tool when nothing is stored', () => {
    expect(boot().gridMode).toBe('auto');
  });
});

describe('the old grid switch migrates to the grid choice', () => {
  it('a grid switched off stays off', () => {
    localStorage.setItem('petit-planet-show-grid', '0');
    expect(boot().gridMode).toBe('off');
    expect(boot().lastGridMode).toBe('auto');
  });

  it('a grid switched on follows the tool', () => {
    localStorage.setItem('petit-planet-show-grid', '1');
    expect(boot().gridMode).toBe('auto');
  });

  it('a stored choice wins over the old switch, and the first choice removes the old key', () => {
    localStorage.setItem('petit-planet-show-grid', '0');
    localStorage.setItem('petit-planet-grid-mode', 'object');
    expect(boot().gridMode).toBe('object');
    useEditorStore.getState().setGridMode('terrain');
    expect(localStorage.getItem('petit-planet-show-grid')).toBeNull();
    expect(boot().gridMode).toBe('terrain');
  });

  it('an unreadable stored choice falls back through the old switch', () => {
    localStorage.setItem('petit-planet-show-grid', '0');
    localStorage.setItem('petit-planet-grid-mode', 'diagonal');
    expect(boot().gridMode).toBe('off');
  });
});

describe('the grid shortcut toggles', () => {
  it('turns the grid off and brings back the mode it turned off', () => {
    const s = () => useEditorStore.getState();
    s().setGridMode('terrain');
    s().toggleGrid();
    expect(s().gridMode).toBe('off');
    s().toggleGrid();
    expect(s().gridMode).toBe('terrain');
    expect(localStorage.getItem('petit-planet-grid-mode')).toBe('terrain');
  });
});

describe('the Settings tile cycles the grid modes', () => {
  it('steps Auto, Object grid, Terrain grid, Off and wraps, saving each step', () => {
    const s = () => useEditorStore.getState();
    s().setGridMode('auto');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      s().cycleGridMode();
      seen.push(s().gridMode);
      expect(localStorage.getItem('petit-planet-grid-mode')).toBe(s().gridMode);
    }
    expect(seen).toEqual(['object', 'terrain', 'off', 'auto']);
  });

  it('the shortcut after cycling to Off brings back the mode the cycle left', () => {
    const s = () => useEditorStore.getState();
    s().setGridMode('terrain');
    s().cycleGridMode();
    expect(s().gridMode).toBe('off');
    s().toggleGrid();
    expect(s().gridMode).toBe('terrain');
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
