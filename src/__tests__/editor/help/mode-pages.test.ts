/** The page for what the hand holds: a pick on the bare map in What's this opens it. */
import { describe, expect, it } from 'vitest';
import { HELP_PAGES } from '../../../editor/help/catalog';
import { pageForEditState } from '../../../editor/help/mode-pages';
import { BUILD_MODES, type BuildMode } from '../../../state/editing/edit-mode';

describe('the page for an edit state', () => {
  it('answers every edit state with a real page', () => {
    const modes: BuildMode[] = [null, ...BUILD_MODES];
    const tools = ['brush', 'erase', 'trim', 'shape', 'smart', 'none'];
    for (const mode of modes) {
      for (const tool of tools) {
        const page = pageForEditState({ mode, tool });
        expect(HELP_PAGES[page], `${mode}/${tool} → ${page}`).toBeTruthy();
      }
    }
  });

  it('teaches the camera with no mode, a terrain surface by its tool, and every other mode by its own page', () => {
    expect(pageForEditState({ mode: null, tool: 'trim' })).toBe('camera');
    expect(pageForEditState({ mode: 'water', tool: 'brush' })).toBe('terrain');
    expect(pageForEditState({ mode: 'road', tool: 'trim' })).toBe('trim');
    expect(pageForEditState({ mode: 'mountain', tool: 'smart' })).toBe('smart');
    expect(pageForEditState({ mode: 'object', tool: 'trim' })).toBe('objects');
    expect(pageForEditState({ mode: 'annotate', tool: 'none' })).toBe('notes');
  });
});
