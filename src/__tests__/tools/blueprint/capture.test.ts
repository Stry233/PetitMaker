/** Capturing a framed region of a map into a blueprint body: what it keeps, what it leaves out and
 *  when it refuses. */
import { describe, expect, it } from 'vitest';
import { captureBlueprint, BLUEPRINT_MAX_SIDE, type BlueprintBody, type BlueprintCell } from '../../../tools/blueprint';
import { rect, TerrainType, world, type SpecWorld } from '../../spec/_world';
import { trimTerrainCommand } from '../../../core/model/command-build';
import { landmarkObjects } from '../../../core/model/landmarks';
import { objectRect } from '../../../state/object-geometry';
import type { Rect } from '../../../core/grid/rect';

const ROAD = 'path-blue-board';
const STALL = 'building-stall';

function captured(w: SpecWorld, frame: Rect): BlueprintBody {
  const out = captureBlueprint(w.state, frame);
  if (!('body' in out)) throw new Error(`refused: ${out.refusal}`);
  return out.body;
}

/** The body's cell at terrain-grid column `i`, row `j` of the frame. */
function cellAt(body: BlueprintBody, i: number, j: number): BlueprintCell | null {
  return body.cells[j * (body.w + 1) + i] ?? null;
}

describe('captureBlueprint', () => {
  it("captures terrain rises relative to the frame's lowest ground", () => {
    const w = world();
    const at = w.openGround(10, 10);
    expect(w.stroke(rect(at, 10, 10), TerrainType.Mountain, 1).ok).toBe(true);
    const peak = { x: at.x + 4, y: at.y + 4 };
    expect(w.stroke(rect(peak, 2, 2), TerrainType.Mountain, 2).ok).toBe(true);

    // A 9 by 9 frame on the object grid reads terrain cells at.x .. at.x + 9, all of them mountain.
    const body = captured(w, { x: at.x, y: at.y, w: 9, h: 9 });
    expect(body.cells).toHaveLength(10 * 10);
    expect(cellAt(body, 4, 4)).toEqual({ type: TerrainType.Mountain, rise: 1 });
    expect(cellAt(body, 5, 5)).toEqual({ type: TerrainType.Mountain, rise: 1 });
    expect(body.cells.filter((c) => c !== null)).toHaveLength(4);
  });

  it("stores a frame's lowest plateau as ground", () => {
    const w = world();
    const at = w.openGround(10, 10);
    expect(w.stroke(rect(at, 10, 10), TerrainType.Mountain, 1).ok).toBe(true);
    expect(w.place(ROAD, at.x + 2, at.y + 2).ok).toBe(true);
    expect(w.place(STALL, at.x + 5, at.y + 5).ok).toBe(true);

    const body = captured(w, { x: at.x, y: at.y, w: 9, h: 9 });
    expect(body.cells.every((c) => c === null), 'the plateau lands as the active layer\'s ground').toBe(true);
    expect(body.objects).toEqual([
      { catalogId: ROAD, x: 2, y: 2, rotation: 0, rise: 0 },
      { catalogId: STALL, x: 5, y: 5, rotation: 0, rise: 0 },
    ]);
  });

  it('keeps corner cuts and water', () => {
    const w = world();
    const at = w.openGround(8, 8);
    expect(w.stroke(rect(at, 3, 3), TerrainType.Mountain, 1).ok).toBe(true);
    expect(w.sandbox.execute(trimTerrainCommand(at.x, at.y, ['fan', 'square', 'square', 'square'])).success).toBe(true);
    const pond = { x: at.x + 5, y: at.y + 5 };
    expect(w.stroke([pond], TerrainType.Water, 0).ok).toBe(true);

    const body = captured(w, { x: at.x, y: at.y, w: 6, h: 6 });
    expect(cellAt(body, 0, 0)).toEqual({ type: TerrainType.Mountain, rise: 1, corners: ['fan', 'square', 'square', 'square'] });
    expect(cellAt(body, 5, 5)).toEqual({ type: TerrainType.Water, rise: 0 });
    expect(cellAt(body, 4, 4), 'bare ground is left alone').toBeNull();
  });

  it('leaves out objects straddling the frame and keeps those inside, coatings included', () => {
    const w = world();
    const at = w.openGround(10, 10);
    expect(w.place(ROAD, at.x + 1, at.y + 1).ok).toBe(true);
    expect(w.place(STALL, at.x + 3, at.y + 1, { rotation: 90 }).ok).toBe(true);
    expect(w.place('building-bamboo-cabin', at.x + 2, at.y + 3).ok).toBe(true);

    const body = captured(w, { x: at.x, y: at.y, w: 5, h: 5 });
    expect(body.objects).toEqual([
      { catalogId: ROAD, x: 1, y: 1, rotation: 0, rise: 0 },
      { catalogId: STALL, x: 3, y: 1, rotation: 90, rise: 0 },
    ]);
  });

  it('refuses a frame wider than 32 cells', () => {
    const w = world();
    const at = w.openGround(2, 2);
    expect(BLUEPRINT_MAX_SIDE).toBe(32);
    expect(captureBlueprint(w.state, { x: at.x, y: at.y, w: 33, h: 2 })).toEqual({ refusal: 'too-big' });
    expect(captureBlueprint(w.state, { x: at.x, y: at.y, w: 0, h: 2 })).toEqual({ refusal: 'too-small' });
  });

  it('refuses a frame holding a landmark', () => {
    const w = world();
    const landmark = landmarkObjects(w.state)[0]!;
    const r = objectRect(landmark);
    const frame = { x: Math.floor(r.x + r.w) - 1, y: Math.floor(r.y), w: 4, h: 4 };
    expect(captureBlueprint(w.state, frame)).toEqual({ refusal: 'landmark' });
  });

  it('refuses a frame with nothing in it', () => {
    const w = world();
    const at = w.openGround(6, 6);
    expect(captureBlueprint(w.state, { x: at.x, y: at.y, w: 4, h: 4 })).toEqual({ refusal: 'empty' });
  });
});
