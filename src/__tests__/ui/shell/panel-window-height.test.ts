import { describe, it, expect } from 'vitest';
import { PINNED_PANEL, panelMaxHeight, panelTop } from '../../../ui/shell/panel-frame';

describe('the panel measures the window through the published viewport height', () => {
  it('reads the frame\'s --viewport-h and falls back to 100vh where none is published', () => {
    for (const css of [panelTop(180), panelMaxHeight('object', 180), PINNED_PANEL.height]) {
      expect(css).toContain('var(--viewport-h, 100vh)');
      expect(css).not.toMatch(/(?<!, )100vh/);
    }
  });
});
