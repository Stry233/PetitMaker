// The text token a terrain cell takes in a save's cell list and in share codes: `t<type>:<elevation>`,
// an optional corner suffix, `:P` for patch-only terrain and `:B<n>` for its support tier.
import type { CornerTrim, Corners, MacroCell, TerrainCell, TerrainType } from '../../core/model/types';
import type { CellZone } from '../../core/game/zones';
import { isValidElevation, isValidTerrainType } from './admission';

/** The one-character code of each corner trim in saves and share codes. The order is persisted: the
 *  share codec stores a corner as its index in this table, so a new trim goes at the end. */
export const CORNER_CODE: Readonly<Record<CornerTrim, string>> = {
  square: 'S', fan: 'F', 'tri-NW': '1', 'tri-NE': '2', 'tri-SW': '3', 'tri-SE': '4', empty: 'E',
};

const CORNER_DECODE: Record<string, CornerTrim> = {
  S: 'square', F: 'fan', T: 'tri-NW', '1': 'tri-NW', '2': 'tri-NE', '3': 'tri-SW', '4': 'tri-SE', E: 'empty',
};

/** Four known corner trims. */
export function isValidCorners(v: unknown): v is Corners {
  return Array.isArray(v) && v.length === 4 && v.every((c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CORNER_CODE, c));
}

/** Encodes corners as a four-character suffix, omitting the all-square default. */
export function encodeCorners(corners: Corners): string | undefined {
  const suffix = corners.map((c: CornerTrim) => CORNER_CODE[c] ?? 'S').join('');
  return suffix === 'SSSS' ? undefined : suffix;
}

/** Decodes a four-character corner suffix, treating unknown characters as square. */
export function decodeCorners(suffix: string): Corners {
  const at = (i: number): CornerTrim => CORNER_DECODE[suffix[i]!] ?? 'square';
  return [at(0), at(1), at(2), at(3)];
}

export function terrainToken(t: TerrainCell): string {
  let token = `t${t.type}:${t.elevation}`;
  if (t.corners) {
    const suffix = encodeCorners(t.corners);
    if (suffix) token += ':' + suffix;
    if (t.patchOnly) token += ':P';
  } else if (t.patchOnly) {
    token += '::P';
  }
  // Patch-only terrain stores its support tier in `:B{n}`; an absent tier falls back to elevation - 1.
  if (t.patchOnly && t.patchBase !== undefined) token += ':B' + t.patchBase;
  return token;
}

export function cellToToken(cell: MacroCell): string {
  if (!cell.terrain) return '_';
  return terrainToken(cell.terrain);
}

/** Parses one terrain token and rejects malformed or out-of-range values. */
export function parseTerrain(s: string): TerrainCell | null {
  const parts = s.slice(1).split(':');
  const type = Number(parts[0]) as TerrainType;
  const elevation = Number(parts[1]);
  if (!isValidTerrainType(type)) return null;
  if (!isValidElevation(elevation)) return null;
  const cell: TerrainCell = { type, elevation };
  if (parts[2] && parts[2] !== 'P') {
    cell.corners = decodeCorners(parts[2]);
  }
  if (parts.includes('P')) cell.patchOnly = true;
  const bPart = parts.find((p) => /^B\d+$/.test(p));
  if (bPart) {
    const base = Number(bPart.slice(1));
    if (!isValidElevation(base)) return null;
    cell.patchBase = base;
  }
  return cell;
}

export function tokenToCell(token: string, zone: CellZone): MacroCell {
  if (token === '_') {
    return { zone, terrain: null };
  }

  let terrain: TerrainCell | null = null;

  for (const part of token.split('+')) {
    if (part.startsWith('t')) {
      terrain = parseTerrain(part);
    }
    // Obsolete corner (`c`) and road (`r`) tokens are accepted but ignored.
  }

  return { zone, terrain };
}
