/**
 * Opening a map replaces the map that a generation scope described, so it must forget that scope
 * (see `kit/operations/generate.ts:forgetGenerationScope`) — every caller that installs a map has
 * to go through `kit/operations/map.ts`'s `loadMap`, not the store's `loadMap` directly, or Clear
 * on the freshly loaded map stays scoped to the PREVIOUS map's region.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newMap, generateMap, clearGenerated, loadMap } from '../../kit/operations';
import { currentKit } from '../../kit/context';
import { createGrid } from '../../core/model/grid-model';
import { getMapTemplate } from '../../config/maps';
import { getImportFileDeps } from '../../ui/chrome/modals/import/import-deps';
import type { GenerateConfig, GridState } from '../../core/model/types';

const config: GenerateConfig = {
  algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed: 3, region: null,
  relief: 0.8, naturalness: 1, settlement: 0.5, nature: 0.5,
};

const SCOPE = [{ x: 40, y: 40 }, { x: 41, y: 40 }, { x: 40, y: 41 }, { x: 41, y: 41 }];

function freshState(): GridState {
  const template = getMapTemplate(undefined);
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
}

beforeEach(() => newMap('hexia'));

describe('kit/operations loadMap forgets the previous generation scope', () => {
  it('directly: a scoped Clear right after loading falls back to nothing, not the old region', async () => {
    await generateMap(currentKit()!, { config, region: SCOPE });

    loadMap(freshState());

    const outcome = clearGenerated(currentKit()!, { region: null });
    expect(outcome.cells).not.toEqual(SCOPE);
  });
});

describe('the import-file wiring goes through kit/operations, not the store directly', () => {
  it('getImportFileDeps().loadMap forgets a prior generation scope too', async () => {
    await generateMap(currentKit()!, { config, region: SCOPE });

    getImportFileDeps().loadMap(freshState());

    const outcome = clearGenerated(currentKit()!, { region: null });
    expect(outcome.cells).not.toEqual(SCOPE);
  });
});
