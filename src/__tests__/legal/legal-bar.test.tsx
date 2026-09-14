// LegalBar — persistent bottom filing bar. Renders nothing until
// LEGAL has at least one COMPLETE pair (number+URL both set); a partial pair
// (number without url, or vice versa) is a build-time error (validate-config)
// but the component independently must not render a broken row, so a
// partial pair is simply omitted rather than crashing or half-rendering.
//
// LEGAL config: mutated in-place per test (the export is a plain, non-frozen
// object) and restored in afterEach, following the pattern established by
// about-modal.test.tsx.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LegalBar } from '../../legal/LegalBar';
import { I18nProvider } from '../../i18n/context';
import { LEGAL } from '../../legal/config';
import { colors } from '../../ui/design/styles';
import { setStoreState } from '../_store';
import { useEditorStore } from '../../state/store';

// WCAG 2.x relative-luminance contrast (same formula as a11y.test.tsx).
function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}
function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function renderBar() {
  return render(
    <I18nProvider>
      <LegalBar />
    </I18nProvider>,
  );
}

const snapshot = {
  icpNumber: LEGAL.icpNumber,
  icpUrl: LEGAL.icpUrl,
  psbNumber: LEGAL.psbNumber,
  psbUrl: LEGAL.psbUrl,
};

beforeEach(() => {
  setStoreState({ locale: 'en', editMode: { ...useEditorStore.getState().editMode, mode: null }, selectingRegion: false });
  LEGAL.icpNumber = null;
  LEGAL.icpUrl = null;
  LEGAL.psbNumber = null;
  LEGAL.psbUrl = null;
});

afterEach(() => {
  Object.assign(LEGAL, snapshot);
});

describe('LegalBar', () => {
  it.each(['mountain', 'water', 'road', 'object', 'generate', 'annotate'] as const)(
    'hides while the %s editing panel is open and returns when it closes', (mode) => {
      LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
      LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
      renderBar();
      expect(screen.getByRole('navigation')).toBeTruthy();
      act(() => useEditorStore.getState().setEditMode({ mode }));
      expect(screen.queryByRole('navigation')).toBeNull();
      act(() => useEditorStore.getState().setEditMode({ mode: null }));
      expect(screen.getByRole('link').getAttribute('href')).toBe(LEGAL.icpUrl);
    },
  );

  it('hides while region selection occupies the bottom panel', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderBar();
    act(() => setStoreState({ selectingRegion: true }));
    expect(screen.queryByRole('navigation')).toBeNull();
    act(() => setStoreState({ selectingRegion: false }));
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('renders nothing when both pairs are null', () => {
    const { container } = renderBar();
    expect(container.firstChild).toBeNull();
  });

  it('omits ICP when url is set but number is null', () => {
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    LEGAL.icpNumber = null;
    LEGAL.psbNumber = '京公网安备 1101xxxxxxxxx号';
    LEGAL.psbUrl = 'https://www.beian.gov.cn/portal/registerSystemInfo';
    renderBar();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('京公网安备 1101xxxxxxxxx号');
    expect(screen.queryByText('·')).toBeNull();
  });

  it('renders null when PSB is only number without url', () => {
    LEGAL.icpNumber = null;
    LEGAL.icpUrl = null;
    LEGAL.psbNumber = '京公网安备 1101xxxxxxxxx号';
    LEGAL.psbUrl = null;
    const { container } = renderBar();
    expect(container.firstChild).toBeNull();
  });

  it('renders only the ICP link when only ICP is complete', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderBar();
    const link = screen.getByRole('link', { name: '京ICP备2026xxxxxx号-1' });
    expect(link.getAttribute('href')).toBe('https://beian.miit.gov.cn/');
    expect(screen.queryByText('·')).toBeNull();
  });

  it('renders only the PSB link when only PSB is complete', () => {
    LEGAL.psbNumber = '京公网安备 1101xxxxxxxxx号';
    LEGAL.psbUrl = 'https://www.beian.gov.cn/portal/registerSystemInfo';
    renderBar();
    const link = screen.getByRole('link', { name: '京公网安备 1101xxxxxxxxx号' });
    expect(link.getAttribute('href')).toBe('https://www.beian.gov.cn/portal/registerSystemInfo');
    expect(screen.queryByText('·')).toBeNull();
  });

  it('renders both links, standing apart on space rather than on a mark between them', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    LEGAL.psbNumber = '京公网安备 1101xxxxxxxxx号';
    LEGAL.psbUrl = 'https://www.beian.gov.cn/portal/registerSystemInfo';
    const { container } = renderBar();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(container.textContent).not.toContain('·');
    expect(links[0]?.style.marginRight).toBe('12px');
  });

  it('omits a partial pair (number without url) even if the other pair is complete', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = null; // partial — build-time error elsewhere, must not render here
    LEGAL.psbNumber = '京公网安备 1101xxxxxxxxx号';
    LEGAL.psbUrl = 'https://www.beian.gov.cn/portal/registerSystemInfo';
    renderBar();
    expect(screen.queryByText('京ICP备2026xxxxxx号-1')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('京公网安备 1101xxxxxxxxx号');
  });

  it('renders nothing when both pairs are partial', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = null;
    LEGAL.psbNumber = null;
    LEGAL.psbUrl = 'https://www.beian.gov.cn/portal/registerSystemInfo';
    const { container } = renderBar();
    expect(container.firstChild).toBeNull();
  });

  it('links carry target=_blank and rel=noopener noreferrer', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderBar();
    const link = screen.getByRole('link', { name: '京ICP备2026xxxxxx号-1' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('container is pointer-transparent while links stay clickable', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderBar();
    const bar = screen.getByRole('navigation', { name: 'Legal & policies' });
    expect(bar.style.pointerEvents).toBe('none');
    const link = screen.getByRole('link', { name: '京ICP备2026xxxxxx号-1' });
    expect(link.style.pointerEvents).toBe('auto');
  });

  it('has an aria-label from the localized legal.section_title key', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderBar();
    const bar = screen.getByRole('navigation', { name: 'Legal & policies' });
    expect(bar.getAttribute('aria-label')).toBe('Legal & policies');
  });

  // The cozy pill surface must make the filing numbers legible.
  it('renders a panelCream pill surface with an espresso-tinted shadow', () => {
    LEGAL.icpNumber = '京ICP备2026xxxxxx号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderBar();
    const bar = screen.getByRole('navigation', { name: 'Legal & policies' });
    // jsdom normalizes the hex to rgb; assert on the resolved values.
    expect(bar.style.background).toContain('rgb(255, 251, 225)'); // colors.panelCream
    expect(bar.style.boxShadow).not.toBe('');
    expect(bar.style.borderRadius).toBe('99px');
  });

  it('the bar text color (brownText) clears WCAG AA 4.5:1 against the panelCream pill', () => {
    expect(contrastRatio(colors.brownText, colors.panelCream)).toBeGreaterThanOrEqual(4.5);
  });
});
