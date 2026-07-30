import { describe, it, expect, vi } from 'vitest';
import { ShortcutManager } from '../../tools/shortcut-manager';

function makeKeyEvent(
  key: string,
  opts: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; code?: string; target?: Partial<HTMLElement> } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: opts.code ?? '',
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
  });

  // Override target since JSDOM KeyboardEvent constructor doesn't accept it
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target });
  }

  return event;
}

describe('ShortcutManager', () => {
  it('fires action on matching key', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('t', action);

    const e = makeKeyEvent('t');
    const spy = vi.spyOn(e, 'preventDefault');
    mgr.handleKeyDown(e);

    expect(action).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
  });

  it('ignores non-registered keys', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('t', action);

    mgr.handleKeyDown(makeKeyEvent('x'));

    expect(action).not.toHaveBeenCalled();
  });

  it('supports Ctrl+key combos', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('ctrl+z', action);

    mgr.handleKeyDown(makeKeyEvent('z', { ctrlKey: true }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not fire Ctrl combo without Ctrl held', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('ctrl+z', action);

    mgr.handleKeyDown(makeKeyEvent('z'));

    expect(action).not.toHaveBeenCalled();
  });

  it('supports Ctrl+Shift combos', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('ctrl+shift+z', action);

    mgr.handleKeyDown(makeKeyEvent('z', { ctrlKey: true, shiftKey: true }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('supports Alt combos and does not fire them without Alt', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('alt+b', action);

    mgr.handleKeyDown(makeKeyEvent('b'));
    expect(action).not.toHaveBeenCalled();
    mgr.handleKeyDown(makeKeyEvent('b', { altKey: true }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('a plain-key binding does not fire when Alt is held', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('b', action);

    mgr.handleKeyDown(makeKeyEvent('b', { altKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('matches numpad keys by event.code, independent of the top-row digit', () => {
    const mgr = new ShortcutManager();
    const numAction = vi.fn();
    const topAction = vi.fn();
    mgr.register('num5', numAction);
    mgr.register('5', topAction);

    mgr.handleKeyDown(makeKeyEvent('5', { code: 'Numpad5' }));
    expect(numAction).toHaveBeenCalledTimes(1);
    expect(topAction).not.toHaveBeenCalled();

    mgr.handleKeyDown(makeKeyEvent('5', { code: 'Digit5' }));
    expect(topAction).toHaveBeenCalledTimes(1);
    expect(numAction).toHaveBeenCalledTimes(1); // unchanged
  });

  it('ignores events when input is focused', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('t', action);

    mgr.handleKeyDown(makeKeyEvent('t', { target: { tagName: 'INPUT' } as HTMLElement }));
    mgr.handleKeyDown(makeKeyEvent('t', { target: { tagName: 'TEXTAREA' } as HTMLElement }));
    mgr.handleKeyDown(makeKeyEvent('t', { target: { tagName: 'SELECT' } as HTMLElement }));

    expect(action).not.toHaveBeenCalled();
  });
});
