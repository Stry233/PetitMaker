// About modal — two-view drill-in host + lazy legal doc viewer.
//
// LEGAL config: the filing/origin fields are mutated in-place per test (the export
// is a plain, non-frozen object; the component reads LEGAL at render). We snapshot
// the launch-default values once and restore them in afterEach so tests stay
// order-independent and never leak the placeholder state into other suites. This
// is the smallest-footprint way to exercise the "row count / filing rows follow
// config" matrix without mocking a module the registry + docBody also read.
//
// Assertions use plain DOM checks (getAttribute / toBeTruthy / toBeNull) — this
// repo does not register @testing-library/jest-dom, matching sibling UI tests.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { AboutModal } from '../../../ui/chrome/modals/AboutModal';
import { I18nProvider } from '../../../i18n/context';
import { LEGAL } from '../../../legal/config';
import { teamInReadingOrder } from '../../../legal/registry';
import { en } from '../../../i18n/locales/en';
import { APP_NAME, APP_VERSION, BUILD_NUMBER, BUILD_SHA, BUILD_DATE } from '../../../version';
import { setStoreState } from '../../_store';

function renderModal(onClose: () => void = () => {}) {
  return render(
    <I18nProvider>
      <AboutModal onClose={onClose} />
    </I18nProvider>,
  );
}

const snapshot = {
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
  Object.assign(LEGAL, snapshot);
  vi.useRealTimers();
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

// jsdom has no Clipboard API by default — define it fresh per test so each
// suite gets its own vi.fn() spy without leaking into siblings.
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
  return (navigator as unknown as { clipboard: { writeText: ReturnType<typeof vi.fn> } }).clipboard.writeText;
}

const EXPECTED_BUILD_LINE = `${APP_NAME} ${APP_VERSION} (build ${BUILD_NUMBER}, ${BUILD_SHA}, ${BUILD_DATE})`;

describe('AboutModal — view A (About)', () => {
  it('renders exactly the 8 legal doc rows (clean 2×4 grid, no About-in-About row)', () => {
    renderModal();
    const grid = screen.getByTestId('legal-grid');
    // 8 drill-in doc rows (privacy…changelog; the About doc is view A itself).
    // There is no origin-gated "open the About page" row — it would duplicate view A.
    expect(within(grid).getAllByRole('button')).toHaveLength(8);
    expect(screen.queryByTestId('legal-open-page-row')).toBeNull();
  });

  it('never shows an in-grid open-About-page row even when canonicalOrigin is configured', () => {
    LEGAL.canonicalOrigin = 'https://petit-maker.example';
    renderModal();
    const grid = screen.getByTestId('legal-grid');
    expect(within(grid).getAllByRole('button')).toHaveLength(8);
    expect(screen.queryByTestId('legal-open-page-row')).toBeNull();
  });

  it('renders no filing rows when config has none', () => {
    renderModal();
    expect(screen.queryByTestId('filing-icp')).toBeNull();
    expect(screen.queryByTestId('filing-psb')).toBeNull();
  });

  it('renders the ICP filing row with a link only when the complete pair is set (spec §18.9)', () => {
    LEGAL.icpNumber = '京ICP备2026000000号-1';
    LEGAL.icpUrl = 'https://beian.miit.gov.cn/';
    renderModal();
    const icp = screen.getByTestId('filing-icp');
    expect(icp).toBeTruthy();
    const link = within(icp).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://beian.miit.gov.cn/');
    expect(link.textContent).toContain('京ICP备2026000000号-1');
    // PSB is an incomplete pair (number null) → absent.
    expect(screen.queryByTestId('filing-psb')).toBeNull();
  });
});

describe('AboutModal — team avatar cards', () => {
  it('renders one card per member, each an external Bilibili link with the name aria-label', () => {
    renderModal();
    const cards = screen.getAllByTestId('team-member');
    expect(cards).toHaveLength(LEGAL.team.length);
    // Cards follow the alphabet, not LEGAL.team's array order — the roster must
    // never read as a ranking (the same helper orders the About doc's table, so
    // the two surfaces cannot disagree).
    const ordered = teamInReadingOrder(LEGAL.team);
    cards.forEach((card, i) => {
      const member = ordered[i]!;
      expect(card.getAttribute('href')).toBe(member.url);
      expect(card.getAttribute('target')).toBe('_blank');
      expect(card.getAttribute('rel')).toContain('noopener');
      expect(card.getAttribute('aria-label')).toContain(member.name);
    });
  });

  it('states that the order carries no meaning', () => {
    renderModal();
    expect(screen.getByText(en['about.team_order'] as string)).toBeTruthy();
  });

  it('runs A to Z by romanized name, with Han and Latin names interleaved', () => {
    const keys = teamInReadingOrder(LEGAL.team).map((m) => m.sort);
    expect(keys).toEqual([...keys].sort());
    // The point of romanizing: a locale collator cannot produce this sequence.
    // ICU zh sorts Han by pinyin but puts Latin script after ALL of it, and en
    // orders Han by code point, so neither interleaves by leading letter.
    expect(keys.map((k) => k[0])).toEqual(['h', 'j', 's', 'y']);
    const byZhCollator = [...LEGAL.team].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    expect(byZhCollator.map((m) => m.sort[0])).toEqual(['h', 'j', 'y', 's']);
  });

  it('gives every member a lowercase letters-only sort key that starts like the name', () => {
    for (const m of LEGAL.team) {
      expect(m.sort).toMatch(/^[a-z]+$/);
      // A Latin name must romanize to itself, so a typo cannot go unnoticed.
      if (/^[A-Za-z]/.test(m.name)) expect(m.sort).toBe(m.name.toLowerCase());
    }
  });

  it('renders an avatar <img> per member with alt = the member name', () => {
    renderModal();
    for (const member of LEGAL.team) {
      const img = screen.getByAltText(member.name) as HTMLImageElement;
      expect(img.tagName).toBe('IMG');
      // Vite resolves the static import to a non-empty URL at build time.
      expect(img.getAttribute('src')).toBeTruthy();
    }
    const grid = screen.getByTestId('team-grid');
    expect(within(grid).getAllByRole('img')).toHaveLength(LEGAL.team.length);
  });
});

