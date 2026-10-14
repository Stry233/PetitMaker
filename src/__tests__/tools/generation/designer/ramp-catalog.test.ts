import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../state/catalog', async (original) => {
  const catalog = await original<typeof import('../../../../state/catalog')>();
  for (const item of catalog.getAllItems()) if (item.category === 'ramp') item.height = 3;
  return catalog;
});

import { MAP_TEMPLATES } from '../../../../config/maps';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { createGridState } from '../../../../core/model/template';
import type { GridState } from '../../../../core/model/types';
import { createDefaultRegistry } from '../../../../rules';
import { categoryOf } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { generateDesigned } from '../../../../tools/generation/designer/pipeline';
import { maxRampRun } from '../../../../tools/generation/designer/ramps';
import { makeExecutor } from '../../../_support/map-state';
import { ItemCategory } from '../../../../config/catalog/categories';

describe('generator catalog dimensions', () => {
  it('plans and places flights when the offered ramp length changes', () => {
    const template = MAP_TEMPLATES.hexia!;
    const state: GridState = {
      template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
    };
    const plaza = (templateLandmarkObjects(template)[0] ?? null);
    if (plaza) state.objects.set(plaza.id, plaza);
    const reg = createDefaultRegistry();
    const exec = makeExecutor(state, reg);
    const whole = exec.beginStroke();
    const outcome = generateDesigned({ state, execute: (cmd) => exec.execute(cmd), reg, seed: 42, richness: 1 });
    expect(maxRampRun()).toBe(3);
    expect(outcome.crossings.ramps).toBeGreaterThan(0);
    expect(outcome.rampsMisplaced).toBe(0);
    for (const ramp of outcome.streets.ramps) {
      const r = ramp.footprint;
      expect(ramp.rotation === 0 || ramp.rotation === 180 ? r.h : r.w).toBe(3);
    }
    for (const obj of state.objects.values()) {
      if (categoryOf(obj) !== ItemCategory.Ramp) continue;
      const r = objectRect(obj);
      expect(obj.rotation === 0 || obj.rotation === 180 ? r.h : r.w).toBe(3);
    }
    expect(whole.commit()).toEqual([]);
  });
});
