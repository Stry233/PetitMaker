/**
 * What a fixed (seed, config) matrix generates, reduced to one digest per entry, for comparing runs
 * of the real pipeline across processes.
 */
import { createHash } from 'node:crypto';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../_support/map-state';
import { getCell } from '../../../core/model/grid-model';
import { TerrainType, type GridState } from '../../../core/model/types';
import type { Stencil } from '../../../tools/generation/stencil/stencil';
import { defaultConfig, type GenerateConfig, type PlanetKind } from '../../../tools/generation/recipe';
import { createExecutor } from '../../../state/executor';
import { generateWith } from '../../_support/generation';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps/index';

const SIZE = 64;

/** A built-in planet a matrix entry generates on instead of the blank square: its plaza is the hub
 *  the designer's paving joins courses and set-piece bands to, which a blank map never has. */
type Planet = 'hexia' | 'tafa';

const designed = (mode: PlanetKind, seed: number, richness: number): GenerateConfig =>
  defaultConfig('designed', { mode, maxElevation: 6, seed, richness });

/** A designed run at the planet's full height range, as the shelf runs one on a built-in planet. */
const onPlanet = (mode: PlanetKind, seed: number, richness: number): GenerateConfig =>
  defaultConfig('designed', { mode, seed, richness });

/** A picture of `side` cells: diagonal bands of grey, so a colour read lands a range of tiers. */
function bandStencil(side: number): Stencil {
  const coverage = new Uint8Array(side * side).fill(255);
  const color = new Uint32Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const v = Math.floor(((x * 0.7 + y * 0.3) / 6) % 8) * 32;
      color[y * side + x] = (v << 16) | (v << 8) | v;
    }
  }
  return { width: side, height: side, coverage, color };
}

/** A covered ring of `side` cells, the shape a text stencil reads. */
function ringStencil(side: number): Stencil {
  const coverage = new Uint8Array(side * side);
  const mid = (side - 1) / 2;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.hypot(x - mid, y - mid);
      if (r >= side / 4 && r <= side / 2.5) coverage[y * side + x] = 255;
    }
  }
  return { width: side, height: side, coverage, color: new Uint32Array(side * side) };
}

/** A few seeds at the shelf's default richness, both ends of the richness axis, the maze, a
 *  picture read both ways, and designed runs on both built-in planets, where the paving runs. */
export const DIGEST_CONFIGS: readonly (readonly [string, GenerateConfig, Planet?])[] = [
  ['mixed seed 4', designed('mixed', 4, 0.7)],
  ['mixed seed 11', designed('mixed', 11, 0.7)],
  ['earth seed 42', designed('earth', 42, 0.7)],
  ['garden town (richness 0) seed 4', designed('mixed', 4, 0)],
  ['terraced planet (richness 1) seed 4', designed('mixed', 4, 1)],
  ['maze seed 7', defaultConfig('maze', { maxElevation: 6, seed: 7 })],
  ['stencil colour read', defaultConfig('stencil', { maxElevation: 8, seed: 1, stencilPlan: {
    read: 'color', origin: { x: 8, y: 8 }, stencil: bandStencil(48), water: 'none', contrast: 1.3,
  } })],
  ['stencil shape read', defaultConfig('stencil', { maxElevation: 6, seed: 2, stencilPlan: {
    read: 'shape', origin: { x: 8, y: 8 }, stencil: ringStencil(48), fill: { kind: 'terrain', terrain: TerrainType.Mountain },
  } })],
  ['hexia water seed 12', onPlanet('water', 12, 0.7), 'hexia'],
  ['tafa mixed (richness 1) seed 3', onPlanet('mixed', 3, 1), 'tafa'],
];

/** Per-cell token: the terrain fields the generator can change. Zone comes from the template, not
 *  the seed, so it is left out. `.` marks a bare cell. */
function cellToken(state: GridState, x: number, y: number): string {
  const t = getCell(state.cells, x, y)?.terrain;
  if (!t) return '.';
  const corners = t.corners ? t.corners.join(',') : '';
  return `${t.type}:${t.elevation}:${corners}:${t.patchOnly ? 1 : 0}:${t.patchBase ?? ''}`;
}

/** Cells in raster order, then every placed object by its own serialized fields. Object ids are
 *  minted from the clock and `Math.random`, so they are excluded; sorting by the whole row gives a
 *  total order even when two objects share a catalog id and position. */
export function canonicalSerialize(state: GridState): string {
  const rows: string[] = [];
  const { width, height } = state.template;
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) row.push(cellToken(state, x, y));
    rows.push(row.join('|'));
  }
  const objectRows: string[] = [];
  for (const o of state.objects.values()) {
    const corners = o.corners ? o.corners.join(',') : '';
    objectRows.push(`${o.catalogId}:${o.position.x},${o.position.y}:${o.rotation}:${o.elevation}:${corners}:${o.patchOnly ? 1 : 0}:${o.spanLength ?? ''}:${o.locked ? 1 : 0}`);
  }
  objectRows.sort();
  return `${rows.join('\n')}\n---\n${objectRows.join('\n')}`;
}

/** One run through the shelf's own entry: one stroke group, one undo. */
function run(config: GenerateConfig, planet?: Planet): GridState {
  const state = planet ? createGridState(getMapTemplate(planet)) : makeState(SIZE, SIZE);
  const exec = createExecutor(state, createDefaultRegistry());
  exec.transaction({ silent: true }, () => generateWith(state, exec, config));
  exec.beginStroke().commit();
  return state;
}

/** The sha256 of each matrix entry's canonical map, keyed by its label. */
export function generationDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [label, config, planet] of DIGEST_CONFIGS) out[label] = createHash('sha256').update(canonicalSerialize(run(config, planet))).digest('hex');
  return out;
}
