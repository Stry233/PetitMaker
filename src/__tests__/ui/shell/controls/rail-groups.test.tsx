// @vitest-environment jsdom
/**
 * The right-hand column as a user meets it: the view kit offers the turns in 3D only, a short window
 * folds the groups without removing a control, every button has its own name, and hiding the
 * interface leaves only the way back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { HISTORY_BUTTONS, KIT_BUTTONS, railCell } from '../../../../ui/shell/frame';
import { Rail } from '../../../../ui/shell/Rail';

function mountAt(windowHeight: number) {
  window.innerHeight = windowHeight;
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

/** The kit's own box: the one group with no test id of its own, found by a button it always holds. */
const kit = () => screen.getByLabelText('Switch view').parentElement as HTMLElement;
/** The two turns, matched by their two distinct names so a shared label would fail. */
const turns = () => [
  ...screen.queryAllByLabelText('Rotate left'),
  ...screen.queryAllByLabelText('Rotate right'),
];
const COLUMN = ['Undo', 'Redo', 'Switch view', 'Hide interface', 'Fit to view', 'Zoom in', 'Zoom out'];

beforeEach(() => {
  window.innerHeight = 900;
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, viewMode: '2d', uiZoom: 1,
  });
});
afterEach(() => {
  cleanup();
  useEditorStore.setState({ uiZoom: 1, viewMode: '2d' });
});

describe('the view kit', () => {
  it('offers the two turns in 3D only', () => {
    mountAt(900);
    expect(turns(), '2D cannot orbit, so it does not offer the button').toHaveLength(0);
    act(() => { useEditorStore.getState().setViewMode('3d'); });
    expect(turns()).toHaveLength(2);
  });
});

describe('a button gives its name', () => {
  /** The plate inside a button, the shape that opens. */
  const plate = (label: string) => screen.getByLabelText(label).firstElementChild as HTMLElement;

  /** Folding rearranges; it never removes a control. The pill opens in every arrangement, so a
   *  native tooltip would say the name twice. */
  it('keeps every control, its name in its pill and no native tooltip, folded or not', () => {
    for (const h of [1200, 396]) {
      mountAt(h);
      for (const label of COLUMN) {
        expect(plate(label).textContent, `${h}px: ${label} carries its own name`).toContain(label);
        expect(screen.getByLabelText(label).getAttribute('title'), `${h}px: ${label}`).toBeNull();
      }
      cleanup();
    }
  });

  /** Read in 3D, where the turns that differ only by direction are present. */
  it('gives no two buttons of the column the same name', () => {
    const view = mountAt(1200);
    act(() => { useEditorStore.getState().setViewMode('3d'); });
    const labels = [...view.container.querySelectorAll('button[aria-label]')]
      .map((b) => b.getAttribute('aria-label')!);
    expect(labels.length).toBeGreaterThan(HISTORY_BUTTONS + KIT_BUTTONS);
    expect([...new Set(labels)].sort()).toEqual([...labels].sort());
  });
});

describe('the hide toggle', () => {
  it('stands in the view kit, in the place the design source gives it', () => {
    mountAt(1200);
    const labels = [...kit().children].map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['Switch view', 'Hide interface', 'Fit to view', 'Zoom in', 'Zoom out']);
  });

  it('is the only button of the column left standing once the interface is away', () => {
    render(<I18nProvider><Rail hidden onHide={() => {}} /></I18nProvider>);
    const shown = (label: string) => (screen.getByLabelText(label) as HTMLElement).style.visibility;
    expect(shown('Show interface')).toBe('visible');
    for (const label of COLUMN.filter((l) => l !== 'Hide interface')) {
      expect(shown(label), `${label} is drawn away`).toBe('hidden');
    }
  });
});

/** The column hangs off the window's right edge, so a lone button in a row's left cell would notch it. */
describe('a folded group fills from the right', () => {
  it('puts the hole on the inside, whatever the count is', () => {
    expect(railCell(0, 5, 1)).toEqual({ column: 1, row: 1 });
    expect(railCell(4, 5, 1)).toEqual({ column: 1, row: 5 });
    expect(railCell(1, 2, 2)).toEqual({ column: 2, row: 1 });
    expect(railCell(3, 5, 2)).toEqual({ column: 2, row: 2 });
    expect(railCell(4, 5, 2)).toEqual({ column: 2, row: 3 });
    expect(railCell(4, 7, 2)).toEqual({ column: 1, row: 3 });
    expect(railCell(6, 7, 2)).toEqual({ column: 2, row: 4 });
  });
});
