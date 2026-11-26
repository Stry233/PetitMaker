// @vitest-environment jsdom
/**
 * Backing out (UI-12) where keyboard focus and floating surfaces meet the map: Escape follows the
 * order states were entered in, not where focus was left, and keys inside an open question stay there.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useRef, useState } from 'react';
import { spec } from '../../_support/spec';
import { world } from '../_world';
import { placeItem } from '../editing/_editing';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { makeJob, makeView, panelProps, renderWithI18n } from '../../_support/agent-panel';
import { useEditorStore } from '../../../state/store';
import { useKeybinds } from '../../../state/keymap/store';
import { ToolType } from '../../../state/editing/vocabulary';
import { I18nProvider } from '../../../i18n/context';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { ExpandedField } from '../../../ui/agent/composer/ExpandedField';
import { ModalShell } from '../../../ui/primitives/ModalShell';
import { AnchoredConfirm } from '../../../ui/primitives/AnchoredConfirm';
import { useEditorShortcuts } from '../../../ui/shell/use-editor-shortcuts';
import { watchBackKey } from '../../../editor/back/back-out';
import { ShelfSearchField } from '../../../ui/shell/bars/objects/ShelfSearchField';
import { AwayOwner } from '../../../ui/primitives/away';
import { useContextHelp } from '../../../ui/help/use-context-help';
import { Shell } from '../../../ui/shell/Shell';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import type { PlacedObject } from '../../../core/model/types';

const TREE = 'tree-apple';
const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };
const s = () => useEditorStore.getState();

/** Two trees on open ground, opened in the editor with the Hand tool up. */
function openMap(): { a: PlacedObject; b: PlacedObject } {
  const w = world();
  const at = w.openGround(10, 6);
  const a = placeItem(w, TREE, { x: at.x + 1, y: at.y + 1 })!;
  const b = placeItem(w, TREE, { x: at.x + 5, y: at.y + 1 })!;
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  return { a, b };
}

let release = (): void => {};
beforeEach(() => {
  resetStore();
  useKeybinds.getState().resetAll();
  release = watchBackKey();
});
afterEach(() => {
  cleanup();
  release();
  useKeybinds.getState().resetAll();
});

