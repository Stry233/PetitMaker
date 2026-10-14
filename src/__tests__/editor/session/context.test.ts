/**
 * Every editor verb under `editor/operations/` takes its context explicitly, so the UI, the agent and
 * a test all drive the same code. `currentEditor` is how the UI builds one without an operation ever
 * reaching for the store itself.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { currentEditor, editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession } from '../../../editor/operations/planet-session';
import { newMap } from '../../../editor/operations';
import { useEditorStore } from '../../../state/store';

beforeEach(() => useEditorStore.setState({ gridState: null, commandExecutor: null }));

describe('editor context', () => {
  it('is null before a map is loaded', () => {
    expect(currentEditor()).toBeNull();
  });

  it('carries the live map and executor once one is', () => {
    newMap(editorPort, 'hexia');
    const kit = currentEditor();
    expect(kit).not.toBeNull();
    expect(kit!.state).toBe(useEditorStore.getState().gridState);
    expect(kit!.executor).toBe(useEditorStore.getState().commandExecutor);
  });

  it('starts a new map with an empty history', () => {
    newMap(editorPort, 'hexia');
    expect(currentEditor()!.executor.canUndo()).toBe(false);
  });

  it('opens and leaves the planet canvas in one store update each', () => {
    newMap(editorPort, 'hexia');
    const seen: { session: boolean; mode: string | null }[] = [];
    const off = useEditorStore.subscribe((s) => seen.push({ session: s.planetSession !== null, mode: s.editMode.mode }));
    try {
      enterPlanetSession(editorPort, null);
      expect(seen).toEqual([{ session: true, mode: 'mountain' }]);
      seen.length = 0;
      leavePlanetSession(editorPort);
      expect(seen).toEqual([{ session: false, mode: null }]);
    } finally {
      off();
    }
  });
});
