// @vitest-environment jsdom
/**
 * The press that switches the input mode still acts on the control it was pressed on. A control's
 * touch hit area exists only in touch mode, so a switch applied between the release and its click
 * would take away the element the click is dispatched to.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { watchInputMode } from '../../../platform/device/input-mode';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { useInputMode } from '../../../ui/session/use-input-mode';
import { CornerActions } from '../../../ui/shell/controls/CornerActions';

const STILL = { initial: false, animate: {}, exit: {}, transition: {} };

function Corner() {
  const mode = useInputMode();
  return (
    <I18nProvider>
      <InputModeProvider inputMode={mode}>
        <CornerActions inSession={false} swap={STILL} menuOpen={false} toggleMenu={() => {}} menuButton={createRef()} />
      </InputModeProvider>
    </I18nProvider>
  );
}

function mouse(type: string, target: Element): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  Object.assign(e, { pointerType: 'mouse', pointerId: 1 });
  target.dispatchEvent(e);
}

/** Lets the store's update render, as it does between a release and its click in a browser. */
const settle = () => act(() => new Promise<void>((r) => { queueMicrotask(r); }));

let stop: () => void;
beforeEach(() => {
  setStoreState({ locale: 'en', inputMode: 'touch' });
  stop = watchInputMode((m) => useEditorStore.getState().setInputMode(m), 'touch');
});
afterEach(() => {
  stop();
  cleanup();
  act(() => { useEditorStore.getState().setModal('share', false); });
});

describe('a mouse press in touch mode', () => {
  spec('UI-27', 'a mouse click on a control in touch mode activates it, then the editor switches to PC mode', async () => {
    render(<Corner />);
    const share = screen.getByRole('button', { name: 'Save and share' });
    // The press lands on the touch hit area, which stands inside the control.
    const reach = share.lastElementChild!;
    expect(reach.tagName).toBe('SPAN');
    mouse('pointerdown', reach);
    mouse('mousedown', reach);
    mouse('pointerup', reach);
    mouse('mouseup', reach);
    await settle();
    mouse('click', reach);
    expect(useEditorStore.getState().modals.share).toBe(true);
    await act(() => new Promise((r) => { setTimeout(r, 20); }));
    expect(useEditorStore.getState().inputMode).toBe('pc');
  });
});
