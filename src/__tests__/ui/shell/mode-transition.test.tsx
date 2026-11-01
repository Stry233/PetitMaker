// @vitest-environment jsdom
/**
 * The mode switch under reduced motion, and assistant region selection taking over the bottom
 * controls. How the switch looks is checked in a browser.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { useBeat } from '../../../ui/design/motion/use-motion';
import { setStoreState } from '../../_support/store';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

function mount() {
  return render(
    <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>,
    { wrapper },
  );
}


beforeEach(() => {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setSelectingRegion(false);
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
});
afterEach(cleanup);

/** Hands the motion preference to Framer as App does with `motionPref`. */
const motionAs = (reducedMotion: 'always' | 'never') => (
  ({ children }: { children: React.ReactNode }) => (
    <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
  )
);

describe('a beat under reduced motion', () => {
  /** An instant arrival that still waited its turn would leave a hole meanwhile. */
  it('drops the wait under reduced motion', () => {
    const { result } = renderHook(() => useBeat('mode.switch', 'bar.arriving'), { wrapper: motionAs('always') });
    expect(result.current.delay, 'a withheld motion must not also be a late one').toBeUndefined();
    expect(result.current.duration, 'and it arrives with no travel').toBe(0);
  });
});


describe('assistant region selection owns the bottom controls', () => {
  it.each(['mountain', 'water', 'object', 'generate', 'annotate'] as const)('covers and restores the %s panel without changing editing mode', async (mode) => {
    useEditorStore.getState().setEditMode({ mode });
    useEditorStore.getState().setAssistantOpen(true);
    mount();
    const bar = screen.getByTestId('shell-mode-bar');
    act(() => useEditorStore.getState().setSelectingRegion(true, 'agent'));
    expect(bar.hasAttribute('inert')).toBe(true);
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    await waitFor(() => expect(screen.getAllByTestId('shell-scope-screen')).toHaveLength(1));
    expect(useEditorStore.getState().editMode.mode).toBe(mode);
    act(() => useEditorStore.getState().setSelectingRegion(false));
    await waitFor(() => expect(screen.queryByTestId('shell-scope-screen')).toBeNull());
    await waitFor(() => expect(bar.hasAttribute('inert')).toBe(false));
    expect(useEditorStore.getState().regionSelectionOwner).toBeNull();
  });

  it('retains an object search query when returning from region selection', async () => {
    useEditorStore.getState().setEditMode({ mode: 'object' });
    useEditorStore.getState().setAssistantOpen(true);
    mount();
    const field = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'tree' } });
    act(() => useEditorStore.getState().setSelectingRegion(true, 'agent'));
    expect(screen.queryByRole('searchbox')).toBeNull();
    act(() => useEditorStore.getState().setSelectingRegion(false));
    await waitFor(() => expect(screen.getByRole('searchbox')).toBe(field));
    expect(field.value).toBe('tree');
  });
});