describe('Escape follows the order states were entered in', () => {
  spec('UI-12', 'with focus left on an assistant button, Escape clears a map selection made after it and leaves the panel open', () => {
    const { a } = openMap();
    s().setAssistantOpen(true);
    const ui = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    const button = ui.getByTestId('panel-shell').querySelector('button')!;
    button.focus();
    act(() => { s().setSelection([{ kind: 'object', id: a.id }]); });
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(s().selection).toEqual([]);
    expect(s().assistantOpen).toBe(true);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(s().assistantOpen).toBe(false);
  });

  spec('UI-12', 'Escape on a question inside the assistant closes the question alone', async () => {
    s().setAssistantOpen(true);
    const ui = renderWithI18n(<PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />);
    fireEvent.click(ui.getByTestId('composer-stop'));
    const cancel = ui.getByTestId('dock-confirm-cancel');
    fireEvent.keyDown(cancel, { key: 'Escape' });
    await waitFor(() => expect(ui.queryByTestId('dock-confirm-stop')).toBeNull());
    expect(s().assistantOpen).toBe(true);
  });

  spec('UI-12', 'a map selection made while the expanded composer stands clears first, then the card folds', () => {
    const { a } = openMap();
    const onClose = vi.fn();
    function Card() {
      const anchor = useRef<HTMLDivElement | null>(null);
      return <ExpandedField anchor={anchor} open seat={{ height: 40, rect: { left: 10, top: 400, width: 300, height: 40 } }} reduced
        value="a long draft" placeholder="" disabled={false} onChange={() => {}} onSend={() => {}} onClose={onClose} />;
    }
    const ui = render(<MotionConfig reducedMotion="always"><I18nProvider><Card /></I18nProvider></MotionConfig>);
    act(() => { s().setSelection([{ kind: 'object', id: a.id }]); });
    const field = ui.getByTestId('composer-expanded-input');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(s().selection).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  spec('UI-12', 'Escape in a search field clears its words first, and backs out once it is empty', () => {
    s().setAssistantOpen(true);
    function Search() {
      const [value, setValue] = useState('');
      return <ShelfSearchField value={value} onChange={setValue} ariaLabel="Search" />;
    }
    const ui = render(<I18nProvider><Search /></I18nProvider>);
    const field = ui.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'tree' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('');
    expect(s().assistantOpen).toBe(true);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(s().assistantOpen).toBe(false);
  });

  spec('UI-12', 'rebinding the back key moves every back-out, windows included', () => {
    useKeybinds.getState().rebind('selection.deselect', 'q');
    const onClose = vi.fn();
    render(<I18nProvider><ModalShell open onClose={onClose} ariaLabel="Window"><button type="button">Inside</button></ModalShell></I18nProvider>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'q' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('the back key itself', () => {
  spec('UI-12', 'with the back command left unbound, Escape still closes a window, a menu or a question, and nothing on the map', () => {
    const { a } = openMap();
    useKeybinds.getState().clear('selection.deselect');
    s().setSelection([{ kind: 'object', id: a.id }]);
    const onClose = vi.fn();
    render(<I18nProvider><ModalShell open onClose={onClose} ariaLabel="Window"><button type="button">Inside</button></ModalShell></I18nProvider>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(s().selection).toEqual([{ kind: 'object', id: a.id }]);
  });

  spec('UI-21', 'What\'s this? ends on the back key as it is bound, the newest state while it stands', () => {
    const { a } = openMap();
    useKeybinds.getState().rebind('selection.deselect', 'q');
    s().setSelection([{ kind: 'object', id: a.id }]);
    function Help() { useContextHelp(); return null; }
    render(<I18nProvider><Help /></I18nProvider>);
    act(() => { s().setWhatsThis(true); });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(s().whatsThis).toBe(true);
    fireEvent.keyDown(document.body, { key: 'q' });
    expect(s().whatsThis).toBe(false);
    expect(s().selection).toEqual([{ kind: 'object', id: a.id }]);
  });

  spec('UI-12', 'with the interface hidden, Escape first shows it again, and only then backs out of what stood under it', () => {
    const { a } = openMap();
    useEditorStore.setState({ locale: 'en' });
    // A browser already offered the tour, so no welcome window stands over the map.
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    const ui = render(<MotionConfig reducedMotion="always"><I18nProvider><Shell><div data-testid="map-views" /></Shell></I18nProvider></MotionConfig>);
    act(() => { s().setSelection([{ kind: 'object', id: a.id }]); });
    const veiled = () => ui.getByTestId('shell-frame-veil').style.visibility === 'hidden';
    act(() => { fireEvent.click(ui.getByRole('button', { name: 'Hide interface' })); });
    expect(veiled()).toBe(true);
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(veiled()).toBe(false);
    expect(s().selection).toEqual([{ kind: 'object', id: a.id }]);
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(s().selection).toEqual([]);
  });
});

describe('keys inside an open question', () => {
  spec('UI-12', 'Delete, R, the turn key and Ctrl+A pressed inside a question reach nothing on the map', () => {
    const { a, b } = openMap();
    s().setSelection([{ kind: 'object', id: a.id }]);
    const rotation = () => [a.id, b.id].map((id) => s().gridState!.objects.get(id)?.rotation);
    const before = rotation();
    function Asking() {
      useEditorShortcuts({ toggleMenu: () => {} });
      const trigger = useRef<HTMLButtonElement>(null);
      const [open] = useState(true);
      return <>
        <button ref={trigger} type="button">Ask</button>
        {open && <AnchoredConfirm anchor={{ x: 100, y: 100 }} trigger={trigger} title="Delete folder?" cancelLabel="Cancel" confirmLabel="Delete"
          onCancel={() => {}} onConfirm={() => {}} cancelTestId="ask-cancel" />}
      </>;
    }
    const ui = render(<MotionConfig reducedMotion="always"><I18nProvider><Asking /></I18nProvider></MotionConfig>);
    const inside = ui.getByTestId('ask-cancel');
    for (const key of ['Delete', 'Backspace', 'r', 'e']) fireEvent.keyDown(inside, { key });
    fireEvent.keyDown(inside, { key: 'a', ctrlKey: true });
    expect(s().gridState!.objects.has(a.id) && s().gridState!.objects.has(b.id)).toBe(true);
    expect(s().deletePopover).toBeNull();
    expect(s().selection).toEqual([{ kind: 'object', id: a.id }]);
    expect(rotation()).toEqual(before);
  });
});

describe('surfaces that are away', () => {
  spec('UI-12', 'a folded or leaving assistant offers no control', () => {
    for (const away of ['folded', 'leaving'] as const) {
      const ui = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, away, ...VERBS })} />);
      expect(within(ui.container).queryAllByRole('button'), away).toEqual([]);
      ui.unmount();
    }
  });

  spec('UI-12', 'a question portaled out of a hidden owner goes away with it, so Escape passes it over and reaches the state under it', () => {
    s().setAssistantOpen(true);
    const onCancel = vi.fn();
    function Owner({ hidden }: { hidden: boolean }) {
      const trigger = useRef<HTMLButtonElement>(null);
      return <AwayOwner away={hidden}>
        <button ref={trigger} type="button">Ask</button>
        <AnchoredConfirm anchor={{ x: 100, y: 100 }} trigger={trigger} title="Delete folder?" cancelLabel="Cancel" confirmLabel="Delete"
          onCancel={onCancel} onConfirm={() => {}} />
      </AwayOwner>;
    }
    const ui = render(<MotionConfig reducedMotion="always"><I18nProvider><Owner hidden={false} /></I18nProvider></MotionConfig>);
    expect(ui.getByRole('dialog', { name: 'Delete folder?' })).toBeTruthy();
    ui.rerender(<MotionConfig reducedMotion="always"><I18nProvider><Owner hidden /></I18nProvider></MotionConfig>);
    expect(ui.queryByRole('dialog', { name: 'Delete folder?' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(s().assistantOpen).toBe(false);
  });
});
