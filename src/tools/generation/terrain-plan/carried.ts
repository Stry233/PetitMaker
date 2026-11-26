/* What carried terrain lays on another map: the mass a cell carries and the edge cuts it replays,
 * read by Change Planet's carry and by Blueprint placement alike. */
import { trimTerrainCommand } from '../../../core/model/command-build';
import { copyCorners } from '../../../core/model/corners';
import { patchSupport, structuralTop } from '../../../core/domain/terrain/terrain-surface';
import { TerrainType, type MacroCoord, type TerrainCell, type TrimCornersCommand } from '../../../core/model/types';

/** The mass a source cell carries: a real block's full height, a Γ patch's real base (the fillet is
 *  cosmetic and is replayed as a corner), nothing for a `None` islet cut. −1 = no mass. */
export function carriedMass(t: TerrainCell): number {
  if (t.type === TerrainType.None) return -1;
  const top = structuralTop(t);
  if (t.type === TerrainType.Mountain) return top >= 1 ? top : -1;
  return t.patchOnly && top < 1 ? -1 : top;   // a from-empty water fillet holds no water
}

/**
 * The command that lays carried terrain `t`'s edge cuts at `at` over `now`, the terrain standing
 * there, or null where `now` is not what the cut describes: the same block at the same tier, or the
 * empty notch a from-empty fillet or a ground-islet cut needs, where `open()` says the empty cell
 * may take terrain at all.
 */
export function carriedCut(
  t: TerrainCell, now: TerrainCell | null, open: () => boolean, at: MacroCoord,
): TrimCornersCommand | null {
  if (!t.corners) return null;
  const cut: TrimCornersCommand = trimTerrainCommand(at.x, at.y, copyCorners(t.corners));
  if (t.patchOnly) {
    const base = patchSupport(t);
    const standing = base < 1
      ? now === null && open()
      : !!now && !now.patchOnly && now.type === t.type && now.elevation === base;
    return standing ? { ...cut, patchOnly: true, terrainType: t.type, elevation: t.elevation, patchBase: base } : null;
  }
  // The islet cut carries no mass: anything standing here is not what it rounds.
  if (t.type === TerrainType.None) return now || !open() ? null : cut;
  return !now || now.patchOnly || now.type !== t.type || now.elevation !== t.elevation ? null : cut;
}
