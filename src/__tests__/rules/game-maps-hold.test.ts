/**
 * The game's own maps break no rule: every rule is read off the game, so a rule that flags one of
 * these has the game wrong. `hexia-original.json` is Hexia as the game holds it, exported from the
 * game by the owner on 2026-10-12 (terrain only; its provenance and image attribution are left out);
 * the built-in templates are each planet as it opens, landmarks included.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GridState, ValidationError } from '../../core/model/types';
import { placeObjectCommand } from '../../core/model/command-build';
import { createGridState } from '../../core/model/template';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { getMapTemplate } from '../../config/maps/index';
import { createDefaultRegistry } from '../../rules/index';
import { deserialize } from '../_support/save-file';

/** What the registry says about `state` as it stands: every post-stroke rule over the whole map,
 *  and every pre-command rule over each object placed again on the map without it. A landmark is
 *  locked, so laying it again is judged without its lock. */
function violations(state: GridState): ValidationError[] {
  const registry = createDefaultRegistry();
  const out = [...registry.validatePostStroke(state)];
  for (const obj of [...state.objects.values()]) {
    state.objects.delete(obj.id);
    bumpObjectsVersion(state, { removed: [obj] });
    const { locked: _, ...free } = obj;
    out.push(...registry.validatePreCommand(placeObjectCommand(free), state));
    state.objects.set(obj.id, obj);
    bumpObjectsVersion(state, { added: [obj] });
  }
  return out;
}

const describeAll = (errors: ValidationError[]) => errors.map((e) => `${e.ruleId} ${e.message}`);

describe('the game\'s own maps hold under every rule', () => {
  it('Hexia as the game holds it', () => {
    const json = readFileSync(resolve(import.meta.dirname, '../fixtures/saves/hexia-original.json'), 'utf8');
    const state = deserialize(json, getMapTemplate('hexia'));
    expect(describeAll(violations(state))).toEqual([]);
  });

  it.each(['hexia', 'tafa'])('the built-in %s template with its landmarks', (id) => {
    const state = createGridState(getMapTemplate(id));
    expect(state.objects.size).toBeGreaterThan(0);
    expect(describeAll(violations(state))).toEqual([]);
  });
});