describe('AboutModal — close affordance (View A only)', () => {
  it('renders the OK button on View A and it calls onClose', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    const ok = screen.getByRole('button', { name: 'Done' });
    expect(ok).toBeTruthy();
    fireEvent.click(ok);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the OK button on View B (the doc view)', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
  });
});

describe('AboutModal — drill-in to the doc view', () => {
  it('opens the Privacy doc and renders its English h1 from the real source', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
  });

  it('toggles the document language to 中文, swapping the body and the container lang', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });

    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(await screen.findByRole('heading', { level: 1, name: '隐私政策' })).toBeTruthy();
    expect(screen.getByTestId('legal-doc-body').getAttribute('lang')).toBe('zh-CN');
  });

  it('returns to the About view via Back', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByTestId('legal-grid')).toBeTruthy();
  });

  it('moves focus to the doc title on open and restores it to the triggering row on back', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));

    const title = await screen.findByRole('heading', { level: 2, name: 'Privacy Policy' });
    await waitFor(() => expect(document.activeElement).toBe(title));

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('legal-row-privacy'));
    });
  });

  it('never renders a doc-view open-page link, even when origin is set (in-modal affordance removed)', async () => {
    LEGAL.canonicalOrigin = 'https://petit-maker.example';
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-privacy'));
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });
    // The static /privacy page still exists: what the modal does not carry is a link out to it.
    expect(screen.queryByRole('link', { name: /open as page/i })).toBeNull();
  });

  it('shows the en-only note and no language toggle for an English-only doc when the UI is non-English', async () => {
    setStoreState({ locale: 'zh' });
    renderModal();
    fireEvent.click(screen.getByTestId('legal-row-license'));
    expect(await screen.findByTestId('en-only-note')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '中文' })).toBeNull();
  });
});

describe('AboutModal — click version row to copy build info', () => {
  it('copies the composed "{app} {version} (build …, sha, date)" line via navigator.clipboard.writeText', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    renderModal();
    const row = screen.getByRole('button', { name: 'Copy version info' });
    fireEvent.click(row);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText).toHaveBeenCalledWith(EXPECTED_BUILD_LINE);
  });

  it('never rewrites the row\'s own text — a floating bubble carries the "Copied" confirmation, then unmounts after ~1.2s', async () => {
    // Animations globally skipped (same idiom as a11y.test.tsx's view-swap
    // tests) so the AnimatePresence enter/exit settle in one microtask flush
    // instead of racing framer-motion's real spring/rAF physics under fake
    // timers.
    MotionGlobalConfig.skipAnimations = true;
    vi.useFakeTimers();
    try {
      stubClipboard(() => Promise.resolve());
      renderModal();
      const row = screen.getByRole('button', { name: 'Copy version info' });
      const originalText = row.textContent;

      expect(screen.queryByText('Copied')).toBeNull();

      // Flush the click + the awaited writeText() microtask so setCopied(true)
      // commits and the bubble mounts.
      await act(async () => {
        fireEvent.click(row);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('Copied')).toBeTruthy();
      // The row underneath is untouched throughout.
      expect(row.textContent).toBe(originalText);

      // Advance past the ~1.2s auto-dismiss timer.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200);
      });
      expect(screen.queryByText('Copied')).toBeNull();
      expect(row.textContent).toBe(originalText);
    } finally {
      MotionGlobalConfig.skipAnimations = false;
    }
  });

  it('never throws when the Clipboard API is unavailable (insecure context / denied) — silent no-op, no bubble', async () => {
    // No navigator.clipboard stub at all in this test — mirrors an insecure
    // context where the property is simply absent.
    renderModal();
    const row = screen.getByRole('button', { name: 'Copy version info' });
    expect(() => fireEvent.click(row)).not.toThrow();
    // Give the rejected/absent-clipboard microtask a tick to settle; no
    // confirmation bubble should ever mount.
    await waitFor(() => {
      expect(screen.queryByText('Copied')).toBeNull();
    });
  });

  it('activates on Enter — it is a real <button>, so the browser owns the Enter→click mapping', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    renderModal();
    const row = screen.getByRole('button', { name: 'Copy version info' });
    // A real <button> (not a div/span with onClick) gets Enter/Space→click for
    // free from the browser's native semantics; jsdom doesn't synthesize that
    // mapping (and firing a raw keydown trips framer-motion's own internal
    // PointerEvent-based press handling, which jsdom also lacks), so the
    // meaningful, non-flaky assertion is the semantic guarantee plus the same
    // click path a keyboard Enter would dispatch natively.
    expect(row.tagName).toBe('BUTTON');
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.click(row);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(EXPECTED_BUILD_LINE);
    });
  });

  it('the confirmation bubble is an aria-live="polite" status region', async () => {
    stubClipboard(() => Promise.resolve());
    renderModal();
    const row = screen.getByRole('button', { name: 'Copy version info' });
    fireEvent.click(row);
    const bubble = await screen.findByRole('status');
    expect(bubble.getAttribute('aria-live')).toBe('polite');
    expect(bubble.textContent).toContain('Copied');
  });
});
