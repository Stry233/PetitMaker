import { describe, expect, it, vi } from 'vitest';
import { fitPalette } from '../../../../pipelines/planet-scan/ground/classify';
import { GRASS, localPalette, PaletteSampler, SAND, SEA } from '../../../../pipelines/planet-scan/ground/color';
import { EvidenceAccumulator, evidenceGrid } from '../../../../pipelines/planet-scan/ground/evidence';
import {
  coveragePreview, PREVIEW_GRASS, PREVIEW_MAX_UNITS, PREVIEW_MS, PREVIEW_SAND, PREVIEW_SEA, PREVIEW_UNSEEN, previewClass, PreviewClock, PreviewGrid,
  type ScanPreview,
} from '../../../../pipelines/planet-scan/ground/preview';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { islandScene, paintWorld, scanPositions, testLattice, viewTile } from './ground-synthetic';

vi.setConfig({ testTimeout: 60_000 });

const { width: W, height: H } = SCAN_PROFILE.tile;

/** A tile of one colour. */
const plain = (rgb: readonly [number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...rgb, 255], i * 4);
  return { width: W, height: H, data };
};

/** The class of the unit holding ground pixel (x, y). */
const classAt = (p: ScanPreview, x: number, y: number) => {
  const c = Math.floor((x - p.x) / p.unitW);
  const r = Math.floor((y - p.y) / p.unitH);
  return c < 0 || r < 0 || c >= p.cols || r >= p.rows ? PREVIEW_UNSEEN : previewClass(p, r * p.cols + c);
};

describe('a preview grid', () => {
  it('packs four classes to a byte and reads each back', () => {
    const grid = new PreviewGrid(5, 3);
    expect(grid.classes).toHaveLength(4);
    const values = [PREVIEW_SEA, PREVIEW_SAND, PREVIEW_GRASS, PREVIEW_UNSEEN] as const;
    for (let i = 0; i < 15; i++) grid.set(i % 5, Math.floor(i / 5), values[i % 4]!);
    for (let i = 0; i < 15; i++) expect(previewClass(grid, i)).toBe(values[i % 4]);
  });

  it('keeps each ground class one above the pixel class it shows', () => {
    expect([PREVIEW_SEA, PREVIEW_SAND, PREVIEW_GRASS]).toEqual([SEA + 1, SAND + 1, GRASS + 1]);
  });

  it('lets a preview through at most every PREVIEW_MS', () => {
    let now = 0;
    const clock = new PreviewClock(() => now);
    expect(clock.due()).toBe(true);
    now = PREVIEW_MS - 1;
    expect(clock.due()).toBe(false);
    now = PREVIEW_MS;
    expect(clock.due()).toBe(true);
  });
});

