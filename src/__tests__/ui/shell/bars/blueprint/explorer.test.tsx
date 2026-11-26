// @vitest-environment jsdom
/** The Blueprint strip unfolded into the library explorer: how each form opens and folds it, and how
 *  a mouse and a finger pick blueprints inside it. */
import { afterEach, beforeEach, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../../../_support/spec';
import { setStoreState } from '../../../../_support/store';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { regionRequestOf } from '../../../../../state/editing/region';
import { leaveBlueprintFrame } from '../../../../../editor/editing/blueprint';
import type { BlueprintRecord } from '../../../../../io/blueprint';
import type { InputMode } from '../../../../../platform/device/input-mode';
import type { LayoutShape } from '../../../../../platform/device/layout-shape';
import { backOut } from '../../../../../editor/back/back-out';
import { InputModeProvider } from '../../../../../ui/design/input-mode';
import { FrameLayoutProvider } from '../../../../../ui/shell/frame-layout';
import { BlueprintShelf } from '../../../../../ui/shell/bars/blueprint/BlueprintShelf';
import { MORPH_PIECE_ATTR } from '../../../../../ui/primitives/morph';
import { focusableWithin } from '../../../../../ui/primitives/surface-scope';
import { blueprintEditor, blueprintUi } from '../../../../spec/blueprints/_blueprints';

const { lib } = blueprintEditor();
afterEach(cleanup);

const BODY = { w: 3, h: 2, cells: Array(6).fill(null), objects: [] } as unknown as BlueprintRecord['body'];

function record(id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord {
  return {
    id, name, folder, author: null, origin: null, savedAt, appVersion: '0', body: BODY,
    thumbs: { flat: `data:image/png;base64,flat-${id}`, lifted: `data:image/png;base64,lifted-${id}` },
  };
}

beforeEach(async () => {
  await lib().save(record('a', 'Harbour', 'Docks', 4));
  await lib().save(record('b', 'Garden corner', 'Gardens', 3));
  await lib().save(record('c', 'Market street', null, 2));
  await lib().save(record('d', 'Pier', 'Docks', 1));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

function mount(shape: LayoutShape = 'landscape', inputMode: InputMode = 'pc') {
  if (shape === 'portrait') {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  }
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  return render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode={inputMode} shape={shape}>
        <I18nProvider><FrameLayoutProvider><BlueprintShelf /></FrameLayoutProvider></I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
}

const ui = blueprintUi;
const explorer = () => screen.queryByTestId('blueprint-explorer');
const card = (name: string) => within(screen.getByTestId('blueprint-explorer-cards')).getByRole('button', { name });
const selectedNames = () => [...screen.getByTestId('blueprint-explorer-cards').querySelectorAll('[data-blueprint-id]')]
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'));
const unfold = () => act(() => { fireEvent.click(screen.getByTestId('shell-blueprint-unfold')); });

spec('BLUE-03', 'the wide square unfolds the strip into the explorer and back', () => {
  mount();
  expect(explorer()).toBeNull();
  expect(screen.getByTestId('shell-blueprint-unfold').getAttribute('aria-pressed')).toBe('false');
  unfold();
  expect(ui().unfolded).toBe(true);
  const shown = explorer()!;
  // The folders stand as a list down the left with their counts, then New folder and Import.
  const folders = within(shown).getByRole('tablist', { name: 'Blueprint' });
  expect(within(folders).getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['All', 'Docks', 'Gardens']);
  expect(within(within(folders).getByRole('tab', { name: 'Docks' })).getByText('2')).toBeTruthy();
  expect(within(shown).getByRole('button', { name: 'New folder' })).toBeTruthy();
  expect(within(shown).getByRole('button', { name: 'Import' })).toBeTruthy();
  // No status line or action pills: a card is handled directly.
  expect(within(shown).queryByTestId('blueprint-status')).toBeNull();
  for (const name of ['Rename', 'Move to…', 'Export', 'Delete']) expect(within(shown).queryByRole('button', { name })).toBeNull();
  // The details list names each column and sorts by name.
  act(() => { fireEvent.click(within(shown).getByRole('button', { name: 'Details' })); });
  expect(ui().view).toBe('list');
  act(() => { fireEvent.click(within(shown).getByRole('button', { name: 'Name' })); });
  expect(ui().sort).toBe('name');
  const rows = within(screen.getByTestId('blueprint-explorer-cards')).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
  expect(rows).toEqual(['New blueprint', 'Garden corner', 'Harbour', 'Market street', 'Pier']);
  expect(within(screen.getByTestId('blueprint-explorer-cards')).getAllByText('3 × 2').length).toBe(4);
  const square = screen.getByTestId('shell-blueprint-fold');
  expect(square.getAttribute('aria-pressed')).toBe('true');
  act(() => { fireEvent.click(square); });
  expect(ui().unfolded).toBe(false);
  expect(explorer()).toBeNull();
  expect(screen.getByTestId('blueprint-cards')).toBeTruthy();
});

spec('UI-68', 'the explorer kept folded behind a warm square takes no focus and no press', () => {
  mount();
  const square = screen.getByTestId('shell-blueprint-unfold');
  act(() => { square.focus(); });
  const kept = explorer();
  expect(kept, 'focusing the square warms the explorer, kept folded').not.toBeNull();
  expect(ui().unfolded).toBe(false);
  expect(kept!.closest('[inert]')).not.toBeNull();
  expect(kept!.closest('[aria-hidden="true"]')).not.toBeNull();
  // Shift+Tab, again and again from the square, walks back through the page's tab order.
  const order = focusableWithin(document.body);
  const behind = order.slice(0, order.indexOf(square)).reverse();
  expect(behind.filter((el) => kept!.contains(el)), 'Shift+Tab lands in the folded explorer').toEqual([]);
  expect(screen.getAllByTestId('shell-blueprint-unfold')).toEqual([square]);
});

spec('BLUE-03', 'portrait unfolds only by the handle', async () => {
  mount('portrait', 'touch');
  expect(screen.queryByTestId('shell-blueprint-unfold')).toBeNull();
  const handle = () => screen.getByTestId('shell-blueprint-handle');
  const at = (y: number) => ({ bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0, buttons: 1, pointerId: 1 });
  const drag = async (from: number, to: number) => {
    fireEvent(handle(), new MouseEvent('pointerdown', at(from)));
    for (const y of [from + Math.sign(to - from) * 20, to]) {
      fireEvent(handle(), new MouseEvent('pointermove', at(y)));
      await act(async () => {});
    }
    fireEvent(handle(), new MouseEvent('pointerup', at(to)));
    await act(async () => {});
  };
  await drag(700, 300);
  expect(ui().unfolded).toBe(true);
  expect(explorer()).toBeTruthy();
  const kept = ui().uprightHeight;
  expect(kept).toBeGreaterThan(0);
  // Pulled back down past the turn it rests as the strip, and the height it stood at is kept.
  await drag(300, 840);
  expect(ui().unfolded).toBe(false);
  expect(explorer()).toBeNull();
  expect(ui().uprightHeight).toBe(kept);
});

spec('BLUE-03', 'Ctrl and Shift extend the selection with a mouse', () => {
  mount();
  unfold();
  act(() => { fireEvent.click(card('Harbour')); });
  expect(selectedNames()).toEqual(['Harbour']);
  act(() => { fireEvent.click(card('Market street'), { ctrlKey: true }); });
  expect(selectedNames()).toEqual(['Harbour', 'Market street']);
  act(() => { fireEvent.click(card('Harbour'), { ctrlKey: true }); });
  expect(selectedNames()).toEqual(['Market street']);
  // Shift reaches from the last card pressed to this one, in the order shown.
  act(() => { fireEvent.click(card('Garden corner')); });
  act(() => { fireEvent.click(card('Pier'), { shiftKey: true }); });
  expect(selectedNames()).toEqual(['Garden corner', 'Market street', 'Pier']);
  expect(ui().selected).toEqual(['b', 'c', 'd']);
});

spec('BLUE-03', '选择 turns on picking under touch', () => {
  mount('landscape', 'touch');
  unfold();
  // A tap selects one, without ticks.
  act(() => { fireEvent.click(card('Harbour')); });
  act(() => { fireEvent.click(card('Pier'), { ctrlKey: true }); });
  expect(selectedNames()).toEqual(['Pier']);
  expect(screen.queryAllByTestId('blueprint-tick')).toHaveLength(0);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Select' })); });
  expect(ui().picking).toBe(true);
  expect(screen.getAllByTestId('blueprint-tick')).toHaveLength(4);
  act(() => { fireEvent.click(card('Harbour')); });
  expect(selectedNames()).toEqual(['Harbour', 'Pier']);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
  expect(ui().picking).toBe(false);
  expect(screen.queryAllByTestId('blueprint-tick')).toHaveLength(0);
});

spec('BLUE-03', 'a double press folds and arms the blueprint', () => {
  mount();
  unfold();
  act(() => { fireEvent.click(card('Garden corner')); });
  act(() => { fireEvent.click(card('Garden corner'), { detail: 2 }); });
  expect(ui().unfolded).toBe(false);
  expect(ui().armed).toBe('b');
  expect(explorer()).toBeNull();
  expect(within(screen.getByTestId('blueprint-cards')).getByRole('button', { name: 'Garden corner' }).getAttribute('aria-pressed')).toBe('true');
});

spec('BLUE-03', 'Esc folds the explorer', () => {
  mount('landscape', 'touch');
  unfold();
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Select' })); });
  act(() => { expect(backOut()).toBe(true); });
  expect(ui().picking).toBe(false);
  expect(ui().unfolded).toBe(true);
  act(() => { expect(backOut()).toBe(true); });
  expect(ui().unfolded).toBe(false);
  expect(explorer()).toBeNull();
});

spec('BLUE-03', 'the wide explorer unfolded in touch mode wears no grip, and its fold button folds it', () => {
  mount('landscape', 'touch');
  unfold();
  expect(ui().unfolded).toBe(true);
  expect(screen.queryByRole('separator', { name: 'Resize the blueprint panel' })).toBeNull();
  act(() => { fireEvent.click(within(explorer()!).getByRole('button', { name: 'Expand' })); });
  expect(ui().unfolded).toBe(false);
  expect(explorer()).toBeNull();
});

spec('BLUE-03', 'the explorer head\'s search is a field with a mouse and in touch mode a round button that opens into it', () => {
  mount();
  unfold();
  const head = () => within(explorer()!);
  expect(head().getByRole('searchbox', { name: 'Search' })).toBeTruthy();
  expect(head().queryByRole('button', { name: 'Search' })).toBeNull();
  cleanup();
  act(() => { useEditorStore.getState().foldBlueprintExplorer(); });
  mount('landscape', 'touch');
  unfold();
  expect(head().queryByRole('searchbox')).toBeNull();
  const button = head().getByRole('button', { name: 'Search' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  act(() => { fireEvent.click(button); });
  expect(button.getAttribute('aria-expanded')).toBe('true');
  act(() => { fireEvent.change(head().getByRole('searchbox', { name: 'Search' }), { target: { value: 'pier' } }); });
  expect([...screen.getByTestId('blueprint-explorer-cards').querySelectorAll('[data-blueprint-id]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Pier']);
  // Closing it clears the search.
  act(() => { fireEvent.click(head().getByRole('button', { name: 'Search' })); });
  expect(head().queryByRole('searchbox')).toBeNull();
  expect(screen.getByTestId('blueprint-explorer-cards').querySelectorAll('[data-blueprint-id]')).toHaveLength(4);
});

/** Whether `el` stands with the search (the field, or upright its round button), apart from the folder names. */
function besideSearch(el: HTMLElement): boolean {
  const group = el.parentElement!.parentElement!;
  const search = within(group).queryByRole('searchbox', { name: 'Search' }) ?? within(group).queryByRole('button', { name: 'Search' });
  return !!search && !el.closest('[role=tablist]');
}

spec('BLUE-02', 'New blueprint is the first card and New folder a round button beside search, in every arrangement', async () => {
  for (const [shape, unfolded] of [['landscape', false], ['landscape', true], ['portrait', false], ['portrait', true]] as const) {
    const { unmount } = mount(shape, 'pc');
    if (unfolded) act(() => { useEditorStore.getState().unfoldBlueprintExplorer([]); });
    const at = `${shape}${unfolded ? ' unfolded' : ''}`;
    const view = screen.getByTestId(unfolded ? 'blueprint-explorer-cards' : 'blueprint-cards');
    expect(within(view).getAllByRole('button')[0]!.getAttribute('aria-label'), at).toBe('New blueprint');
    // The card is the only way to start one: no square or round plus besides it.
    expect(screen.getAllByRole('button', { name: 'New blueprint' }), at).toHaveLength(1);
    const folder = screen.getAllByRole('button', { name: 'New folder' });
    expect(folder, at).toHaveLength(1);
    expect(besideSearch(folder[0]!), at).toBe(true);
    // The names hold only folders.
    for (const list of screen.getAllByRole('tablist', { name: 'Blueprint' })) expect(within(list).queryByRole('button', { name: 'New folder' }), at).toBeNull();
    // It asks for the name under itself.
    act(() => { fireEvent.click(folder[0]!); });
    expect(await screen.findByRole('textbox'), at).toBeTruthy();
    expect(folder[0]!.getAttribute('aria-expanded'), at).toBe('true');
    unmount();
    act(() => { useEditorStore.getState().foldBlueprintExplorer(); });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  }
});

spec('BLUE-03', 'in the details list a card travels from its row\'s picture and the row\'s words fade in place', () => {
  for (const shape of ['landscape', 'portrait'] as const) {
    const { unmount } = mount(shape, 'pc');
    act(() => { useEditorStore.getState().unfoldBlueprintExplorer([], { view: 'list' }); });
    const list = screen.getByTestId('blueprint-explorer-cards');
    const pieceOf = (el: Element | null) => el?.getAttribute(MORPH_PIECE_ATTR) ?? null;
    for (const row of within(list).getAllByRole('button')) {
      const id = row.getAttribute('data-blueprint-id');
      // The row itself is no piece: a card scaled to a row's width would stretch across the list.
      expect(pieceOf(row), shape).toBeNull();
      const shared = [...row.querySelectorAll(`[${MORPH_PIECE_ATTR}]`)].filter((el) => !pieceOf(el)!.startsWith('row:'));
      expect(shared.map(pieceOf), shape).toEqual([id ? `card:${id}` : 'new-card']);
      // The shared piece is the picture, holding no words, so no text is scaled on the way.
      expect(shared[0]!.textContent, shape).toBe('');
      // Every word of the row stands in a piece of its own the strip has no match for, which fades.
      const words = [...row.querySelectorAll(`[${MORPH_PIECE_ATTR}^="row:"]`)].map((el) => el.textContent).join('');
      expect(words.length, shape).toBeGreaterThan(0);
      expect(words, shape).toBe(row.textContent);
    }
    unmount();
    act(() => { useEditorStore.getState().foldBlueprintExplorer({ view: 'grid' }); });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  }
});

spec('BLUE-02', 'the details list starts with a New blueprint row, wide and upright', () => {
  for (const shape of ['landscape', 'portrait'] as const) {
    const { unmount } = mount(shape, 'pc');
    act(() => { useEditorStore.getState().unfoldBlueprintExplorer([], { view: 'list' }); });
    const rows = within(screen.getByTestId('blueprint-explorer-cards')).getAllByRole('button');
    expect(rows[0]!.getAttribute('aria-label'), shape).toBe('New blueprint');
    act(() => { fireEvent.click(rows[0]!); });
    expect(regionRequestOf(useEditorStore.getState()).tools, shape).toEqual(['rect']);
    unmount();
    act(() => { leaveBlueprintFrame(); useEditorStore.getState().setBlueprintUi({ view: 'grid' }); });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  }
});
