// @vitest-environment jsdom
/**
 * The view controls on the right in each input mode: a mouse gets the zoom pair and, in 3D, the two
 * turns; a finger, which pinches and twists, gets neither, and the kit is planned without their cells.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../state/editing/events';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { InputMode } from '../../../platform/device/input-mode';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { Rail } from '../../../ui/shell/Rail';
import { ViewKit } from '../../../ui/shell/controls/RailViewKit';
import { planFrame } from '../../../ui/shell/frame-plan';

function mount(inputMode: InputMode) {
  return render(
    <InputModeProvider inputMode={inputMode}><I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider></InputModeProvider>,
  );
}

const named = (key: Parameters<typeof translate>[0]) => screen.queryAllByRole('button', { name: translate(key) });
const kitRows = () => {
  const kit = screen.getByTestId('shell-view-kit');
  return [...kit.children].map((el) => (el as HTMLElement).style.gridRow).filter(Boolean);
};

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, viewMode: '3d', uiZoom: 1 });
});
afterEach(() => { cleanup(); useEditorStore.setState({ viewMode: '2d' }); });

describe('the view controls in each input mode', () => {
  spec('UI-35', 'in touch mode the 3D view offers no turn or zoom buttons and the kit holds only its own rows', () => {
    mount('touch');
    expect(named('a11y.rotate_left')).toHaveLength(0);
    expect(named('a11y.rotate_right')).toHaveLength(0);
    expect(named('a11y.zoom_in')).toHaveLength(0);
    expect(named('a11y.fit_view')).toHaveLength(1);
    const touchRows = kitRows();
    // Leaving 3D leaves the touch kit as it was: no cell was held for the turns.
    act(() => { useEditorStore.getState().setViewMode('2d'); });
    expect(kitRows()).toEqual(touchRows);
  });

  spec('UI-28', 'a panel standing up to undo and redo steps every view control under it aside, the view switch too', () => {
    const { rail } = planFrame(384, 790, { open: false, plateDepth: 0, shape: 'portrait', inputMode: 'touch', panelDepth: 2000 });
    expect(rail.kitRows).toBe(0);
    render(<InputModeProvider inputMode="touch" shape="portrait"><I18nProvider>
      <ViewKit plan={rail} right={0} hidden={false} onHide={() => {}} session={false} />
    </I18nProvider></InputModeProvider>);
    for (const key of ['a11y.toggle_view', 'a11y.hide_ui', 'a11y.fit_view'] as const) {
      expect(document.querySelector<HTMLElement>(`button[aria-label="${translate(key)}"]`)?.style.visibility, key).toBe('hidden');
    }
  });

  spec('UI-35', 'with a mouse the 3D view shows both turn buttons and the zoom pair', () => {
    mount('pc');
    expect(named('a11y.rotate_left')).toHaveLength(1);
    expect(named('a11y.rotate_right')).toHaveLength(1);
    expect(named('a11y.zoom_in')).toHaveLength(1);
  });
});
