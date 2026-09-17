// THE TOFU READING and the water's dressing, on hand-built maps where the answer is known by
// construction. Both are pure functions of a finished grid, so nothing here
// generates: a shape is drawn cell by cell and the reading is asked about it.
import { describe, it, expect } from 'vitest';
import { makeState } from '../../../../rules/_helpers';
import { CellZone, ItemCategory, TerrainType, type GridState } from '../../../../../core/model/types';
import {
  bankDressing, terraceShape, BOXY_FILL,
} from '../../../../../tools/generation/designer/eval';

const SIZE = 40;

/** A whole-grass grid with no terrain: the ground every shape below is drawn on. */
function grass(): GridState {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) state.cells[y]![x]!.zone = CellZone.Grass;
  }
  return state;
}

function paint(state: GridState, x: number, y: number, elevation: number, type = TerrainType.Mountain): void {
  state.cells[y]![x]!.terrain = { type, elevation };
}

function plant(state: GridState, id: string, x: number, y: number): void {
  state.objects.set(`${id}@${x},${y}`, {
    id: `${id}@${x},${y}`, catalogId: id, position: { x, y }, rotation: 0, elevation: 0,
  });
}

describe('the terrace shape reading', () => {
  it('reads a rectangular terrace as a box and a chamfered one as landform', () => {
    // THREE raised terraces on one map, so the median is taken over terraces rather than over one
    // terrace and the ground it stands on.
    const boxes = [{ x: 4, y: 4 }, { x: 4, y: 20 }, { x: 22, y: 12 }];
    const box = grass();
    for (const at of boxes) {
      for (let y = at.y; y < at.y + 10; y++) for (let x = at.x; x < at.x + 14; x++) paint(box, x, y, 2);
    }
    const boxRead = terraceShape(box);
    // All three terraces ARE their bounding boxes; the ground they stand on is the map minus three
    // rects out of it and is not.
    expect(boxRead.components).toBe(4);
    expect(boxRead.boxy).toBe(3);
    expect(boxRead.medianFill).toBeGreaterThanOrEqual(BOXY_FILL);

    // The same three with their corners chamfered and a bite out of one side.
    const stepped = grass();
    for (const at of boxes) {
      for (let y = at.y; y < at.y + 10; y++) {
        for (let x = at.x; x < at.x + 14; x++) {
          const dx = Math.min(x - at.x, at.x + 13 - x), dy = Math.min(y - at.y, at.y + 9 - y);
          if (dx + dy < 4) continue;
          if (dy >= 3 && dy <= 5 && x > at.x + 9) continue;
          paint(stepped, x, y, 2);
        }
      }
    }
    const steppedRead = terraceShape(stepped);
    expect(steppedRead.medianFill).toBeLessThan(boxRead.medianFill);
    expect(steppedRead.boxy).toBeLessThan(boxRead.boxy);
  });

  it('measures a seam by its longest straight run and how often it turns', () => {
    // One ruled seam across the whole grid: every cell north of it stands a tier up.
    const ruled = grass();
    for (let y = 0; y < 20; y++) for (let x = 0; x < SIZE; x++) paint(ruled, x, y, 1);
    const read = terraceShape(ruled);
    // The seam runs the full width, and a straight line turns nowhere along it.
    expect(read.longestSeam).toBe(SIZE);
    expect(read.cornersPer100).toBe(0);

    // The same seam stepped every ten cells turns twice per step.
    const stepped = grass();
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (y >= 20 - (Math.floor(x / 10) % 2 === 0 ? 0 : 3)) continue;
        paint(stepped, x, y, 1);
      }
    }
    const steppedRead = terraceShape(stepped);
    expect(steppedRead.longestSeam).toBeLessThan(SIZE);
    expect(steppedRead.cornersPer100).toBeGreaterThan(0);
  });
});

describe('the water dressing reading', () => {
  /** A pool with room for a bank row north of it. */
  function pool(): GridState {
    const state = grass();
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) paint(state, x, y, 0, TerrainType.Water);
    return state;
  }

  it('counts a body dressed only where a same-species row stands on its bank', () => {
    const bare = pool();
    expect(bankDressing(bare)).toEqual({ bodies: 1, dressed: 0, dressedShare: 0 });

    // Four plants of one species scattered around it: planting, but not a row.
    const scattered = pool();
    plant(scattered, 'flower-daisy', 10, 8);
    plant(scattered, 'flower-daisy', 13, 8);
    plant(scattered, 'flower-daisy', 8, 11);
    plant(scattered, 'flower-daisy', 8, 14);
    expect(bankDressing(scattered).dressed).toBe(0);

    // The same four in a row on the north bank: the §8.4 grammar, and the reading sees it.
    const rowed = pool();
    for (let x = 10; x < 14; x++) plant(rowed, 'flower-daisy', x, 9);
    expect(bankDressing(rowed)).toEqual({ bodies: 1, dressed: 1, dressedShare: 1 });
  });

  it('ignores a row on the bank a flat sweep reaches, and bodies too small to compose against', () => {
    // A row three rows SOUTH of the water is not on its bank: the banks a plant may stand on are the
    // ones the flat sweep leaves (north, west and the corners between), and the reading looks two
    // cells out along those and nowhere else.
    const away = pool();
    for (let x = 10; x < 14; x++) plant(away, 'flower-daisy', x, 18);
    expect(bankDressing(away).dressed).toBe(0);

    // A 9-cell pond is an accent, not a body the grammar is composed against.
    const accent = grass();
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) paint(accent, x, y, 0, TerrainType.Water);
    for (let x = 10; x < 14; x++) plant(accent, 'flower-daisy', x, 9);
    expect(bankDressing(accent).bodies).toBe(0);
  });
});

/** The catalog ids above must be real, or the reading's category test silently answers no. */
describe('the ids these readings are asked about', () => {
  it('are catalog flora', async () => {
    const { getCatalogItem, categoryOf } = await import('../../../../../state/catalog');
    const item = getCatalogItem('flower-daisy');
    expect(item, 'flower-daisy').toBeDefined();
    expect(categoryOf({ catalogId: 'flower-daisy' } as never)).toBe(ItemCategory.Flora);
  });
});
