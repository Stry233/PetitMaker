// canonical cell tokens as structured fields. Reuses json-codec's
// EXACT token/RLE functions so re-emission is byte-identical to what serialize produced.
import { rleEncode, rleDecode, terrainToken, parseTerrain } from '../../json-codec';
import type { CornerTrim, TerrainCell } from '../../../core/model/types';

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

const CORNER_CODE: Record<string, string> = {
  square: 'S',
  fan: 'F',
  'tri-NW': '1',
  'tri-NE': '2',
  'tri-SW': '3',
  'tri-SE': '4',
  empty: 'E',
};

export function parseToken(token: string): CellFields | null {
  if (token === '_') return null;
  const t = parseTerrain(token);
  if (!t) return null; // malformed token reads as an empty cell; the SHA content gate rejects the frame
  const corners = t.corners ? t.corners.map((c) => CORNER_CODE[c] ?? 'S').join('') : null;
  return {
    type: t.type,
    elevation: t.elevation,
    corners: corners === 'SSSS' ? null : corners,
    patchOnly: !!t.patchOnly,
    patchBase: t.patchBase ?? null,
  };
}

// Inverse of CORNER_CODE, derived so a new trim code can never exist in one table only.
const DEC: Record<string, CornerTrim> = Object.fromEntries(
  Object.entries(CORNER_CODE).map(([trim, code]) => [code, trim as CornerTrim]),
);

export function tokenOf(f: CellFields | null): string {
  if (!f) return '_';
  const cell: TerrainCell = { type: f.type, elevation: f.elevation };
  if (f.corners) {
    cell.corners = [
      DEC[f.corners[0]!]!,
      DEC[f.corners[1]!]!,
      DEC[f.corners[2]!]!,
      DEC[f.corners[3]!]!,
    ];
  }
  if (f.patchOnly) cell.patchOnly = true;
  if (f.patchBase !== null) cell.patchBase = f.patchBase;
  return terrainToken(cell);
}
