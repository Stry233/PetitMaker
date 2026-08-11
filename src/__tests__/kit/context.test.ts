/**
 * Every editor verb under `kit/operations/` takes its context explicitly, so the UI, the agent and
 * a test all drive the same code. `currentKit` is how the UI builds one without an operation ever
 * reaching for the store itself.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { currentKit } from '../../kit/context';
import { newMap } from '../../kit/operations';
import { useEditorStore } from '../../state/store';

beforeEach(() => useEditorStore.setState({ gridState: null, commandExecutor: null }));

describe('kit context', () => {
  it('is null before a map is loaded', () => {
    expect(currentKit()).toBeNull();
  });

  it('carries the live map and executor once one is', () => {
    newMap('hexia');
    const kit = currentKit();
    expect(kit).not.toBeNull();
    expect(kit!.state).toBe(useEditorStore.getState().gridState);
    expect(kit!.executor).toBe(useEditorStore.getState().commandExecutor);
  });

  it('starts a new map with an empty history', () => {
    newMap('hexia');
    expect(currentKit()!.executor.canUndo()).toBe(false);
  });
});
