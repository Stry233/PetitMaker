import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../state/catalog', async (original) => {
  const catalog = await original<typeof import('../../../../state/catalog')>();
  for (const item of catalog.getAllItems()) if (item.category === 'ramp') item.height = 3;
  return catalog;
});

import { MAP_TEMPLATES } from '../../../../config/maps';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createGrid, createPlazaObject } from '../../../../core/model/grid-model';
import { ItemCategory, type GridState } from '../../../../core/model/types';
import { createDefaultRegistry } from '../../../../rules';
import { categoryOf } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { roadLookup } from '../../../../state/object-index';
import { generateDesigned } from '../../../../tools/generation/designer/pipeline';
import { MAX_RAMP_RUN } from '../../../../tools/generation/designer/ramps';

describe('generator catalog dimensions', () => {
  it('plans and places flights when the offered ramp length changes', () => {
    const template = MAP_TEMPLATES.hexia!;
    const state: GridState = { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
    const plaza = createPlazaObject(template);
    if (plaza) state.objects.set(plaza.id, plaza);
    const reg = createDefaultRegistry();
    const exec = new CommandExecutor(state, new EventBus(), reg, roadLookup(state));
    const outcome = generateDesigned({ state, execute: (cmd) => exec.execute(cmd), reg, seed: 42, richness: 1 });
    expect(MAX_RAMP_RUN).toBe(3);
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
    expect(exec.commitStroke(0)).toEqual([]);
  });
});
