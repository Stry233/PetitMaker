/**
 * The editor a spec test drives: a built-in planet under the full rules, changed only through what a
 * person does (a brush stroke, a placement, an undo), answering in rule ids and map fingerprints so a
 * test reads as the requirement it proves. Every verb goes through `SandboxWorld`, the headless editor
 * Help's figures run.
 */
import { SandboxWorld } from '../../editor/sandbox/demo-world';
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import { mapFingerprint } from '../../core/model/fingerprint';
import { isBuildableZone } from '../../core/game/zones';
import { cellKey } from '../../core/grid/rect';
import { TerrainType, type MacroCoord, type PlacedObject, type Rotation, type ValidationError } from '../../core/model/types';
import { candidateObject } from '../../tools/objects';
import { getCatalogItem } from '../../state/catalog';
import { buildObjectOccupancy } from '../../state/object-geometry';

export { TerrainType };

/** What an action came to: whether the map took it, and the rules that refused it if not. */
export interface Outcome {
  readonly ok: boolean;
  readonly refusedBy: readonly string[];
  /** The placed object's id, when a placement was taken. */
  readonly id?: string;
}

const ruleIds = (errors: readonly ValidationError[]): string[] => [...new Set(errors.map((e) => e.ruleId))];

/** The cells of a w-by-h rectangle whose top-left cell is `at`. */
export function rect(at: MacroCoord, w: number, h: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = at.y; y < at.y + h; y++) for (let x = at.x; x < at.x + w; x++) out.push({ x, y });
  return out;
}

export class SpecWorld {
  readonly sandbox: SandboxWorld;
  private seq = 0;
  private refused: ValidationError[] = [];

  constructor(templateId?: string) {
    this.sandbox = new SandboxWorld(templateId);
    this.sandbox.bus.on('validation-failed', ({ errors }) => { this.refused.push(...errors); });
  }

  get state() { return this.sandbox.state; }

  /** Place `item` with its anchor cell at (x, y), as a click with the item armed does: on the surface
   *  under the anchor unless `elevation` names another. */
  place(item: string, x: number, y: number, opts: { rotation?: Rotation; elevation?: number } = {}): Outcome {
    const entry = getCatalogItem(item);
    if (!entry) throw new Error(`no catalog item ${item}`);
    const id = `spec-${item}-${this.seq++}`;
    const candidate = candidateObject(entry, { x, y }, opts.rotation ?? 0, this.state, { id, elevation: opts.elevation });
    const result = this.sandbox.execute(placeObjectCommand(candidate));
    return result.success ? { ok: true, refusedBy: [], id } : { ok: false, refusedBy: ruleIds(result.errors) };
  }

  /** Remove a placed object, as Delete does on a selection of one. */
  remove(id: string): Outcome {
    const result = this.sandbox.execute(removeObjectCommand({ id }));
    return { ok: result.success, refusedBy: ruleIds(result.errors) };
  }

  /** One brush stroke: lay `type` at `elevation` over `cells`, then release, which runs the end-of-stroke
   *  rules. Refused when any rule refused any part, during the stroke or at its end. */
  stroke(cells: readonly MacroCoord[], type: TerrainType, elevation: number): Outcome {
    this.refused = [];
    this.sandbox.beginStroke();
    this.sandbox.paint([...cells], type, elevation);
    const violations = this.sandbox.commit();
    const errors = [...this.refused, ...violations];
    return { ok: errors.length === 0, refusedBy: ruleIds(errors) };
  }

  undo(): boolean { return this.sandbox.undo(); }
  redo(): void { this.sandbox.redo(); }

  /** The map as a person sees it, as one comparable string: the map's own fingerprint over its objects
   *  in id order, since an undo that puts a removed object back re-inserts it last, an order no one sees. */
  fingerprint(): string {
    const objects = new Map([...this.state.objects].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return mapFingerprint({ ...this.state, objects });
  }

  /** Lock or unlock a layer, as the layer panel does: the map holds its locks as a fresh set. */
  lockLayer(elevation: number, locked: boolean): void {
    const next = new Set(this.state.lockedLayers);
    if (locked) next.add(elevation); else next.delete(elevation);
    this.state.lockedLayers = next;
  }

  object(id: string): PlacedObject | undefined { return this.state.objects.get(id); }

  /** The terrain standing at a cell, or null for bare ground. */
  terrainAt(c: MacroCoord): { type: TerrainType; elevation: number } | null {
    const t = this.state.cells[c.y]?.[c.x]?.terrain;
    return t ? { type: t.type, elevation: t.elevation } : null;
  }

  /** The top-left cell of a w-by-h patch of open buildable ground (no terrain, no object, a margin of
   *  `margin` such cells around it), the one nearest the planet's centre. */
  openGround(w: number, h: number, margin = 2): MacroCoord {
    const { cells } = this.state;
    const occupied = buildObjectOccupancy(this.state);
    const open = (x: number, y: number): boolean => {
      const cell = cells[y]?.[x];
      return !!cell && isBuildableZone(cell.zone) && !cell.terrain && !occupied.has(cellKey(x, y));
    };
    const cy = Math.floor(cells.length / 2);
    const cx = Math.floor((cells[0]?.length ?? 0) / 2);
    let best: MacroCoord | null = null;
    let bestDistance = Infinity;
    for (let y = margin; y + h + margin <= cells.length; y++) {
      for (let x = margin; x + w + margin <= (cells[y]?.length ?? 0); x++) {
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d >= bestDistance) continue;
        if (rect({ x: x - margin, y: y - margin }, w + 2 * margin, h + 2 * margin).every((c) => open(c.x, c.y))) {
          best = { x, y };
          bestDistance = d;
        }
      }
    }
    if (!best) throw new Error(`no open ${w}x${h} ground on this planet`);
    return best;
  }
}

export const world = (templateId?: string): SpecWorld => new SpecWorld(templateId);
