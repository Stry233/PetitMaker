/**
 * The grid's CELLS as one flat byte buffer, for crossing a worker boundary.
 *
 * `postMessage` structured-clones a cell grid as ~24k nested objects, and that clone runs on the
 * MAIN thread — tens of milliseconds per job on a real map, paid per press and per preview. Six
 * bytes per cell in one `ArrayBuffer` encodes the same facts, is written and read in a linear
 * pass, and crosses as a TRANSFERABLE (zero copy).
 *
 * The encoding is session-internal wire, not a save format: both ends are always the same build,
 * so there is no version field and no migration story — `io/save-format` owns durable encodings.
 *
 * Layout per cell: [zone | flag bits, terrain type, elevation, corners low, corners high,
 * patchBase]. Corner trims pack 3 bits each in drawing order.
 */
import {
  CellZone, TerrainType,
  type Corners, type CornerTrim, type MacroCell, type TerrainCell,
} from './types';

const STRIDE = 6;
const HAS_TERRAIN = 1 << 3;
const PATCH_ONLY = 1 << 4;
const HAS_PATCH_BASE = 1 << 5;
const HAS_CORNERS = 1 << 6;
const ZONE_MASK = 0b111;

const TRIMS: readonly CornerTrim[] = ['square', 'fan', 'tri-NW', 'tri-NE', 'tri-SW', 'tri-SE', 'empty'];
const TRIM_INDEX = new Map(TRIMS.map((t, i) => [t, i]));

export interface WireCells {
  width: number;
  height: number;
  /** Transfer this alongside the message: `postMessage(msg, [msg.cells.buffer])`. */
  buffer: ArrayBuffer;
}

export function encodeCells(cells: (MacroCell | null)[][], width: number, height: number): WireCells {
  const out = new Uint8Array(width * height * STRIDE);
  let o = 0;
  for (let y = 0; y < height; y++) {
    const row = cells[y];
    for (let x = 0; x < width; x++, o += STRIDE) {
      const cell = row?.[x];
      if (!cell) continue;   // encoded as Void with no terrain, which is what a missing cell reads as
      const t = cell.terrain;
      let flags = cell.zone & ZONE_MASK;
      if (t) {
        flags |= HAS_TERRAIN;
        if (t.patchOnly) flags |= PATCH_ONLY;
        if (t.patchBase !== undefined) flags |= HAS_PATCH_BASE;
        out[o + 1] = t.type;
        out[o + 2] = t.elevation;
        if (t.corners) {
          flags |= HAS_CORNERS;
          const packed = (TRIM_INDEX.get(t.corners[0]) ?? 0)
            | ((TRIM_INDEX.get(t.corners[1]) ?? 0) << 3)
            | ((TRIM_INDEX.get(t.corners[2]) ?? 0) << 6)
            | ((TRIM_INDEX.get(t.corners[3]) ?? 0) << 9);
          out[o + 3] = packed & 0xff;
          out[o + 4] = packed >> 8;
        }
        out[o + 5] = t.patchBase ?? 0;
      }
      out[o] = flags;
    }
  }
  return { width, height, buffer: out.buffer };
}

export function decodeCells(wire: WireCells): MacroCell[][] {
  const { width, height } = wire;
  const bytes = new Uint8Array(wire.buffer);
  const cells: MacroCell[][] = [];
  let o = 0;
  for (let y = 0; y < height; y++) {
    const row: MacroCell[] = [];
    for (let x = 0; x < width; x++, o += STRIDE) {
      const flags = bytes[o]!;
      let terrain: TerrainCell | null = null;
      if (flags & HAS_TERRAIN) {
        terrain = { type: bytes[o + 1] as TerrainType, elevation: bytes[o + 2]! };
        if (flags & PATCH_ONLY) terrain.patchOnly = true;
        if (flags & HAS_PATCH_BASE) terrain.patchBase = bytes[o + 5]!;
        if (flags & HAS_CORNERS) {
          const packed = bytes[o + 3]! | (bytes[o + 4]! << 8);
          terrain.corners = [
            TRIMS[packed & 0b111]!, TRIMS[(packed >> 3) & 0b111]!,
            TRIMS[(packed >> 6) & 0b111]!, TRIMS[(packed >> 9) & 0b111]!,
          ] as Corners;
        }
      }
      row.push({ zone: (flags & ZONE_MASK) as CellZone, terrain });
    }
    cells.push(row);
  }
  return cells;
}
