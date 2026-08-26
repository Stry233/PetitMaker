import {
  CommandType,
  type Command,
  type EraseTerrainCommand,
  type GridState,
  type MacroCell,
  type MacroCoord,
  type PaintTerrainCommand,
  type PlacedObject,
  type TerrainType,
  type ValidationResult,
} from '../core/model/types';
import { chunkKey, getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { CommandExecutor } from '../core/commands/command-executor';
import { ProvSource } from '../core/provenance/types';
import { getMapStats } from '../state/map-stats';
import { objectPlacementCommand, removeObjectCommand } from '../tools/objects';
import { generateObjectId } from '../core/model/object-id';
import { serialize, deserialize } from '../io/json-codec';

/**
 * Programmatic API for PetitMaker, the 2D map editor for Petit Planet.
 * Exposes read, execute, validation, history, and I/O methods
 * for scripting and automation.
 */
export class EditorAPI {
  constructor(
    private getState: () => GridState,
    private getExecutor: () => CommandExecutor,
  ) {}

  /* ── Read methods ────────────────────────────────────── */

  getCell(x: number, y: number): MacroCell | null {
    return getCell(this.getState().cells, x, y);
  }

  getRegion(x1: number, y1: number, x2: number, y2: number): (MacroCell | null)[][] {
    const state = this.getState();
    const result: (MacroCell | null)[][] = [];
    for (let y = y1; y <= y2; y++) {
      const row: (MacroCell | null)[] = [];
      for (let x = x1; x <= x2; x++) {
        row.push(getCell(state.cells, x, y));
      }
      result.push(row);
    }
    return result;
  }

  getObjects(): PlacedObject[] {
    return Array.from(this.getState().objects.values());
  }

  /** Total object load in chunk (cx, cy), summed from the placed objects' catalog loadValues. */
  getChunkLoad(cx: number, cy: number): number {
    return getMapStats(this.getState()).chunks.get(chunkKey(cx, cy))?.load ?? 0;
  }

  getMapDimensions(): { width: number; height: number } {
    const t = this.getState().template;
    return { width: t.width, height: t.height };
  }

  /* ── Execute methods ─────────────────────────────────── */

  /**
   * One programmatic write, as a STROKE: the command is validated and applied, then the post-stroke
   * rules run over the result and the edge-cut reconcile repairs whatever the write invalidated,
   * all folded into a single undo entry. A bare `execute` gets none of that, so a scripted write
   * could leave the map in a state the interactive editor cannot produce.
   *
   * `Procedural` is the authorship: a script is machine authorship in the same class as the
   * generator, and `clearGenerated` spares what a person made, so an unsourced write would default
   * to `Human` and be untakeable-back. The AI sources would be a false claim rather than a vaguer
   * one: they assert a model wrote the content, and the export disclosure repeats that to whoever
   * receives the map.
   */
  private write(tool: string, run: (executor: CommandExecutor) => ValidationResult): ValidationResult {
    const executor = this.getExecutor();
    const watermark = executor.getUndoStackSize();
    executor.pushSource({ source: ProvSource.Procedural, tool });
    try {
      const res = run(executor);
      if (!res.success) return res;
      const violations = executor.commitStroke(watermark);
      // A post-stroke violation reverts the write, so success here would name a change the map
      // does not hold.
      return violations.length > 0 ? { success: false, errors: violations } : res;
    } finally {
      executor.popSource();
    }
  }

  paintTerrain(cells: MacroCoord[], type: TerrainType, elevation: number): ValidationResult {
    const cmd: PaintTerrainCommand = {
      type: CommandType.PaintTerrain,
      timestamp: Date.now(),
      cells,
      terrainType: type,
      elevation,
    };
    return this.write('api.paintTerrain', (executor) => executor.execute(cmd));
  }

  eraseTerrain(cells: MacroCoord[]): ValidationResult {
    const cmd: EraseTerrainCommand = {
      type: CommandType.EraseTerrain,
      timestamp: Date.now(),
      cells,
    };
    return this.write('api.eraseTerrain', (executor) => executor.execute(cmd));
  }

  placeObject(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): ValidationResult {
    const id = generateObjectId();
    const obj: PlacedObject = {
      id,
      catalogId,
      position: { x, y },
      rotation,
      // Read the REAL standable surface (a Γ patch reads as its base block); a raw
      // terrain.elevation read sees a fillet as a full block and records a phantom
      // elevation. Mirrors the main placement path (ObjectPlacerTool).
      elevation: surfaceElevation(getCell(this.getState().cells, x, y)?.terrain),
    };
    return this.write('api.placeObject', (executor) => executor.execute(objectPlacementCommand(obj)));
  }

  removeObject(objectId: string): ValidationResult {
    const obj = this.getState().objects.get(objectId);
    if (!obj) return { success: false, errors: [] };
    return this.write('api.removeObject', (executor) => executor.execute(removeObjectCommand(obj)));
  }

  /* ── Validation ──────────────────────────────────────── */

  validate(cmd: Command): ValidationResult {
    const executor = this.getExecutor();
    const registry = executor.getRegistry();
    const errors = registry.validatePreCommand(cmd, this.getState());
    return { success: errors.length === 0, errors };
  }

  /* ── History ─────────────────────────────────────────── */

  undo(): void {
    this.getExecutor().undo();
  }

  redo(): void {
    this.getExecutor().redo();
  }

  /* ── I/O ─────────────────────────────────────────────── */

  exportJSON(): string {
    return serialize(this.getState());
  }

  /**
   * Parses JSON to a GridState; does NOT load it into the editor — callers must
   * install it (e.g. via `store.loadMap`) if they want it to become active.
   */
  importJSON(data: string): GridState {
    return deserialize(data, this.getState().template);
  }
}

/**
 * Install the EditorAPI for console scripting. Published on `window` only in DEV: in production it
 * would be a full read/execute/export surface any injected script (XSS, extension, framed parent)
 * could drive to scrape or mutate the user's map, so it's gated out of the shipped build. The API
 * object is still returned for in-app use.
 */
export function installAPI(
  getState: () => GridState,
  getExecutor: () => CommandExecutor,
): EditorAPI {
  const api = new EditorAPI(getState, getExecutor);
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__PETIT_API = api;
  return api;
}
