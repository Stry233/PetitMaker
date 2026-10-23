/**
 * The store is seven slice factories composed at one `create()` call (`state/store.ts`). This
 * pins the shape of that split: the composed store carries every field the seven slices declare,
 * and — the one that matters — `shell.ts` imports nothing from `engine.ts`. A shell field reaching
 * for an engine handle (`gridState`/`commandExecutor`) is exactly the coupling this split exists to
 * prevent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from 'zustand/vanilla';
import { createEngineSlice } from '../../../state/slices/engine';
import { createEditSlice } from '../../../state/slices/edit';
import { createPrefsSlice } from '../../../state/slices/prefs';
import { createShellSlice } from '../../../state/slices/shell';
import { createAnnotationsSlice } from '../../../state/slices/annotations';
import { createPlanetSessionSlice } from '../../../state/slices/planet-session';
import { createRepairSessionSlice } from '../../../state/slices/repair-session';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { armedMacroOf } from '../../../state/editing/edit-mode';

beforeEach(resetStore);

describe('the store composes seven slices', () => {
  it('the composed store carries every field the seven slices declare', () => {
    // Each factory is called on its own bare vanilla store, so this is the slice's own field
    // list — not whatever the full EditorStore's `get()` would let it reach.
    const bare = () => createStore<any>(() => ({}));
    const engineFields = Object.keys(createEngineSlice(bare().setState, bare().getState, bare()));
    const editFields = Object.keys(createEditSlice(bare().setState, bare().getState, bare()));
    const prefsFields = Object.keys(createPrefsSlice(bare().setState, bare().getState, bare()));
    const shellFields = Object.keys(createShellSlice(bare().setState, bare().getState, bare()));
    const annotationFields = Object.keys(createAnnotationsSlice(bare().setState, bare().getState, bare()));
    const planetFields = Object.keys(createPlanetSessionSlice(bare().setState, bare().getState, bare()));
    const repairFields = Object.keys(createRepairSessionSlice(bare().setState, bare().getState, bare()));
    const declared = new Set([...engineFields, ...editFields, ...prefsFields, ...shellFields, ...annotationFields, ...planetFields, ...repairFields]);

    const composed = new Set(Object.keys(useEditorStore.getState()));
    expect(composed).toEqual(declared);
  });

  it('shell.ts imports nothing from engine.ts', () => {
    const shellSrc = readFileSync(resolve(__dirname, '../../../state/slices/shell.ts'), 'utf-8') as string;
    expect(shellSrc).not.toMatch(/from ['"][^'"]*\/engine['"]/);
    expect(shellSrc).not.toMatch(/from ['"]\.\/engine['"]/);
  });
});

describe('armingEpoch counts what an id comparison cannot', () => {
  it('a macro switched away and back leaves the id where it started and the epoch two ahead', () => {
    // What this exists for: a tool holding state across a card switch (a road-link mark waiting for
    // its second tap) is asked nothing while the two cards are clicked, so by the time it looks
    // again the id is identical and only a count can tell it the arming moved.
    const s = () => useEditorStore.getState();
    s().setEditMode({ mode: 'road', arm: { kind: 'smart', macro: 'road-link' } });
    const armed = armedMacroOf(s()), epoch = s().armingEpoch;
    expect(armed).toBe('road-link');
    s().setEditMode({ mode: 'object', arm: { kind: 'macro', macro: 'patch-tree' } });
    s().setEditMode({ mode: 'road', arm: { kind: 'smart', macro: 'road-link' } });
    expect(armedMacroOf(s())).toBe(armed);
    expect(s().armingEpoch).toBe(epoch + 2);
  });

  it('re-arming the same macro does not move it', () => {
    const s = () => useEditorStore.getState();
    s().setEditMode({ mode: 'road', arm: { kind: 'smart', macro: 'road-link' } });
    const epoch = s().armingEpoch;
    s().setEditMode({ mode: 'road', arm: { kind: 'smart', macro: 'road-link' } });
    expect(s().armingEpoch).toBe(epoch);
  });
});
