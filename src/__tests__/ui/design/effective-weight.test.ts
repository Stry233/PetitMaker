import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { ScaleProvider } from '../../../ui/design/scale';
import { FitText } from '../../../ui/primitives/FitText';
import { ShelfSearchField } from '../../../ui/shell/bars/ObjectShelf';
import { LegalMarkdown } from '../../../legal/LegalMarkdown';
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

  it('accounts for the transform that fits a long label', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200);
    const { getByText } = render(createElement(ScaleProvider, { value: 1 },
      createElement(FitText, { maxW: 80, size: 24, children: 'A long fitted label' })));
    expect(getByText('A long fitted label').style.fontWeight).toBe('400');
    expect(getByText('A long fitted label').style.transform).toBe('scale(0.4)');
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
