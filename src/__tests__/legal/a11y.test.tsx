// @vitest-environment jsdom
/**
 * Accessibility acceptance criteria for the legal surfaces:
 *  - keyboard only: open a doc, reach the language toggle, Escape closes, focus returns to the
 *    element focused when the modal mounted (ModalShell's trap is unit-tested in `modal-shell.test`);
 *  - accessible names for the back button and the language selector;
 *  - WCAG contrast of `PROSE` text, and of the About view's small print on the surface it renders on;
 *  - the React table wrapper's `overflow-x: auto`, matching the static pages' `.tbl`;
 *  - reduced motion: with `MotionGlobalConfig.skipAnimations` the About view swap is synchronous;
 *  - heading hierarchy: one h1 per doc, and no level skipped going deeper.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useState } from 'react';
import { MotionGlobalConfig } from 'framer-motion';
import { AboutModal } from '../../ui/chrome/modals/about/AboutModal';
import { LegalMarkdown } from '../../ui/primitives/LegalMarkdown';
import { parseLegalMarkdown } from '../../legal/markdown';
import { DOCS, docNodes, type DocId } from '../../legal/registry';
import { LEGAL } from '../../legal/config';
import { I18nProvider, translateFor } from '../../i18n/context';
import { Tour } from '../../ui/chrome/tour/Tour';
import { startTour } from '../../ui/chrome/tour/use-tour';
import { useEditorStore } from '../../state/store';
import { MUTED, PLATE, SURFACE_SECONDARY, TEXT_PRIMARY } from '../../ui/design/tokens';
import { setStoreState } from '../_support/store';

// WCAG 2.x contrast ratio from hex tokens: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_BODY_TEXT = 4.5;

/** A rendered inline color as hex; jsdom normalises `color` and `background` to `rgb(r, g, b)`. */
function renderedHex(value: string): string {
  const rgb = /rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (rgb) return `#${rgb.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
  const hex = /#[0-9a-f]{6}/i.exec(value);
  if (!hex) throw new Error(`not a color: ${value}`);
  return hex[0];
}

/** The nearest value `read` gives on `el` or an ancestor: how inherited colour and a surface showing
 *  through transparent boxes resolve. */
function nearest(el: HTMLElement, read: (at: HTMLElement) => string | null): string {
  for (let at: HTMLElement | null = el; at; at = at.parentElement) {
    const value = read(at);
    if (value) return value;
  }
  throw new Error(`nothing set above ${el.tagName}`);
}

/** The contrast of `el`'s text, opacity aside: its inherited inline `color` against the nearest
 *  solid inline background under it. */
function renderedContrast(el: HTMLElement): number {
  const ink = nearest(el, (at) => at.style.color || null);
  const ground = nearest(el, (at) => {
    const bg = at.style.backgroundColor || at.style.background;
    return /^(rgb\(|#)/.test(bg) ? bg : null;
  });
  return contrastRatio(renderedHex(ink), renderedHex(ground));
}

function renderModal(onClose: () => void = () => {}) {
  return render(
    <I18nProvider>
      <AboutModal open onClose={onClose} />
    </I18nProvider>,
  );
}

const legalSnapshot = {
  canonicalOrigin: LEGAL.canonicalOrigin,
  icpNumber: LEGAL.icpNumber,
  icpUrl: LEGAL.icpUrl,
  psbNumber: LEGAL.psbNumber,
  psbUrl: LEGAL.psbUrl,
};

beforeEach(() => {
  setStoreState({ locale: 'en' });
  LEGAL.canonicalOrigin = '';
  LEGAL.icpNumber = null;
  LEGAL.icpUrl = null;
  LEGAL.psbNumber = null;
  LEGAL.psbUrl = null;
});

afterEach(() => {
  Object.assign(LEGAL, legalSnapshot);
});

describe('contrast — WCAG AA (>=4.5:1) for body text against panelCream', () => {
  it('PROSE body text (TEXT_PRIMARY) passes against panelCream', () => {
    expect(contrastRatio(TEXT_PRIMARY, PLATE)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('MUTED (the token used for the About footer disclaimer/© line) passes against panelCream', () => {
    expect(contrastRatio(MUTED, PLATE)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('MUTED (used for the zh-only note / doc footer bar) passes against surfaceSecondary too', () => {
    // The zh-only note sits on the slightly darker `SURFACE_SECONDARY`.
    expect(contrastRatio(MUTED, SURFACE_SECONDARY)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("the brand lockup's tagline passes AA on the About card, the one surface it appears on", () => {
    expect(contrastRatio(MUTED, PLATE)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("the welcome tips' words, Skip and Next pass AA against the window's own background", () => {
    // Read off the rendered window and text, so a failing colour in the deck cannot hide behind tokens.
    startTour();
    try {
      render(<I18nProvider><Tour /></I18nProvider>);
      const card = screen.getByTestId('tour-deck');
      const surface = renderedHex(card.style.background);
      const texts = [
        // The live card's words; every card's words also stand unseen to hold their room.
        within(card.querySelector<HTMLElement>('[data-tour-words]')!).getByText(translateFor('en', 'tour.welcome_body')),
        screen.getByRole('button', { name: 'Skip' }),
        screen.getByRole('heading'),
      ];
      for (const el of texts) {
        expect(contrastRatio(renderedHex(el.style.color), surface)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
      }
    } finally {
      act(() => { useEditorStore.getState().setTourRunning(false); });
    }
  });

  it('the rendered About-modal disclaimer passes AA against the surface it sits on', () => {
    renderModal();
    expect(renderedContrast(screen.getByText(LEGAL_DISCLAIMER_MATCH()))).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('the tagline passes AA against the surface it sits on', () => {
    renderModal();
    expect(renderedContrast(screen.getByText('Map Editor'))).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('the version-card line passes AA against the surface it sits on', () => {
    renderModal();
    expect(renderedContrast(screen.getByText(/^Version /))).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('both section titles (Team, Legal & policies) pass AA against the surface they sit on', () => {
    renderModal();
    for (const title of [screen.getByText('Team'), screen.getByText('Legal & policies')]) {
      expect(renderedContrast(title), title.textContent ?? '').toBeGreaterThanOrEqual(AA_BODY_TEXT);
    }
  });

  it('the ICP filing link (legally-mandated) passes AA against the surface it sits on', () => {
    LEGAL.icpNumber = '京ICP备12345678号';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderModal();
    const filingLink = screen.getByRole('link', { name: /京ICP备12345678号/ });
    expect(renderedContrast(filingLink)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });
});

// A loose text match, so the disclaimer's English copy is not restated here.
function LEGAL_DISCLAIMER_MATCH() {
  return /fan project|同人项目/i;
}

describe('table overflow — the React emitter wraps tables in a scrollable box', () => {
  it('wraps a rendered table in a div with overflow-x:auto (mirrors the static .tbl wrapper)', () => {
    const nodes = parseLegalMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |');
    const { container } = render(<LegalMarkdown nodes={nodes} />);
    const wrap = container.querySelector('div.tbl') as HTMLElement | null;
    expect(wrap).toBeTruthy();
    expect(wrap!.style.overflowX).toBe('auto');
  });
});

describe('heading hierarchy — every rendered doc has exactly one h1, no skipped levels', () => {
  const ids = Object.keys(DOCS) as DocId[];

  // `docNodes` is the tree LegalDocView renders, including the synthetic h1 for a doc with no
  // markdown heading (the licence, pinned byte-exact by license-files.test.ts).
  for (const id of ids) {
    it(`${id} (en): exactly one h1, no skipped heading levels`, () => {
      const nodes = docNodes(id, 'en', LEGAL, DOCS[id].titleKey);
      const levels = nodes.filter((n) => n.t === 'h').map((n) => (n as { level: number }).level);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      let depth = 0;
      for (const level of levels) {
        expect(level).toBeLessThanOrEqual(depth + 1);
        depth = level;
      }
    });

    const meta = DOCS[id];
    if (meta.source.zh !== null) {
      it(`${id} (zh): exactly one h1, no skipped heading levels`, () => {
        const nodes = docNodes(id, 'zh', LEGAL, DOCS[id].titleKey);
        const levels = nodes.filter((n) => n.t === 'h').map((n) => (n as { level: number }).level);
        expect(levels.filter((l) => l === 1)).toHaveLength(1);
        let depth = 0;
        for (const level of levels) {
          expect(level).toBeLessThanOrEqual(depth + 1);
          depth = level;
        }
      });
    }
  }
});

describe('reduced motion — the About-modal A<->B view transition is instant', () => {
  // `LegalDocView` is a `React.lazy` chunk, and lazy() memoizes its payload module-wide: resolving it
  // once here keeps the first doc-view mount below from suspending, so the no-`waitFor` assertions do
  // not depend on suite order.
  beforeAll(async () => {
    const { unmount } = renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }, { timeout: 5000 });
    unmount();
  });

  it('completes the About -> Document view swap synchronously with MotionGlobalConfig.skipAnimations', async () => {
    MotionGlobalConfig.skipAnimations = true;
    try {
      renderModal();
      // With animations skipped the swap completes after one microtask flush; `act()` lets
      // framer-motion's effects settle so no act warning leaks into a later test.
      await act(async () => {
        fireEvent.click(screen.getByTestId('legal-row-privacy'));
        await Promise.resolve();
      });
      expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
    } finally {
      MotionGlobalConfig.skipAnimations = false;
    }
  });

  it('completes the Document -> About view swap synchronously back', async () => {
    MotionGlobalConfig.skipAnimations = true;
    try {
      renderModal();
      await act(async () => {
        fireEvent.click(screen.getByTestId('legal-row-privacy'));
        await Promise.resolve();
      });
      expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        await Promise.resolve();
      });
      expect(screen.getByTestId('legal-grid')).toBeTruthy();
    } finally {
      MotionGlobalConfig.skipAnimations = false;
    }
  });
});

describe('accessible names — back button, language selector', () => {
  it('the back button and language toggle group carry accessible names', async () => {
    LEGAL.canonicalOrigin = 'https://petit-maker.example';
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }, { timeout: 5000 });

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Document language' })).toBeTruthy();
    // Static pages exist, but the doc view links to none.
    expect(screen.queryByRole('link', { name: /open as page/i })).toBeNull();
  });
});

describe('keyboard-only walkthrough', () => {
  // A real opener that mounts and unmounts AboutModal, as the app does, so ModalShell's opener
  // capture on mount and focus restore on unmount both run.
  function KeyboardHarness() {
    const [open, setOpen] = useState(false);
    return (
      <I18nProvider>
        <button onClick={() => setOpen(true)}>Open About</button>
        {open && <AboutModal open onClose={() => setOpen(false)} />}
      </I18nProvider>
    );
  }

  it('tab to a legal row, Enter opens the doc, tab reaches the language toggle and back, Escape closes and restores focus to the opener', async () => {
    render(<KeyboardHarness />);
    const opener = screen.getByRole('button', { name: 'Open About' });
    opener.focus();
    fireEvent.click(opener);

    const row = screen.getByTestId('legal-row-privacy');
    row.focus();
    expect(document.activeElement).toBe(row);
    // Enter on a focused <button> is a native click; jsdom lacks the PointerEvent framer-motion's
    // press gesture dispatches on keydown, so the click is fired directly.
    fireEvent.click(row);

    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });

    const langToggle = within(screen.getByRole('group', { name: 'Document language' })).getByRole('button', { name: '中文' });
    langToggle.focus();
    expect(document.activeElement).toBe(langToggle);

    const backBtn = screen.getByRole('button', { name: 'Back' });
    backBtn.focus();
    expect(document.activeElement).toBe(backBtn);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('legal-grid')).toBeNull(); // modal fully closed
    expect(document.activeElement).toBe(opener);
  });
});

// Cross-doc links switch the doc view in place rather than navigating out of the app.
describe('in-modal cross-doc links', () => {
  it('LegalMarkdown intercepts an internal slug link: preventDefault + onInternalLink(slugPath)', () => {
    const calls: string[] = [];
    const nodes = parseLegalMarkdown('See [Terms](/terms) and [external](https://example.org).');
    render(<LegalMarkdown nodes={nodes} onInternalLink={(p) => calls.push(p)} />);

    const internal = screen.getByRole('link', { name: 'Terms' });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    // left button, no modifiers
    Object.defineProperty(ev, 'button', { value: 0 });
    const prevented = !internal.dispatchEvent(ev);
    expect(prevented).toBe(true); // default navigation prevented
    expect(calls).toEqual(['/terms']);

    // external links are never intercepted
    const external = screen.getByRole('link', { name: 'external' });
    const ev2 = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(ev2, 'button', { value: 0 });
    external.dispatchEvent(ev2);
    expect(calls).toEqual(['/terms']); // unchanged
  });

  it('clicking a /terms link inside a doc in the modal switches the doc view (no navigation)', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <I18nProvider>
          <button onClick={() => setOpen(true)}>Open About</button>
          {open && <AboutModal open onClose={() => setOpen(false)} />}
        </I18nProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open About' }));

    // Open the Contact doc (its body links to /terms).
    fireEvent.click(screen.getByTestId('legal-row-contact'));
    await screen.findByRole('heading', { level: 1, name: 'Contact Us' });

    // Click the in-body "Terms of Use" link → switches to the Terms doc.
    fireEvent.click(screen.getByRole('link', { name: 'Terms of Use' }));
    await screen.findByRole('heading', { level: 1, name: 'Terms of Use' });

    // The previous doc's h1 is gone: the view switched in place.
    expect(screen.queryByRole('heading', { level: 1, name: 'Contact Us' })).toBeNull();
  });
});
