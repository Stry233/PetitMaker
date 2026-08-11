/**
 * The store is four slice factories composed at one `create()` call (`state/store.ts`). This
 * pins the shape of that split: each file exports its factory, the composed store carries every
 * field the four slices declare, and — the one that matters — `shell.ts` imports nothing from
 * `engine.ts`. A shell field reaching for an engine handle (`gridState`/`commandExecutor`) is
 * exactly the coupling this split exists to prevent.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { resolve } from 'node:path';
import { createStore } from 'zustand/vanilla';
import { createEngineSlice } from '../../state/slices/engine';
import { createEditSlice } from '../../state/slices/edit';
import { createPrefsSlice } from '../../state/slices/prefs';
import { createShellSlice } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';

declare const __dirname: string;

// The fields the composed store is expected to expose. Checked in so that losing one fails here:
// comparing the slices against the store only proves the two agree, and they shrink together.
const EXPECTED_STORE_FIELDS: readonly string[] = [
  'activeLayer', 'activeTool', 'armedMacro', 'armingEpoch', 'assistantOpen', 'autoEdgeCut', 'brushSize', 'clearSelection',
  'commandExecutor', 'contentType', 'contextMenu', 'deletePopover', 'designMode', 'displayLayer',
  'editMode', 'eraserShape', 'eventBus', 'export3dShots', 'exportedAt', 'gridState', 'hintLevel', 'initMap',
  'layerLocked', 'layerPinned', 'layerVisibility', 'loadMap', 'locale', 'markExported', 'modals',
  'motionPref', 'placementRotation', 'portraitBlocked', 'preview3DEdit', 'region', 'regionBrushSize',
  'regionTool', 'selectedItemId', 'selectingRegion', 'selection', 'setActiveLayer', 'setAssistantOpen', 'setAutoEdgeCut',
  'setBrushSize', 'setContextMenu', 'setDeletePopover', 'setDisplayLayer',
  'setEditMode', 'setEraserShape', 'setExport3dShots', 'setHintLevel', 'setLayerLocked', 'setLayerVisibility',
  'setLocale', 'setModal', 'setMotionPref', 'setPlacementRotation',
  'setPortraitBlocked', 'setPreview3DEdit', 'setRegion', 'setRegionBrushSize', 'setRegionTool',
  'selectLayer',
  'setSelectingRegion', 'setSelection', 'setShowChunkBounds', 'setShowGrid', 'setShowLayerNumbers',
  'setSystemCursors', 'setTileMaterial', 'setTourRunning', 'setUiZoom', 'setViewMode',
  'showChunkBounds', 'showGrid', 'showLayerNumbers', 'systemCursors', 'tileMaterial', 'tileMaterialPicked',
  'toggleSelection', 'tourRunning', 'uiZoom', 'viewMode',
];

describe('the store composes four slices', () => {
  it('each slice file exports a factory function', () => {
    expect(typeof createEngineSlice).toBe('function');
    expect(typeof createEditSlice).toBe('function');
    expect(typeof createPrefsSlice).toBe('function');
    expect(typeof createShellSlice).toBe('function');
  });

  it('the composed store carries every field the four slices declare', () => {
    // Each factory is called on its own bare vanilla store, so this is the slice's OWN field
    // list — not whatever the full EditorStore's `get()` would let it reach.
    const bare = () => createStore<any>(() => ({}));
    const engineFields = Object.keys(createEngineSlice(bare().setState, bare().getState, bare()));
    const editFields = Object.keys(createEditSlice(bare().setState, bare().getState, bare()));
    const prefsFields = Object.keys(createPrefsSlice(bare().setState, bare().getState, bare()));
    const shellFields = Object.keys(createShellSlice(bare().setState, bare().getState, bare()));
    const declared = new Set([...engineFields, ...editFields, ...prefsFields, ...shellFields]);

    const composed = new Set(Object.keys(useEditorStore.getState()));
    expect(composed).toEqual(declared);
  });

  it('exposes exactly the fields the checked-in list names', () => {
    expect(Object.keys(useEditorStore.getState()).sort()).toEqual([...EXPECTED_STORE_FIELDS].sort());
  });

  it('shell.ts imports nothing from engine.ts', () => {
    const shellSrc = readFileSync(resolve(__dirname, '../../state/slices/shell.ts'), 'utf-8') as string;
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
    s().setEditMode({ mode: 'road', macro: 'road-link' });
    const armed = s().armedMacro, epoch = s().armingEpoch;
    expect(armed).toBe('road-link');
    s().setEditMode({ mode: 'object', macro: 'patch-tree' });
    s().setEditMode({ mode: 'road', macro: 'road-link' });
    expect(s().armedMacro).toBe(armed);
    expect(s().armingEpoch).toBe(epoch + 2);
  });

  it('re-arming the same macro does not move it', () => {
    const s = () => useEditorStore.getState();
    s().setEditMode({ mode: 'road', macro: 'road-link' });
    const epoch = s().armingEpoch;
    s().setEditMode({ mode: 'road', macro: 'road-link' });
    expect(s().armingEpoch).toBe(epoch);
  });
});
