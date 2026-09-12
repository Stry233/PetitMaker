import { ELEVATION_MAX } from '../../core/model/constants';
import { isBuildableZone, NEIGHBORS4, rectsOverlap } from '../../core/model/grid-model';
import { CommandType, TerrainType, type AutoEdgeCut, type MacroCoord } from '../../core/model/types';
import { getObjectIndex } from '../../state/object-index';
import type { MacroContext } from './context';
import { isClean, isWaterAt, paint, surfaceAt } from './terrain';
import { applyAutoEdgeCut } from '../edge-cut/auto-edge-cut';

interface Surface { type: TerrainType; elevation: number }

/** A complete local terrain edit. Nothing reaches the executor until its support fits. */
export class TerrainDraft {
  readonly cells = new Map<number, Surface>();
  readonly blocked = new Map<string, MacroCoord>();
  readonly width: number;
  readonly height: number;
  private readonly protectedCells: Uint8Array;
  private readonly region: Set<number> | null;
  private readonly fallFaces = new Set<string>();

  constructor(readonly ctx: MacroContext, region?: readonly MacroCoord[]) {
    this.width = ctx.state.template.width;
    this.height = ctx.state.template.height;
    this.region = region?.length ? new Set(region.map(c => this.key(c))) : null;
    this.protectedCells = new Uint8Array(this.width * this.height);
    for (const { rect } of getObjectIndex(ctx.state).entries) {
      for (let y = Math.max(0, Math.floor(rect.y)); y <= Math.min(this.height - 1, Math.ceil(rect.y + rect.h)); y++) {
        for (let x = Math.max(0, Math.floor(rect.x)); x <= Math.min(this.width - 1, Math.ceil(rect.x + rect.w)); x++) {
          if (rectsOverlap(rect, { x: x - 0.5, y: y - 0.5, w: 1, h: 1 })) this.protectedCells[y * this.width + x] = 1;
        }
      }
    }
  }

  key(c: MacroCoord): number { return c.y * this.width + c.x; }
  coord(key: number): MacroCoord { return { x: key % this.width, y: Math.floor(key / this.width) }; }
  inside(c: MacroCoord): boolean { return c.x >= 0 && c.y >= 0 && c.x < this.width && c.y < this.height; }
  level(c: MacroCoord): number {
    return this.inside(c) ? this.cells.get(this.key(c))?.elevation ?? surfaceAt(this.ctx.state, c.x, c.y) : -1;
  }
  water(c: MacroCoord): boolean {
    const planned = this.inside(c) ? this.cells.get(this.key(c)) : undefined;
    return planned ? planned.type === TerrainType.Water : isWaterAt(this.ctx.state, c.x, c.y);
  }

  editable(c: MacroCoord, elevation = this.level(c)): boolean {
    if (!this.inside(c) || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return false;
    const key = this.key(c);
    if ((this.region && !this.region.has(key)) || this.protectedCells[key]) return false;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const cell = this.ctx.state.cells[c.y + dy]?.[c.x + dx];
      if (cell && !isBuildableZone(cell.zone)) return false;
    }
    const locks = this.ctx.state.lockedLayers;
    if (locks.has(elevation)) return false;
    const existing = this.ctx.state.cells[c.y]![c.x]!.terrain?.elevation ?? 0;
    for (let e = 1; e <= Math.max(existing, elevation); e++) if (locks.has(e)) return false;
    return true;
  }

  refuse(c: MacroCoord): false { this.blocked.set(`${c.x},${c.y}`, c); return false; }

  set(c: MacroCoord, type: TerrainType, elevation: number): boolean {
    if (!this.inside(c) || elevation < 0 || elevation > ELEVATION_MAX) return this.refuse(c);
    const terrain = this.ctx.state.cells[c.y]?.[c.x]?.terrain;
    const squareTop = type === TerrainType.Mountain && (terrain?.patchOnly || terrain?.corners?.some(corner => corner !== 'square'));
    if (this.level(c) === elevation && this.water(c) === (type === TerrainType.Water)
      && (this.cells.has(this.key(c)) || !squareTop)) return true;
    if (!this.editable(c, elevation)) return this.refuse(c);
    // An adjoining pond or river keeps its level and shape when another feature joins it.
    if (isWaterAt(this.ctx.state, c.x, c.y)
      && (type !== TerrainType.Water || surfaceAt(this.ctx.state, c.x, c.y) !== elevation)) return this.refuse(c);
    this.cells.set(this.key(c), { type, elevation });
    return true;
  }

