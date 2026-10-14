/**
 * Opening a map replaces the map a generation scope described, so Clear on the opened map is never
 * scoped to the previous map's region. Scopes are kept per map
 * (`editor/operations/generate.ts:forgetGenerationScope`), and `editor/operations/map.ts`'s `loadMap`
 * drops any scope the loaded map itself carried.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newMap, generateMap, clearGenerated, loadMap, transferMap } from '../../../editor/operations';
import { currentEditor, editorPort } from '../../../editor/session/context';
import { createGrid } from '../../../core/model/grid-model';
import { getMapTemplate } from '../../../config/maps';
import { getImportFileDeps } from '../../../editor/session/import-deps';
import type { GridState } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';

const config: GenerateConfig = defaultConfig('designed', { maxElevation: 4, seed: 3, richness: 1 });

const SCOPE = [{ x: 40, y: 40 }, { x: 41, y: 40 }, { x: 40, y: 41 }, { x: 41, y: 41 }];

function freshState(): GridState {
  const template = getMapTemplate(undefined);
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

beforeEach(() => newMap(editorPort, 'hexia'));

describe('editor/operations loadMap forgets the previous generation scope', () => {
  it('directly: a scoped Clear right after loading falls back to nothing, not the old region', async () => {
    await generateMap(currentEditor()!, { config, region: SCOPE });

    loadMap(editorPort, freshState());

    const outcome = clearGenerated(currentEditor()!, { region: null });
    expect(outcome.cells).not.toEqual(SCOPE);
  });
});

describe('the import-file wiring goes through editor/operations, not the store directly', () => {
  it('getImportFileDeps().loadMap forgets a prior generation scope too', async () => {
    await generateMap(currentEditor()!, { config, region: SCOPE });

    getImportFileDeps().loadMap(freshState());

    const outcome = clearGenerated(currentEditor()!, { region: null });
    expect(outcome.cells).not.toEqual(SCOPE);
  });
});

describe('opening a planet by id', () => {
  it('refuses an id no built-in holds, and leaves the map where it was', () => {
    const before = currentEditor()!.state;
    expect(() => newMap(editorPort, 'custom-unknown')).toThrow(/Unknown map template/);
    expect(() => transferMap(editorPort, currentEditor()!, { target: 'custom-unknown' })).toThrow(/Unknown map template/);
    expect(currentEditor()!.state).toBe(before);
  });
});