describe('pass 1 coverage', () => {
  it('is empty before any tile', () => {
    expect(coveragePreview(new PaletteSampler(W, H), { x: 0, y: 0, w: W, h: H })).toBeNull();
  });

  it('marks the ground each tile showed as seen whatever its colour, leaves the rest unseen and carries the view', () => {
    // No palette is fitted in pass 1, so a unit's class says only that it was seen.
    const sampler = new PaletteSampler(W, H);
    sampler.push(plain([70, 125, 215]), { x: 0, y: 0 });
    sampler.push(plain([165, 205, 110]), { x: 2 * W, y: 0 });
    sampler.push(plain([222, 205, 160]), { x: 0, y: 2 * H });
    const view = { x: 0, y: 2 * H, w: W, h: H };
    const p = coveragePreview(sampler, view)!;
    expect(p.kind).toBe('coverage');
    expect(p.view).toEqual(view);
    expect(classAt(p, W / 2, H / 2)).toBe(PREVIEW_SAND);
    expect(classAt(p, 2.5 * W, H / 2)).toBe(PREVIEW_SAND);
    expect(classAt(p, W / 2, 2.5 * H)).toBe(PREVIEW_SAND);
    expect(classAt(p, 2.5 * W, 2.5 * H)).toBe(PREVIEW_UNSEEN);
    expect(p.cols).toBeLessThanOrEqual(PREVIEW_MAX_UNITS);
    expect(p.classes.length).toBe(Math.ceil((p.cols * p.rows) / 4));
  });

  it('carries the colour each seen unit showed, and black where nothing was seen', () => {
    const sampler = new PaletteSampler(W, H);
    sampler.push(plain([70, 125, 215]), { x: 0, y: 0 });
    sampler.push(plain([165, 205, 110]), { x: 2 * W, y: 0 });
    const p = coveragePreview(sampler, { x: 0, y: 0, w: W, h: H })!;
    const colorAt = (x: number, y: number) => {
      const i = Math.floor((y - p.y) / p.unitH) * p.cols + Math.floor((x - p.x) / p.unitW);
      return [...p.rgb!.slice(i * 3, i * 3 + 3)];
    };
    expect(p.rgb).toHaveLength(p.cols * p.rows * 3);
    expect(colorAt(W / 2, H / 2)).toEqual([70, 125, 215]);
    expect(colorAt(2.5 * W, H / 2)).toEqual([165, 205, 110]);
    expect(colorAt(1.5 * W, H / 2)).toEqual([0, 0, 0]);
  });

  it('keeps a unit where it was as the ground seen grows', () => {
    const sampler = new PaletteSampler(W, H);
    sampler.push(plain([70, 125, 215]), { x: 0, y: 0 });
    const before = coveragePreview(sampler, { x: 0, y: 0, w: W, h: H })!;
    sampler.push(plain([165, 205, 110]), { x: -W, y: -H });
    const after = coveragePreview(sampler, { x: 0, y: 0, w: W, h: H })!;
    expect(after.unitW).toBe(before.unitW);
    expect(((before.x - after.x) / after.unitW) % 1).toBe(0);
    expect(classAt(after, W / 2, H / 2)).toBe(classAt(before, W / 2, H / 2));
  });

  it('merges units to stay within PREVIEW_MAX_UNITS a side', () => {
    const sampler = new PaletteSampler(W, H);
    for (let k = 0; k < 20; k++) sampler.push(plain([70, 125, 215]), { x: k * W, y: 0 });
    const p = coveragePreview(sampler, { x: 0, y: 0, w: W, h: H })!;
    expect(p.cols).toBeLessThanOrEqual(PREVIEW_MAX_UNITS);
    expect(p.cols * p.unitW).toBeGreaterThanOrEqual(20 * W);
  });
});

describe('pass 2 ground', () => {
  it('fills in the lattice cells as frames arrive, grass inland and sea offshore, with chunk lines on the grid', () => {
    const lattice = testLattice(37.3, 81.9);
    const scene = islandScene();
    const world = paintWorld(scene, lattice);
    const positions = scanPositions(world, W, H);
    const tiles = positions.map((p, k) => viewTile(world, p, { width: W, height: H }, k));
    const sampler = new PaletteSampler(W, H);
    tiles.forEach((t, k) => sampler.push(t, positions[k]!));
    const grid = evidenceGrid(lattice, positions, W, H);
    const palette = fitPalette(sampler);
    const acc = new EvidenceAccumulator(grid, lattice, localPalette(palette.centres, palette.classes, sampler), W, H);

    const empty = acc.preview();
    expect(empty.kind).toBe('ground');
    expect(empty.chunk).toBe(lattice.cells);
    expect(empty.cols).toBe(grid.cols);
    expect(empty.classes.every((b) => b === 0)).toBe(true);

    const half = Math.floor(tiles.length / 2);
    tiles.slice(0, half).forEach((t, k) => acc.addFrame(t, positions[k]!));
    const seen = (p: ScanPreview) => Array.from({ length: p.cols * p.rows }, (_, i) => previewClass(p, i)).filter((c) => c !== PREVIEW_UNSEEN).length;
    const part = acc.preview();
    tiles.slice(half).forEach((t, k) => acc.addFrame(t, positions[half + k]!));
    const whole = acc.preview();
    expect(seen(part)).toBeGreaterThan(0);
    expect(seen(whole)).toBeGreaterThan(seen(part));

    // The grid's corner on the ground is the lattice cell's corner at the path origin.
    const corner = lattice.cellToTile(grid.cellX0, grid.cellY0, { x: 0, y: 0 });
    expect(whole.x).toBeCloseTo(corner.x, 6);
    expect(whole.y).toBeCloseTo(corner.y, 6);
    const cellAt = (x: number, y: number) => previewClass(whole, (y - grid.cellY0) * whole.cols + x - grid.cellX0);
    const middle = { x: Math.floor(scene.cols / 2), y: Math.floor(scene.rows / 2) };
    expect(cellAt(middle.x, middle.y)).toBe(PREVIEW_GRASS);
    expect(cellAt(grid.cellX0, middle.y)).toBe(PREVIEW_SEA);
  });
});
