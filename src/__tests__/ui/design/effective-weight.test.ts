// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { ShelfSearchField } from '../../../ui/shell/bars/objects/ShelfSearchField';
import { LegalMarkdown } from '../../../ui/primitives/LegalMarkdown';
import { parseLegalMarkdown } from '../../../legal/markdown';

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('devicePixelRatio', 2);
  useEditorStore.setState({ uiZoom: 0.6, locale: 'en', motionPref: 'reduced' });
  __resetUiZoomAnim();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('small text surfaces share the weight limits', () => {
  it('lightens the object search field on a Retina screen', () => {
    const { getByRole } = render(createElement(ShelfSearchField, { value: '', placeholder: 'Search', onChange: () => {} }));
    expect(Number(getByRole('searchbox').style.fontWeight)).toBeLessThan(800);
  });

  it('adapts legal headings without losing semantic emphasis', () => {
    const { getByRole, getByText } = render(createElement(LegalMarkdown, {
      nodes: parseLegalMarkdown('# **Heading**\n\n**Important text**'),
    }));
    expect(getByRole('heading').style.fontWeight).toBe('700');
    expect(getByText('Heading').tagName).toBe('STRONG');
    expect(getByText('Heading').style.fontWeight).toBe('inherit');
    expect(getByText('Important text').style.fontWeight).toContain('--fw-label');
  });
});
