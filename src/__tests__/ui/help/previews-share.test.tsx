/** Save, share, and search Help figures mounted with real UI components and map state. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor, act } from '@testing-library/react';
import { I18nProvider, localizedName } from '../../../i18n/context';
import { getCatalogItem } from '../../../state/catalog';
import { setReducedMotion, __resetMotionState } from '../../../core/runtime/motion-state';
import { makeState } from '../../rules/_helpers';
import { setStoreState } from '../../_store';
import { en } from '../../../i18n/locales/en';
import {
  SavePreview, SharePreview, ImportPreview, JsonPreview, ChecklistPreview, CandidatesPreview,
  SearchPreview,
} from '../../../ui/chrome/modals/help/figures/previews/share';
import { SEARCH_EXAMPLE_IDS, searchExamples } from '../../../ui/chrome/modals/help/search-examples';

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

  it('SearchPreview mounts the real ObjectShelf and types the alias example into its own field, whose real ranking answers with its item', () => {
    vi.useFakeTimers();
    try {
      const { container } = mount(SearchPreview);
      // `helpTargetAttr('objects')` is the shelf's own root marker (`ObjectShelf.tsx`): its
      // presence is what says this figure mounts the real component, not a redrawn fragment.
      expect(container.querySelector('[data-help="objects"]')).toBeTruthy();
      const input = container.querySelector<HTMLInputElement>('input.pw-search-field');
      expect(input).toBeTruthy();
      // Walk to the alias step with a finite bound on the animation cycle.
      const { aliasLatin } = searchExamples('en');
      for (let i = 0; i < 80 && input!.value !== aliasLatin; i++) {
        act(() => { vi.advanceTimersByTime(400); });
      }
      expect(input!.value).toBe(aliasLatin);
      // The alias is authored on one item with exactly one hit, so the card standing under the field
      // can only have come through the shelf's own ranking. The frame carries `aria-hidden` by
      // design (§PreviewFrame); the role query opts back in to see past it.
      const peach = localizedName(getCatalogItem(SEARCH_EXAMPLE_IDS.alias)!.name, 'en');
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
      expect(input!.value).toBe(searchExamples('en').enTypo);
      // The frozen query still flows through the shelf's own ranking: the subsequence match
      // stands as a card, under the real category tabs and search field around it.
      const apple = localizedName(getCatalogItem(SEARCH_EXAMPLE_IDS.name)!.name, 'en');
      expect(screen.getByRole('button', { name: apple, hidden: true })).toBeTruthy();
    } finally {
      __resetMotionState();
    }
  });
});
