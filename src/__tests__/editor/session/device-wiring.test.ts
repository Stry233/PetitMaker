// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { installDeviceWiring } from '../../../editor/session/device-wiring';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_support/store';

function pointer(type: string, pointerType: string): void {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { pointerType, pointerId: 1 });
  window.dispatchEvent(e);
}

/** The click a release dispatches, run to the end of its dispatch. */
function click(): void {
  window.dispatchEvent(new Event('click'));
  vi.advanceTimersByTime(0);
}

describe('the device wiring', () => {
  let stop: (() => void) | null = null;
  afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); });

  spec('UI-26', 'a finger moves the store into touch mode as it lifts, and a mouse moves it back', () => {
    vi.useFakeTimers();
    setStoreState({ inputMode: 'pc' });
    stop = installDeviceWiring();
    pointer('pointerdown', 'touch');
    expect(useEditorStore.getState().inputMode).toBe('pc');
    pointer('pointerup', 'touch');
    click();
    expect(useEditorStore.getState().inputMode).toBe('touch');
    pointer('pointerdown', 'mouse');
    pointer('pointerup', 'mouse');
    click();
    expect(useEditorStore.getState().inputMode).toBe('pc');
  });

  it('stops writing once stopped', () => {
    setStoreState({ inputMode: 'pc' });
    installDeviceWiring()();
    pointer('pointerdown', 'touch');
    pointer('pointerup', 'touch');
    expect(useEditorStore.getState().inputMode).toBe('pc');
  });

  it('[UI-28] a resize to a taller window moves the store to portrait', () => {
    const { innerWidth, innerHeight } = window;
    Object.assign(window, { innerWidth: 1000, innerHeight: 700 });
    stop = installDeviceWiring();
    expect(useEditorStore.getState().layoutShape).toBe('landscape');
    Object.assign(window, { innerWidth: 600, innerHeight: 900 });
    window.dispatchEvent(new Event('resize'));
    expect(useEditorStore.getState().layoutShape).toBe('portrait');
    Object.assign(window, { innerWidth, innerHeight });
  });
});
