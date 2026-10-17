/**
 * Maps every rule accepts, for tests that pass a map through a load: a load holds a map to the
 * current rules, so a fixture that breaks one comes back repaired rather than as it went in.
 */
import { createGrid } from '../../core/model/grid-model';
import { createGridState } from '../../core/model/template';
import { isLaidLandmark } from '../../core/model/landmarks';
import { objectRect } from '../../state/object-geometry';
import { isBuildableZone } from '../../core/game/zones';
import { placeObjectCommand } from '../../core/model/command-build';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { TerrainType, type GridState, type MacroCoord, type MapTemplate, type PlacedObject } from '../../core/model/types';

/** Whether every cell within two of (x, y) is buildable ground: a block there bleeds onto none other. */
export function isInland(template: MapTemplate, x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const zone = template.zones[y + dy]?.[x + dx];
    if (zone === undefined || !isBuildableZone(zone)) return false;
  }
  return true;
}

/** The first inland cell of `template` in reading order. */
export function firstInland(template: MapTemplate): MacroCoord {
  for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) if (isInland(template, x, y)) return { x, y };
  throw new Error(`no inland cell on ${template.id}`);
}

/**
 * A map of `template` with no terrain of its template's: lone mountain cells of `elevation` inland on
 * a four-cell lattice, and a road on every other buildable cell whose footprint no block reaches
 * (a block stands half a cell up and left of its cell, so it reaches the cells at and before it),
 * all of it two cells clear of the landmarks and the ground they rest on.
 */
export function latticeMap(template: MapTemplate, elevation: number): GridState {
  const state = createGridState(template);
  state.cells = createGrid(template);
  const landmarks = [...state.objects.values()].filter(isLaidLandmark).map((l) => objectRect(l));
  const clear = (x: number, y: number) => landmarks.every((r) => x < r.x - 3 || x > r.x + r.w + 2 || y < r.y - 3 || y > r.y + r.h + 2);
  const block = (x: number, y: number) => x % 4 === 0 && y % 4 === 0 && isInland(template, x, y) && clear(x, y);
  for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) {
    const cell = state.cells[y]![x]!;
    if (!isBuildableZone(cell.zone) || !clear(x, y)) continue;
    if (block(x, y)) { cell.terrain = { type: TerrainType.Mountain, elevation }; continue; }
    if (block(x + 1, y) || block(x, y + 1) || block(x + 1, y + 1)) continue;
    if ((x + y) % 2) continue;
    state.objects.set(`road-${x}-${y}`, { id: `road-${x}-${y}`, catalogId: 'path-garden-stone', position: { x, y }, rotation: 0, elevation: 0 });
  }
  return state;
}

/** The top-left cell of the first `size`-cell square of `template` that is wholly buildable and two
 *  cells clear of the coast on every side, and on `state`, when given, holds no terrain and no object. */
export function inlandSquare(template: MapTemplate, size: number, state?: GridState): MacroCoord {
  const taken = state ? [...state.objects.values()].map((o) => objectRect(o)) : [];
  const open = (x: number, y: number) => isInland(template, x, y)
    && (!state || (!state.cells[y]![x]!.terrain && taken.every((r) => x < r.x - 1 || x > r.x + r.w || y < r.y - 1 || y > r.y + r.h)));
  for (let y = 0; y + size <= template.height; y++) {
    for (let x = 0; x + size <= template.width; x++) {
      let ok = true;
      for (let dy = 0; dy < size && ok; dy++) for (let dx = 0; dx < size && ok; dx++) ok = open(x + dx, y + dy);
      if (ok) return { x, y };
    }
  }
  throw new Error(`no open inland ${size}-cell square on ${template.id}`);
}

/**
 * Lays ground for `catalogId` on `state`'s first open inland square, a layer-1 plateau or a river three
 * cells wide, and returns the first such object the rules let stand at a half-cell anchor there, as
 * the placement resolves it.
 */
export function halfAnchored(state: GridState, rules: RuleDispatcher, catalogId: string, id: string, ground: 'plateau' | 'river' = 'plateau'): PlacedObject {
  const SIZE = 14;
  const o = inlandSquare(state.template, SIZE, state);
  for (let y = o.y + 2; y < o.y + SIZE - 2; y++) {
    if (ground === 'plateau') for (let x = o.x + 2; x < o.x + 7; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
    else for (let x = o.x + 5; x < o.x + 8; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Water, elevation: 0 };
  }
  state.cellsVersion++;
  for (let y2 = o.y * 2; y2 < (o.y + SIZE - 2) * 2; y2++) {
    for (let x2 = o.x * 2; x2 < (o.x + SIZE - 2) * 2; x2++) {
      for (const rotation of [0, 90, 180, 270] as const) {
        const cmd = rules.resolve(placeObjectCommand({ id, catalogId, position: { x: x2 / 2, y: y2 / 2 }, rotation, elevation: 0 }), state);
        if (cmd.object.position.x % 1 === 0 && cmd.object.position.y % 1 === 0) continue;
        if (rules.validatePreCommand(cmd, state).length === 0) return cmd.object;
      }
    }
  }
  throw new Error(`no half-anchored ${catalogId} on the ${ground}`);
}
