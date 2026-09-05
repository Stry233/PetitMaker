/**
 * Accessibility acceptance criteria for the legal surfaces:
 *
 *  - full keyboard-only walkthrough (open a doc, reach the language toggle,
 *    Escape closes the modal, focus returns to the opener);
 *  - the ModalShell focus trap + Escape handler (shared by all 7 modals —
 *    unit-tested directly in `src/__tests__/ui/primitives/modal-shell.test.tsx`; this
 *    file only exercises them through the real About/LegalDocView surface);
 *  - accessible names for the back button, the language selector, and the
 *    "open page" link;
 *  - WCAG contrast: `PROSE` text colors vs `panelCream`, and the About
 *    footer's `textSecondary` usage vs `panelCream`;
 *  - table wrapper `overflow-x: auto` on the React side (the static-page
 *    emitter's `.tbl` wrapper already has it — this pins parity);
 *  - reduced motion: with `MotionGlobalConfig.skipAnimations = true`, the
 *    About-modal A<->B view transition completes synchronously;
 *  - heading hierarchy: every rendered doc has exactly one h1, and heading
 *    levels never skip a level going deeper.
 *
 * "Opener" in the keyboard-walkthrough harness below = the DOM element that
 * had focus at the moment the modal mounted — the same as a real menu button
 * in `App.tsx` (`onClick={() => setShowAbout(true)}` immediately followed by
 * `{showAbout && <AboutModal ... />}`): native post-click focus stays on the
 * button that was clicked, and that's the only element `ModalShell` can
 * plausibly return focus to when it closes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useState } from 'react';
import { MotionGlobalConfig } from 'framer-motion';
import { AboutModal } from '../../ui/chrome/modals/AboutModal';
import { LegalMarkdown } from '../../legal/LegalMarkdown';
import { parseLegalMarkdown } from '../../legal/markdown';
import { DOCS, docNodes, type DocId } from '../../legal/registry';
import { LEGAL } from '../../legal/config';
import { I18nProvider } from '../../i18n/context';
import { TourOverlay } from '../../ui/chrome/tour/TourOverlay';
import { SHELL_TOUR_STEPS } from '../../ui/shell/tour-steps';
import { startTour } from '../../ui/chrome/tour/use-tour';
import { useEditorStore } from '../../state/store';
import { colors } from '../../ui/design/styles';
import { setStoreState } from '../_store';

// ── WCAG 2.x relative-luminance contrast ratio, computed from the hex tokens
//    themselves (no external library) — the same formula as
//    https://www.w3.org/TR/WCAG21/#dfn-relative-luminance. ─────────────────
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

/** A rendered inline color as hex. jsdom normalises `color`/`background` to `rgb(r, g, b)`, so a
 *  contrast check on what an element ACTUALLY renders has to come back through this. */
