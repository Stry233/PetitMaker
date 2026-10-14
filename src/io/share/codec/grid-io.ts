// canonical cell tokens as structured fields. Reuses the save's exact terrain-token functions
// (save/terrain-token.ts) and its RLE so re-emission is byte-identical to what serialize produced.
import { rleEncode, rleDecode } from '../../save/rle';
import { decodeCorners, encodeCorners, terrainToken, parseTerrain } from '../../save/terrain-token';
import type { TerrainCell } from '../../../core/model/types';

export interface CellFields {
  type: number;
  elevation: number;
  corners: string | null; // 4-char code, null = SSSS/none
  patchOnly: boolean;
  patchBase: number | null;
}

export function tokensOf(cellsRle: string): string[] {
  return rleDecode(cellsRle);
}

export function tokensToCells(tokens: string[]): string {
  return rleEncode(tokens);
}

export function parseToken(token: string): CellFields | null {
  if (token === '_') return null;
  const t = parseTerrain(token);
  if (!t) return null; // malformed token reads as an empty cell; the SHA content gate rejects the frame
  return {
    type: t.type,
    elevation: t.elevation,
    corners: (t.corners && encodeCorners(t.corners)) ?? null,
    patchOnly: !!t.patchOnly,
    patchBase: t.patchBase ?? null,
  };
}

export function tokenOf(f: CellFields | null): string {
  if (!f) return '_';
  const cell: TerrainCell = { type: f.type, elevation: f.elevation };
  if (f.corners) cell.corners = decodeCorners(f.corners);
  if (f.patchOnly) cell.patchOnly = true;
  if (f.patchBase !== null) cell.patchBase = f.patchBase;
  return terrainToken(cell);
}
