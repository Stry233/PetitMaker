// @vitest-environment jsdom
/**
 * The wide object shelf whose names, beside the brush button and the whole search field, would have less
 * room than two of them need: the field folds to the upright shelf's search button, which grows into the
 * field and back (UI-28). jsdom lays nothing out, so the names row's room and each name's width are
 * stated to bring the shelf to its folded form; where it folds is `searchFolds`' to hold, and the
 * drawn result a browser's.
 */
import { describe, expect, beforeEach, afterEach, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { ScaleProvider } from '../../../ui/design/scale';
import { ModeBar } from '../../../ui/shell/controls/ModeBar';
import { SEARCH, searchFolds, twoNamesWide } from '../../../ui/shell/bars/objects/object-shelf';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';

const en = (key: string): string => translations.en[key]!;
const s = () => useEditorStore.getState();

/** The names row's width and each name's, in the row's px, as a browser would lay them out. */
const NAME = 120;
const room = { row: 0 };
/** The row the brush button, the whole field and two names need. */
const fits = SEARCH.inset + SEARCH.group.w + twoNamesWide([NAME, NAME]);
const isNamesRow = (el: Element) => !!el.querySelector(':scope > div > [role="tablist"]');
const restore: (() => void)[] = [];
function stub(prop: 'clientWidth' | 'offsetWidth', read: (el: HTMLElement) => number | null) {
  const owner = prop === 'offsetWidth' ? HTMLElement.prototype : Element.prototype;
  const was = Object.getOwnPropertyDescriptor(owner, prop)!;
  Object.defineProperty(owner, prop, {
    configurable: true,
    get(this: HTMLElement) { return read(this) ?? was.get!.call(this); },
  });
  restore.push(() => Object.defineProperty(owner, prop, was));
}

function mount(row: number) {
  room.row = row;
  act(() => { s().setEditMode({ mode: 'object', arm: { kind: 'none' } }); });
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ModeBar mode="object" surface={null} />
        </ScaleProvider>
      </I18nProvider>
    </MotionConfig>,
  );
}

const searchButton = () => screen.getByRole('button', { name: en('shelf.search') });

beforeEach(() => {
  resetStore();
  useEditorStore.setState({ locale: 'en' });
  stub('clientWidth', (el) => (isNamesRow(el) ? room.row : null));
  stub('offsetWidth', (el) => (el.getAttribute('role') === 'tab' ? NAME : null));
});

afterEach(() => {
  cleanup();
  while (restore.length) restore.pop()!();
});

describe('the wide shelf short of room', () => {
  spec('UI-28', 'the folded search field is a search button after the brush button, which opens into the field and closes clearing it', () => {
    mount(fits - 1);
    expect(screen.queryByRole('searchbox'), 'the field is folded').toBeNull();
    const brush = screen.getByTestId('shell-shelf-brush');
    expect(brush.compareDocumentPosition(searchButton()) & Node.DOCUMENT_POSITION_FOLLOWING, 'the search button is on the right').toBeTruthy();
    expect(searchButton().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(searchButton());
    const field = screen.getByRole('searchbox', { name: en('shelf.search') });
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('tablist', { hidden: true }).closest('[aria-hidden="true"]'), 'the names fade under the open field').toBeTruthy();
    fireEvent.change(field, { target: { value: 'rose' } });
    expect(screen.getAllByRole('button', { name: /rose/i }).length).toBeGreaterThan(0);
    fireEvent.click(searchButton());
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('tablist', { hidden: true }).closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole('tab', { name: en('shelf.tab_flora') }), 'closing cleared the search').toBeTruthy();
  });
});

describe('searchFolds', () => {
  it('folds once the names would have less than two names of room, and unfolds only with a gap to spare, so it never flips at one width', () => {
    const lead = 26;
    const least = twoNamesWide([90, 150, 120]);
    expect(least, 'the two widest names and the gap between them').toBe(150 + 120 + 14);
    const fit = lead + SEARCH.group.w + least;
    expect(searchFolds(false, { row: fit, lead, least })).toBe(false);
    expect(searchFolds(false, { row: fit - 1, lead, least })).toBe(true);
    for (let row = fit - 40; row <= fit + 40; row++) {
      const folded = searchFolds(false, { row, lead, least });
      expect(searchFolds(folded, { row, lead, least }), `stable at ${row}`).toBe(folded);
    }
    expect(searchFolds(true, { row: fit + 1, lead, least }), 'just past the fold point stays folded').toBe(true);
    expect(searchFolds(true, { row: fit + 40, lead, least })).toBe(false);
  });
});
