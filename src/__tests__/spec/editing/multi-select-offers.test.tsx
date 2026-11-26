// @vitest-environment jsdom
/** The touch multi-select bar's row offers what the selection card would for the same selection:
 *  it greys an action the selection cannot take instead of running a press that is refused. */
import { afterEach, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { PlanetSession } from '../../../state/slices/planet-session';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { MultiSelectBar } from '../../../ui/shell/bars/selection/MultiSelectBar';
import { world } from '../_world';

afterEach(() => {
  cleanup();
  act(() => { useEditorStore.setState({ multiSelectLatched: false, selection: [], planetSession: null }); });
});

const ACTIONS = ['rotate', 'flip', 'move', 'copy', 'delete'] as const;
const offered = () => ACTIONS.filter((id) => !(screen.getByTestId(`multi-select-${id}`) as HTMLButtonElement).disabled);

spec('EDIT-43', 'the multi-select bar offers each action where the selection card would, in the planet editor and on a locked object too', () => {
  const w = world();
  const at = w.openGround(8, 6);
  const a = w.place('building-stall', at.x, at.y);
  const b = w.place('building-stall', at.x + 3, at.y + 1);
  if (!a.ok || !b.ok) throw new Error('stall refused');
  const one = [{ kind: 'object' as const, id: a.id! }];
  const two = [...one, { kind: 'object' as const, id: b.id! }];
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: two, multiSelectLatched: true });
  render(<InputModeProvider inputMode="touch" shape="portrait"><I18nProvider><MultiSelectBar /></I18nProvider></InputModeProvider>);
  expect(offered(), 'several objects').toEqual(['rotate', 'flip', 'move', 'copy', 'delete']);

  act(() => { useEditorStore.setState({ planetSession: {} as PlanetSession }); });
  expect(offered(), 'several objects in the planet editor').toEqual(['rotate', 'move', 'delete']);

  act(() => { useEditorStore.setState({ planetSession: null, selection: one }); });
  expect(offered(), 'one object').toEqual(['rotate', 'move', 'delete']);

  w.object(a.id!)!.locked = true;
  act(() => { useEditorStore.setState({ selection: [...one] }); });
  expect(offered(), 'one locked object').toEqual(['move']);

  act(() => { useEditorStore.setState({ selection: [] }); });
  expect(offered(), 'nothing selected').toEqual([]);
});
