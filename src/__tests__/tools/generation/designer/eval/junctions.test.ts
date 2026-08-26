// THE SHAPE OF THE NETWORK, pinned on masks whose answer is known by construction: a crossroads is
// a four-way, a street that stops against another is a T, two T's on one street facing opposite ways
// are the staggered crossing the supplement asks for, and a 1-wide path hanging off a street is a
// garden path while a 1-wide link the plaza's only route runs through is a road.
import { describe, it, expect } from 'vitest';
import {
  networkOneWide, networkShape, LATTICE_SPAN,
} from '../../../../../tools/generation/designer/eval/junctions';

const W = 100, H = 100;

/** An all-land island, so a span is measured against the whole 100x100 board. */
function island(): Uint8Array {
  return new Uint8Array(W * H).fill(1);
}

function band(
  paved: Uint8Array, axis: 'x' | 'y', line: number, from: number, to: number, width = 2,
): void {
  for (let t = from; t <= to; t++) {
    for (let k = 0; k < width; k++) {
      const x = axis === 'y' ? line + k : t;
      const y = axis === 'y' ? t : line + k;
      if (x >= 0 && y >= 0 && x < W && y < H) paved[y * W + x] = 1;
    }
  }
}

describe('the junction grammar, read off a pavement mask', () => {
  it('reads a crossroads as one four-way and both its lines as full-span', () => {
    const paved = new Uint8Array(W * H);
    band(paved, 'y', 20, 0, H - 1);
    band(paved, 'x', 30, 0, W - 1);
    const shape = networkShape(paved, island(), W, H);
    expect(shape.fourWay).toBe(1);
    expect(shape.tee).toBe(0);
    expect(shape.junctions).toBe(1);
    expect(shape.fourWayShare).toBe(1);
    expect(shape.fullSpanShare).toBe(1);
  });

  it('reads a street stopping against another as a T, and leaves the far side unpaved', () => {
    const paved = new Uint8Array(W * H);
    band(paved, 'y', 20, 0, H - 1);
    band(paved, 'x', 30, 0, 19);
    const shape = networkShape(paved, island(), W, H);
    expect(shape.tee).toBe(1);
    expect(shape.fourWay).toBe(0);
    expect(shape.fourWayShare).toBe(0);
  });

  it('reads two T-junctions facing opposite ways on one street as a staggered crossing', () => {
    const paved = new Uint8Array(W * H);
    band(paved, 'y', 20, 0, H - 1);
    band(paved, 'x', 24, 0, 19);       // arrives from the west
    band(paved, 'x', 32, 22, W - 1);   // leaves to the east, eight cells further along
    const shape = networkShape(paved, island(), W, H);
    expect(shape.tee).toBe(2);
    expect(shape.fourWay).toBe(0);
    expect(shape.offsetPairs).toBe(1);
  });

  it('does not call two T-junctions on the same side a staggered crossing', () => {
    const paved = new Uint8Array(W * H);
    band(paved, 'y', 20, 0, H - 1);
    band(paved, 'x', 24, 0, 19);
    band(paved, 'x', 32, 0, 19);
    const shape = networkShape(paved, island(), W, H);
    expect(shape.tee).toBe(2);
    expect(shape.offsetPairs).toBe(0);
  });

  it('reads a bend as a bend and not as a junction', () => {
    const paved = new Uint8Array(W * H);
    band(paved, 'y', 20, 10, 30);
    band(paved, 'x', 30, 20, 45);
    const shape = networkShape(paved, island(), W, H);
    expect(shape.junctions).toBe(0);
    expect(shape.bends).toBe(1);
  });

  it('reads a short street as no part of the lattice, and a spanning one as all of it', () => {
    const short = new Uint8Array(W * H);
    band(short, 'x', 30, 20, 32);
    expect(networkShape(short, island(), W, H).fullSpanShare).toBe(0);
    const long = new Uint8Array(W * H);
    band(long, 'x', 30, 0, Math.ceil(LATTICE_SPAN * W));
    expect(networkShape(long, island(), W, H).fullSpanShare).toBe(1);
  });

  it('measures the span against the ISLAND, not the board', () => {
    const land = new Uint8Array(W * H);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) land[y * W + x] = 1;
    const paved = new Uint8Array(W * H);
    band(paved, 'x', 30, 20, 39);
    expect(networkShape(paved, land, W, H).fullSpanShare).toBe(1);
  });

  it('reads a large paved court as a square rather than as a junction', () => {
    const paved = new Uint8Array(W * H);
    for (let y = 20; y < 32; y++) for (let x = 20; x < 32; x++) paved[y * W + x] = 1;
    const shape = networkShape(paved, island(), W, H);
    expect(shape.squares).toBe(1);
    expect(shape.junctions).toBe(0);
  });
});

describe('the garden grade: which 1-wide pavement is a road', () => {
  /** A 2-wide street the plaza stands against, so the skeleton is reachable by construction. */
  function street(): { paved: Uint8Array; plaza: Uint8Array } {
    const paved = new Uint8Array(W * H);
    band(paved, 'x', 30, 4, 50);
    const plaza = new Uint8Array(W * H);
    for (let y = 26; y < 30; y++) for (let x = 4; x < 8; x++) plaza[y * W + x] = 1;
    return { paved, plaza };
  }

  it('exempts a 1-wide path that hangs off a street inside a region', () => {
    const { paved, plaza } = street();
    for (let y = 32; y < 40; y++) paved[y * W + 20] = 1;
    const reading = networkOneWide(paved, plaza, new Uint8Array(W * H), W, H);
    expect(reading.oneWideCells).toBe(8);
    expect(reading.gardenCells).toBe(8);
    expect(reading.networkCells).toBe(0);
    expect(reading.oneWideShare).toBe(0);
  });

  it('charges a 1-wide link the network hangs off', () => {
    const { paved, plaza } = street();
    // A second street, joined to the first ONLY by a single-cell neck: the walk between the two
    // regions runs through it, so it is a road one cell wide and not a garden path.
    band(paved, 'x', 44, 16, 40);
    for (let y = 32; y < 44; y++) paved[y * W + 20] = 1;
    const reading = networkOneWide(paved, plaza, new Uint8Array(W * H), W, H);
    expect(reading.networkCells).toBeGreaterThan(0);
    expect(reading.oneWideShare).toBeGreaterThan(0);
  });

  it('charges a 1-wide path that reaches no street at all', () => {
    const { paved, plaza } = street();
    for (let y = 40; y < 48; y++) paved[y * W + 40] = 1;
    const reading = networkOneWide(paved, plaza, new Uint8Array(W * H), W, H);
    expect(reading.gardenCells).toBe(0);
    expect(reading.networkCells).toBe(8);
  });
});
