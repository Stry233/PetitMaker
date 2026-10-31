// @vitest-environment jsdom
/**
 * The object shelf's brush button and the brush bar it opens, as a person reaches them: the bottom
 * bar mounted as the shell mounts it, its cards and buttons found by their names and pressed.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { translateFor } from '../../../i18n/context';
import { ScaleProvider } from '../../../ui/design/scale';
import { ModeBar } from '../../../ui/shell/controls/ModeBar';
import { useEditorStore } from '../../../state/store';
import { armedItemOf, armedPicksOf } from '../../../state/editing/edit-mode';
import { getCatalogItem } from '../../../state/catalog';
import { resetStore } from '../../_support/store';

const ROSE = 'flower-rose';
const DAISY = 'flower-daisy';
const CABIN = 'building-forest-cabin';
const en = (key: string): string => translations.en[key]!;
const s = () => useEditorStore.getState();
const nameOf = (id: string) => getCatalogItem(id)!.name.en!;

function mount(item: string | null) {
  act(() => { s().setEditMode({ mode: 'object', arm: item ? { kind: 'item', itemId: item } : { kind: 'none' } }); });
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

const brushButton = () => screen.getByTestId('shell-shelf-brush');
const card = (id: string) => screen.getByRole('button', { name: nameOf(id) });

beforeEach(() => {
  resetStore();
  useEditorStore.setState({ locale: 'en' });
});

afterEach(() => cleanup());

describe('the brush button', () => {
  spec('EDIT-64', 'opens the brush bar in the shelf\'s place, and Done gives the shelf back with the card armed and the way kept', () => {
    mount(ROSE);
    expect(screen.queryByTestId('shell-object-brush')).toBeNull();
    fireEvent.click(brushButton());
    expect(screen.getByTestId('shell-object-brush')).toBeTruthy();
    expect(screen.getByRole('button', { name: en('objects.place') }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('group', { name: en('terrain.shapes') }), 'the shape is for Paint only').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en('objects.paint') }));
    expect(s().objectBrush).toBe('paint');
    expect(screen.getByRole('group', { name: en('terrain.shapes') })).toBeTruthy();
    expect(screen.getByRole('slider', { name: en('objects.spacing') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en('objects.brush_done') }));
    expect(screen.queryByTestId('shell-object-brush')).toBeNull();
    expect(armedItemOf(s())).toBe(ROSE);
    expect(s().objectBrush).toBe('paint');
    expect(card(ROSE).getAttribute('aria-pressed')).toBe('true');
  });

  spec('EDIT-68', 'wears the active state while Paint is chosen, and changes nothing else when it is', () => {
    mount(ROSE);
    expect(brushButton().getAttribute('aria-pressed')).toBe('false');
    act(() => { s().setObjectBrush('paint'); });
    expect(brushButton().getAttribute('aria-pressed')).toBe('true');
    expect(brushButton().getAttribute('aria-label')).toBe(en('objects.brush'));
  });

  spec('EDIT-64', 'stands before the search in the names row on every tab', () => {
    mount(ROSE);
    const search = screen.getByRole('searchbox', { name: en('shelf.search') });
    expect(brushButton().compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING, 'the search is on the right').toBeTruthy();
    const group = search.parentElement!.parentElement!;
    expect(group.contains(brushButton())).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: en('shelf.tab_bridge') }));
    expect(group.contains(brushButton()), 'the button stays where nothing paints').toBe(true);
    expect(screen.getByRole('searchbox', { name: en('shelf.search') }).parentElement!.parentElement).toBe(group);
  });

  spec('EDIT-69', 'is unavailable on a tab or search showing only items placed one at a time, and says why', () => {
    mount(null);
    fireEvent.click(screen.getByRole('tab', { name: en('shelf.tab_bridge') }));
    expect(brushButton().getAttribute('aria-disabled')).toBe('true');
    expect(brushButton().getAttribute('aria-label')).toBe(en('objects.row_one_at_a_time'));
    fireEvent.click(brushButton());
    expect(s().objectBrushBar).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: en('shelf.tab_flora') }));
    expect(brushButton().getAttribute('aria-disabled')).not.toBe('true');
    expect(brushButton().getAttribute('aria-label')).toBe(en('objects.brush'));
    fireEvent.change(screen.getByRole('searchbox', { name: en('shelf.search') }), { target: { value: 'zzzz-nothing' } });
    expect(brushButton().getAttribute('aria-label'), 'a search showing nothing paints nothing').toBe(en('objects.row_one_at_a_time'));
  });

  spec('EDIT-64', 'opens with nothing armed, and the way chosen there applies to the next card picked', () => {
    mount(null);
    fireEvent.click(screen.getByRole('tab', { name: en('shelf.tab_flora') }));
    expect(brushButton().getAttribute('aria-disabled')).not.toBe('true');
    expect(brushButton().getAttribute('aria-label')).toBe(en('objects.brush'));
    fireEvent.click(brushButton());
    expect(screen.getByTestId('shell-object-brush')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en('objects.paint') }));
    fireEvent.click(screen.getByRole('button', { name: en('objects.brush_done') }));
    fireEvent.click(card(ROSE));
    expect(armedItemOf(s())).toBe(ROSE);
    expect(s().objectBrush).toBe('paint');
    expect(brushButton().getAttribute('aria-pressed')).toBe('true');
  });

  spec('EDIT-69', 'is unavailable with a one-of-a-kind item or the planting card armed, and says why', () => {
    mount(CABIN);
    act(() => { s().setObjectBrush('paint'); });
    expect(brushButton().getAttribute('aria-disabled')).toBe('true');
    expect(brushButton().getAttribute('aria-label')).toBe(en('objects.one_at_a_time'));
    expect(brushButton().getAttribute('aria-pressed'), 'Paint does not show for an item it cannot lay').toBe('false');
    fireEvent.click(brushButton());
    expect(screen.queryByTestId('shell-object-brush')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: en('shelf.tab_flora') }));
    fireEvent.click(screen.getByRole('button', { name: en('smart.patch') }));
    expect(brushButton().getAttribute('aria-disabled')).toBe('true');
    expect(brushButton().getAttribute('aria-label')).toBe(translateFor('en', 'objects.patch_own'));
    fireEvent.click(brushButton());
    expect(s().objectBrushBar).toBe(false);
  });
});

describe('several cards', () => {
  spec('EDIT-70', 'Ctrl+click adds a card to the armed ones and takes it out again; a plain click arms one alone', () => {
    mount(ROSE);
    fireEvent.click(card(DAISY), { ctrlKey: true });
    expect(armedPicksOf(s())).toEqual([ROSE, DAISY]);
    expect(card(ROSE).getAttribute('aria-pressed')).toBe('true');
    expect(card(DAISY).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(card(ROSE), { metaKey: true });
    expect(armedPicksOf(s())).toEqual([DAISY]);
    fireEvent.click(card(ROSE), { ctrlKey: true });
    fireEvent.click(card(ROSE));
    expect(armedPicksOf(s())).toEqual([ROSE]);
  });
});