  raise(c: MacroCoord, elevation: number): boolean {
    return this.level(c) >= elevation || this.set(c, TerrainType.Mountain, elevation);
  }

  openFall(c: MacroCoord, dx: number, dy: number): void {
    this.fallFaces.add(`${this.key(c)}:${dx},${dy}`);
  }

  /** Support is recursive: a tier-eight cap may need tier-five and tier-two skirts. */
  support(): boolean {
    const queue = [...this.cells.keys()];
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i]!;
      const t = this.cells.get(key)!;
      if (t.elevation < 4) continue;
      const c = this.coord(key), base = t.elevation - 3;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = { x: c.x + dx, y: c.y + dy };
        if (this.level(n) >= base) continue;
        if (this.water(n) || !this.raise(n, base)) return this.refuse(n);
        queue.push(this.key(n));
      }
    }
    return true;
  }

  contain(): boolean {
    for (const [key, t] of [...this.cells]) {
      if (t.type !== TerrainType.Water) continue;
      const c = this.coord(key);
      for (const [dx, dy] of NEIGHBORS4) {
        if (this.fallFaces.has(`${key}:${dx},${dy}`)) continue;
        const n = { x: c.x + dx, y: c.y + dy };
        if (this.water(n) || this.level(n) >= t.elevation) continue;
        if (!this.raise(n, t.elevation)) return false;
      }
    }
    return this.support();
  }

  commit(trim: AutoEdgeCut = 'off'): boolean {
    if (this.blocked.size > 0 || !this.support()) return false;
    const mark = this.ctx.executor.getUndoStackSize();
    const fail = (): false => { this.ctx.executor.rollbackTo(mark); return false; };
    const groups = new Map<number, MacroCoord[]>();
    for (const [key, target] of this.cells) {
      const c = this.coord(key);
      const from = surfaceAt(this.ctx.state, c.x, c.y);
      for (let e = Math.min(from + 1, target.elevation); e <= target.elevation; e++) {
        // Water is converted only after all banks and footing have been built.
        if (e === target.elevation && target.type === TerrainType.Water && from >= e - 1) continue;
        const group = groups.get(e) ?? [];
        group.push(c); groups.set(e, group);
      }
    }
    for (const [e, cells] of [...groups].sort(([a], [b]) => a - b)) {
      if (!paint(this.ctx, cells, TerrainType.Mountain, e)) { cells.forEach(c => this.refuse(c)); return fail(); }
    }
    for (let e = 0; e <= ELEVATION_MAX; e++) {
      const water = [...this.cells].filter(([, t]) => t.type === TerrainType.Water && t.elevation === e).map(([key]) => this.coord(key));
      if (!paint(this.ctx, water, TerrainType.Water, e)) { water.forEach(c => this.refuse(c)); return fail(); }
    }
    if (trim !== 'off') applyAutoEdgeCut({
      gridState: this.ctx.state,
      executeCommand: cmd => {
        const cells = cmd.type === CommandType.TrimCorners ? [{ x: cmd.x, y: cmd.y }]
          : cmd.type === CommandType.PaintTerrain ? cmd.cells : [];
        if (cells.some(c => !this.editable(c))) return { success: false, errors: [] };
        return this.ctx.executor.execute(cmd);
      },
    }, trim, [...this.cells.keys()].map(key => this.coord(key)), []);
    if (!isClean(this.ctx)) {
      for (const error of this.ctx.registry.validatePostStroke(this.ctx.state)) for (const c of error.cells ?? []) this.refuse(c);
      return fail();
    }
    return true;
  }
}
