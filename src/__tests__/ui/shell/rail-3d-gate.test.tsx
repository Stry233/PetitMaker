/**
 * The 3D toggle on a device that cannot draw the scene.
 *
 * three r169 needs WebGL2. Without it the scene build throws, so the press that offered a view
 * would end in a toast and a return to 2D: the button says what it can do before it is pressed,
 * and pressing it says why rather than flipping the store and coming back.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Rail } from '../../../ui/shell/Rail';

const gl = vi.hoisted(() => ({ webgl2: true }));
vi.mock('../../../core/runtime/device-quality', async (orig) => ({
  ...(await orig<object>()),
  hasWebGL2: () => gl.webgl2,
}));

const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('../../../ui/chrome/floating/Toast', () => ({ showToast: (...args: unknown[]) => toast.show(...args) }));

const toggle = () => screen.getByLabelText('Switch view');

beforeEach(() => {
  window.innerHeight = 900;
  toast.show.mockClear();
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, viewMode: '2d', uiZoom: 1,
  });
});
afterEach(() => { cleanup(); gl.webgl2 = true; });

function mount() {
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

describe('the view toggle without WebGL2', () => {
  it('reads as unavailable and says so instead of switching', () => {
    gl.webgl2 = false;
    mount();
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(toggle());
    expect(useEditorStore.getState().viewMode).toBe('2d');
    expect(toast.show.mock.calls).toEqual([
      ['The 3D view could not start in this browser, so the map stays in 2D.', 'error'],
    ]);
  });

  it('switches the view where the device can draw it', () => {
    mount();
    expect(toggle().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(toggle());
    expect(useEditorStore.getState().viewMode).toBe('3d');
    expect(toast.show).not.toHaveBeenCalled();
  });
});