function renderedHex(value: string): string {
  const rgb = /rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (rgb) return `#${rgb.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
  const hex = /#[0-9a-f]{6}/i.exec(value);
  if (!hex) throw new Error(`not a color: ${value}`);
  return hex[0];
}

function renderModal(onClose: () => void = () => {}) {
  return render(
    <I18nProvider>
      <AboutModal onClose={onClose} />
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
  it('PROSE body text (colors.textPrimary) passes against panelCream', () => {
    expect(contrastRatio(colors.textPrimary, colors.panelCream)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('the raw textSecondary token FAILS at 4.5:1 against panelCream (why it cannot be used for small body text)', () => {
    // The About footer's small-print disclaimer therefore takes `colors.brownText` instead;
    // putting textSecondary back there trips this file rather than failing AA silently.
    expect(contrastRatio(colors.textSecondary, colors.panelCream)).toBeLessThan(AA_BODY_TEXT);
  });

  it('colors.brownText (the token used for the About footer disclaimer/© line) passes against panelCream', () => {
    expect(contrastRatio(colors.brownText, colors.panelCream)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it('colors.brownText (used for the zh-only note / doc footer bar) passes against surfaceSecondary too', () => {
    // The zh-only note sits on `surfaceSecondary`, not `panelCream` — a
    // slightly darker background, so it needs its own check.
    expect(contrastRatio(colors.brownText, colors.surfaceSecondary)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("the brand lockup's tagline passes AA on both surfaces it appears on", () => {
    // BrandLockup's tagline is colors.brownText. It renders on the About modal's card
    // (surfacePrimary) and, once the tour's welcome step lands, on a white bubble.
    expect(contrastRatio(colors.brownText, colors.surfacePrimary)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
    expect(contrastRatio(colors.brownText, colors.white)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
  });

  it("the tour bubble's body, skip link and progress counter pass AA against the bubble's own background", () => {
    // Rendered, not tokens: a pair of assertions over `colors.brownText` stays green with
    // TourOverlay reverted to the failing textSecondary, which is what it is meant to catch. The
    // background comes off the card too, so the check cannot drift from the surface it is about.
    startTour();
    try {
      render(<I18nProvider><TourOverlay steps={SHELL_TOUR_STEPS} /></I18nProvider>);
      const card = screen.getByRole('dialog');
      const surface = renderedHex(card.style.background);
      const texts = [
        screen.getByText(/^Plan a map here/),          // the step's body
        screen.getByRole('button', { name: 'Skip tour' }),
        screen.getByText(/^Step 1 of/),
      ];
      for (const el of texts) {
        expect(contrastRatio(renderedHex(el.style.color), surface)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
      }
    } finally {
      act(() => { useEditorStore.getState().setTourRunning(false); });
    }
  });

  it('the rendered About-modal disclaimer text is NOT set in the failing textSecondary color', () => {
    renderModal();
    const disclaimer = screen.getByText(LEGAL_DISCLAIMER_MATCH());
    const style = disclaimer.getAttribute('style') ?? '';
    expect(style).not.toContain(colors.textSecondary);
  });

  // These small-text elements use the darker brown required for AA contrast on the About surface.
  it('the tagline is NOT set in the failing textSecondary color', () => {
    renderModal();
    const tagline = screen.getByText('Map Editor');
    expect(tagline.getAttribute('style') ?? '').not.toContain(colors.textSecondary);
  });

  it('the version-card lines are NOT set in the failing textSecondary color', () => {
    renderModal();
    const versionLine = screen.getByText(/^Version /);
    expect(versionLine.getAttribute('style') ?? '').not.toContain(colors.textSecondary);
  });

  it('both section titles (Team, Legal & policies) are NOT set in the failing textSecondary color', () => {
    renderModal();
    for (const title of [screen.getByText('Team'), screen.getByText('Legal & policies')]) {
      expect(title.getAttribute('style') ?? '').not.toContain(colors.textSecondary);
    }
  });

  it('the ICP filing link (legally-mandated) is NOT set in the failing textSecondary color', () => {
    LEGAL.icpNumber = '京ICP备12345678号';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderModal();
    const filingLink = screen.getByRole('link', { name: /京ICP备12345678号/ });
    expect(filingLink.getAttribute('style') ?? '').not.toContain(colors.textSecondary);
  });
});

// The disclaimer's i18n key resolves through `useT`; match loosely by role/
// text-content instead of hardcoding the English string twice.
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

  // `docNodes` (not the raw parser) — same node tree LegalDocView renders,
  // incl. the synthetic-h1 fallback for a raw doc with no markdown heading
  // (LICENSE, pinned byte-exact by license-files.test.ts).
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
  // `LegalDocView` is a `React.lazy` chunk (the legal bundle stays
  // out of the main chunk until a doc is opened). The lazy() wrapper memoizes
  // its resolved payload on the module-level object itself, independent of
  // any one render tree — so warming it here with one real `await` means
  // every later mount in this file (including the assertions below that
  // must NOT use `waitFor`) sees it already resolved and renders
  // synchronously. Without this warm-up the FIRST doc-view mount in the
  // process always suspends for a microtask regardless of motion settings,
  // which would make the "no waitFor" assertion flaky on suite ordering.
  beforeAll(async () => {
    const { unmount } = renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });
    unmount();
  });

  it('completes the About -> Document view swap synchronously with MotionGlobalConfig.skipAnimations', async () => {
    MotionGlobalConfig.skipAnimations = true;
    try {
      renderModal();
      // No `waitFor` (no polling/retry) — with animations globally skipped,
      // the transition is done after one microtask flush. `act()` here is
      // not a retry loop, just the standard React-batching boundary around
      // that single flush so framer-motion's post-transition effects settle
      // before we assert (and don't leak an act warning into a later test).
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
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Document language' })).toBeTruthy();
    // There is no in-modal "open as page" link (static pages exist, but
    // the doc view carries no external link).
    expect(screen.queryByRole('link', { name: /open as page/i })).toBeNull();
  });
});

describe('keyboard-only walkthrough', () => {
  // Harness: a real "opener" button (focus lands here before the modal opens,
  // matching App.tsx's `onClick={() => setShowAbout(true)}` immediately
  // followed by conditional-mount) that mounts/unmounts AboutModal itself, so
  // ModalShell's mount-time opener capture + unmount-time restore both fire
  // for real, exactly as they would in the app.
  function KeyboardHarness() {
    const [open, setOpen] = useState(false);
    return (
      <I18nProvider>
        <button onClick={() => setOpen(true)}>Open About</button>
        {open && <AboutModal onClose={() => setOpen(false)} />}
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
    // A real Tab+Enter activates a focused <button> natively in every
    // browser; jsdom has no PointerEvent (framer-motion's press gesture
    // dispatches one on a synthesized keydown-Enter), so — matching every
    // other row-activation test in this suite (see about-modal.test.tsx) —
    // the click is fired directly as Enter's behavioral equivalent.
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

// In-modal cross-doc links must switch the doc view in place, not
// full-page navigate out of the SPA.
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
          {open && <AboutModal onClose={() => setOpen(false)} />}
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

    // The previous doc's h1 is gone — the view switched in place.
    expect(screen.queryByRole('heading', { level: 1, name: 'Contact Us' })).toBeNull();
  });
});
