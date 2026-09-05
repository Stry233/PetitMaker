/** Save, share, and search Help figures mounted with real UI components and map state. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor, act } from '@testing-library/react';
import { I18nProvider, localizedName } from '../../../i18n/context';
import { getCatalogItem } from '../../../state/catalog';
import { setReducedMotion, __resetMotionState } from '../../../canvas/map2d/motion-state';
import { ItemCategory, type Locale } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { setStoreState } from '../../_store';
import { en } from '../../../i18n/locales/en';
import { shelfItems } from '../../../ui/shell/bars/object-shelf';
import {
  SavePreview, SharePreview, ImportPreview, JsonPreview, ChecklistPreview, CandidatesPreview,
  SearchPreview, SEARCH_STEPS_BY_LOCALE,
} from '../../../ui/chrome/modals/help/figures/previews/share';

vi.mock('../../../canvas/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../canvas/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

function mount(Preview: () => JSX.Element) {
  return render(<I18nProvider><Preview /></I18nProvider>);
}

beforeEach(() => {
  setStoreState({ gridState: makeState(20, 20), locale: 'en' });
});

afterEach(cleanup);

describe('save/share/search Help figures mount the real components', () => {
  it('SavePreview mounts RestoreShelf over the visitor\'s own map once it holds anything', () => {
    const state = makeState(20, 20);
    state.objects.set('t1', { id: 't1', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });
    setStoreState({ gridState: state, locale: 'en' });
    mount(SavePreview);
    expect(screen.getByTestId('restore-card')).toBeTruthy();
  });

  it('SavePreview stands a built island in for an empty map', async () => {
    mount(SavePreview);
    await waitFor(() => expect(screen.getByTestId('restore-card')).toBeTruthy(), { timeout: 10_000 });
  }, 15_000);

  it('SharePreview mounts ExportPreview', async () => {
    const { container } = mount(SharePreview);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(en['export.load_t']!)).toBeTruthy());
  });

  it('ImportPreview mounts the real drop zone at the import card\'s own geometry, click copy and all', () => {
    mount(ImportPreview);
    expect(screen.getByText(en['import.title']!)).toBeTruthy();
    // The no-op click keeps the modal's click-to-choose line rather than the drag-only wording.
    expect(screen.getByText(en['import.drop']!)).toBeTruthy();
    expect(screen.getByText(en['import.note']!)).toBeTruthy();
  });

  it('JsonPreview mounts ExportJsonPanel', () => {
    const { container } = mount(JsonPreview);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('ChecklistPreview lists the visitor\'s own map once it holds anything', () => {
    const state = makeState(20, 20);
    state.objects.set('t1', { id: 't1', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });
    setStoreState({ gridState: state, locale: 'en' });
    mount(ChecklistPreview);
    expect(screen.getByTestId('checklist-copy-button')).toBeTruthy();
  });

  it('ChecklistPreview stands a built island in for an empty map', async () => {
    mount(ChecklistPreview);
    // The island builds after first paint (a designed run), so the list arrives a beat later.
    await waitFor(() => expect(screen.getByTestId('checklist-copy-button')).toBeTruthy(), { timeout: 10_000 });
  }, 15_000);

  it('CandidatesPreview mounts three real CandidateCards', () => {
    mount(CandidatesPreview);
    expect(screen.getByTestId('shell-candidate-4127')).toBeTruthy();
    expect(screen.getByTestId('shell-candidate-90210')).toBeTruthy();
    expect(screen.getByTestId('shell-candidate-5551')).toBeTruthy();
  });

  it('SearchPreview mounts the real ObjectShelf and types "sakura" into its own field, whose real ranking answers with the peach tree', () => {
    vi.useFakeTimers();
    try {
      const { container } = mount(SearchPreview);
      // `helpTargetAttr('objects')` is the shelf's own root marker (`ObjectShelf.tsx`): its
      // presence is what says this figure mounts the real component, not a redrawn fragment.
      expect(container.querySelector('[data-help="objects"]')).toBeTruthy();
      const input = container.querySelector<HTMLInputElement>('input.pw-search-field');
      expect(input).toBeTruthy();
      // Walk to the alias step with a finite bound on the animation cycle.
      for (let i = 0; i < 80 && input!.value !== 'sakura'; i++) {
        act(() => { vi.advanceTimersByTime(400); });
      }
      expect(input!.value).toBe('sakura');
      // "sakura" is an authored alias with exactly one hit, so the card standing under the field
      // can only have come through the shelf's own ranking. The frame carries `aria-hidden` by
      // design (§PreviewFrame); the role query opts back in to see past it.
      const peach = localizedName(getCatalogItem('tree-peach')!.name, 'en');
      expect(screen.getByRole('button', { name: peach, hidden: true })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('SearchPreview stands frozen on the typo step under reduced motion', () => {
    setReducedMotion(true);
    try {
      const { container } = mount(SearchPreview);
      const input = container.querySelector<HTMLInputElement>('input.pw-search-field');
      expect(input!.value).toBe('aple');
      // The frozen query still flows through the shelf's own ranking: the subsequence match
      // stands as a card, under the real category tabs and search field around it.
      const apple = localizedName(getCatalogItem('tree-apple')!.name, 'en');
      expect(screen.getByRole('button', { name: apple, hidden: true })).toBeTruthy();
    } finally {
      __resetMotionState();
    }
  });

  it('every locale\'s posed query still finds something through the real shelf ranking', () => {
    // A data pin, not a mount: a catalog rename or a dropped alias breaks a query's match
    // silently in the posed figure (the shelf just shows its "nothing found" state), so this
    // walks every table's every step through the real pipeline and fails loudly instead.
    for (const locale of Object.keys(SEARCH_STEPS_BY_LOCALE) as Locale[]) {
      for (const step of SEARCH_STEPS_BY_LOCALE[locale]) {
        const results = shelfItems(step.query, ItemCategory.Tree, locale);
        expect(results.length, `${locale} "${step.query}" (${step.captionKey})`).toBeGreaterThan(0);
      }
    }
  });
});
