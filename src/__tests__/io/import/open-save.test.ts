import { describe, expect, it } from 'vitest';
import { loadParsedSave, openSave } from '../../../io/import/open-save';
import { parseSave } from '../../../io/save/parse';
import { serialize } from '../../../io/save/json-codec';
import { createGridState, templateTerrainAt } from '../../../core/model/template';
import { templateAnchor } from '../../../core/model/landmarks';
import { footprintTerrain } from '../../../core/grid/footprint';
import { getMapTemplate } from '../../../config/maps';

/** A Hexia save written without the ground its plaza stands on, and the cell it left bare. */
function saveWithoutAnchorGround(): { json: string; x: number; y: number } {
  const state = createGridState(getMapTemplate('hexia'));
  const a = templateAnchor(state.template)!;
  const r = footprintTerrain({ x: a.x, y: a.y, w: a.width, h: a.height });
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (!templateTerrainAt(state.template, x, y, state.cells[y]![x]!.zone)) continue;
    state.cells[y]![x]!.terrain = null;
    return { json: serialize(state), x, y };
  }
  throw new Error('no template ground under the plaza');
}

describe('loadParsedSave', () => {
  it('decodes a save and clears under its landmarks, reporting what it changed', () => {
    const { json, x, y } = saveWithoutAnchorGround();
    const { state, cleared } = loadParsedSave(parseSave(JSON.parse(json)));
    expect(cleared.restored).toBe(1);
    expect(state.cells[y]![x]!.terrain).not.toBeNull();
  });

  it('is the path openSave takes', () => {
    const { json, x, y } = saveWithoutAnchorGround();
    const state = openSave(json, getMapTemplate('hexia'));
    expect(state.cells[y]![x]!.terrain).not.toBeNull();
  });
});
