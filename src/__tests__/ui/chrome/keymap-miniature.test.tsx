/**
 * The keymap miniature in Settings is a picture of the LIVE bindings, not a stock icon: each
 * bindable keycap wears its command's category tint at the base layer, and clearing a binding
 * repaints that cap to the plain plate. These pin the liveness and the geometry (one rect per
 * non-spacer key of the typing block).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { KeymapMiniature } from '../../../ui/chrome/modals/keyboard/KeymapMiniature';
import { CATEGORY_COLOR, KEY_ROWS } from '../../../ui/chrome/modals/keyboard/layout';
import { bindingIndex, useKeybinds } from '../../../core/runtime/keybindings';
import { COMMAND_BY_ID } from '../../../kit/commands';

afterEach(() => {
  act(() => useKeybinds.getState().resetAll());
  cleanup();
});

const fills = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll('rect')).map((r) => r.getAttribute('fill') ?? '');

describe('the keymap miniature', () => {
  it('draws one cap per non-spacer key of the typing block', () => {
    const { container } = render(<KeymapMiniature />);
    const expected = KEY_ROWS.slice(1).flat().filter((k) => !k.spacer).length;
    expect(container.querySelectorAll('rect')).toHaveLength(expected);
  });

  it('tints caps by the bound command category, and repaints when a binding clears', () => {
    const index = bindingIndex({});
    const cmdId = index.get('1');
    expect(cmdId).toBeTruthy();
    const category = COMMAND_BY_ID.get(cmdId!)!.category;
    const tint = CATEGORY_COLOR[category];

    const { container } = render(<KeymapMiniature />);
    const before = fills(container).filter((f) => f === tint).length;
    expect(before).toBeGreaterThan(0);

    act(() => { useKeybinds.getState().clear(cmdId!); });
    const after = fills(container).filter((f) => f === tint).length;
    expect(after).toBe(before - 1);
  });
});
