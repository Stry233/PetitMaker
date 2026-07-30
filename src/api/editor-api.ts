import {
  CommandType,
  type Command,
  type GridState,
  type MacroCell,
  type MacroCoord,
  type PlacedObject,
  type TerrainType,
  type ValidationResult,
  ObjectCategory,
  objectCategory,
} from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { ChunkTracker } from '../core/model/chunk-tracker';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { CommandExecutor } from '../core/commands/command-executor';
import { getCatalogItem } from '../state/catalog';
import { getPlacedObjectSize } from '../state/object-geometry';
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
    const tracker = new ChunkTracker();
    for (const obj of this.getState().objects.values()) {
      if (obj.patchOnly) continue;
      const { w, h } = getPlacedObjectSize(obj);
      tracker.addObject(obj.position, w, h, getCatalogItem(obj.catalogId)?.loadValue ?? 0);
    }
    return tracker.getLoad(cx, cy);
  }

  getMapDimensions(): { width: number; height: number } {
    const t = this.getState().template;
    return { width: t.width, height: t.height };
  }

  /* ── Execute methods ─────────────────────────────────── */

  paintTerrain(cells: MacroCoord[], type: TerrainType, elevation: number): ValidationResult {
    const cmd = {
      type: CommandType.PaintTerrain,
      timestamp: Date.now(),
      cells,
      terrainType: type,
      elevation,
    } as unknown as Command;
    return this.getExecutor().execute(cmd);
  }

  eraseTerrain(cells: MacroCoord[]): ValidationResult {
    const cmd = {
      type: CommandType.EraseTerrain,
      timestamp: Date.now(),
      cells,
    } as unknown as Command;
    return this.getExecutor().execute(cmd);
  }

  placeObject(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): ValidationResult {
    const id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item = getCatalogItem(catalogId);
    const obj: PlacedObject = {
      id,
      catalogId,
      position: { x, y },
      rotation,
      // Every placement path must derive the persisted category from the catalog
      // (types.ts objectCategory contract) — a hardcoded value miscounts trees and
      // flora as buildings in layer stats, saves, and the agent scorecard.
      category: item ? objectCategory(item.category) : ObjectCategory.House,
      // Read the REAL standable surface (a Γ patch reads as its base block); a raw
      // terrain.elevation read sees a fillet as a full block and records a phantom
      // elevation. Mirrors the main placement path (ObjectPlacerTool).
      elevation: surfaceElevation(getCell(this.getState().cells, x, y)?.terrain),
    };
    const cmd = {
      type: CommandType.PlaceObject,
      timestamp: Date.now(),
      object: obj,
      cells: [{ x, y }],
    } as unknown as Command;
    return this.getExecutor().execute(cmd);
  }

  removeObject(objectId: string): ValidationResult {
    const obj = this.getState().objects.get(objectId);
    const cmd = {
      type: CommandType.RemoveObject,
      timestamp: Date.now(),
      objectId,
      removedObject: obj ?? null,
      cells: obj ? [obj.position] : [],
    } as unknown as Command;
    return this.getExecutor().execute(cmd);
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
