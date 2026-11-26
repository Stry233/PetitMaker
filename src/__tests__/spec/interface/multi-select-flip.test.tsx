// @vitest-environment jsdom
/** The touch multi-select bar's Flip, beside its Rotate: it flips two or more selected objects as the
 *  selection card's Flip does, and waits while fewer are selected. */
import { afterEach, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { MultiSelectBar } from '../../../ui/shell/bars/selection/MultiSelectBar';
import { world } from '../_world';

afterEach(() => {
  cleanup();
  act(() => { useEditorStore.setState({ multiSelectLatched: false, selection: [] }); });
});

spec('BLUE-14', 'the multi-select bar\'s Flip, beside Rotate, mirrors the selected objects and waits while one is selected', () => {
  const w = world();
  const at = w.openGround(8, 6);
  const a = w.place('building-stall', at.x, at.y, { rotation: 90 });
  const b = w.place('building-stall', at.x + 3, at.y + 1);
  if (!a.ok || !b.ok) throw new Error('stall refused');
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [{ kind: 'object', id: a.id! }], multiSelectLatched: true });
  render(<InputModeProvider inputMode="touch" shape="portrait"><I18nProvider><MultiSelectBar /></I18nProvider></InputModeProvider>);

  const buttons = screen.getAllByRole('button').map((el) => el.textContent);
  const flip = screen.getByRole('button', { name: translate('shortcut.flip') });
  expect(buttons.indexOf(translate('shortcut.flip'))).toBe(buttons.indexOf(translate('a11y.rotate')) + 1);
  expect((flip as HTMLButtonElement).disabled).toBe(true);

  act(() => { useEditorStore.getState().setSelection([{ kind: 'object', id: a.id! }, { kind: 'object', id: b.id! }]); });
  expect((flip as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(flip);
  const look = (id: string) => { const o = w.object(id)!; return [o.position.x - at.x, o.position.y - at.y, o.rotation]; };
  expect([look(a.id!), look(b.id!)]).toEqual([[3, 0, 270], [0, 1, 0]]);
});
