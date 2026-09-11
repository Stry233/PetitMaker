import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { CommandType, TerrainType, type Command, type GridState, type MacroCoord } from '../../core/model/types';
import { objectPlacementCommand, removeObjectCommand } from '../objects/object-placer';

/** Restore the pre-gesture map through commands, inside the adjustment's own undo entry. */
export function restoreMacroCommands(current: GridState, baseline: GridState): Command[] {
  const commands: Command[] = [], replacements: Command[] = [];
  for (const [id, obj] of current.objects) {
    if (JSON.stringify(obj) !== JSON.stringify(baseline.objects.get(id))) commands.push(removeObjectCommand(obj));
  }
  for (const [id, obj] of baseline.objects) {
    if (JSON.stringify(obj) !== JSON.stringify(current.objects.get(id))) replacements.push(objectPlacementCommand(obj));
  }
  const erase: MacroCoord[] = [];
  const mountains = new Map<number, MacroCoord[]>(), water = new Map<number, MacroCoord[]>();
  const corners: Command[] = [];
  const group = (groups: Map<number, MacroCoord[]>, e: number, c: MacroCoord): void => {
    const cells = groups.get(e) ?? []; cells.push(c); groups.set(e, cells);
  };
  for (let y = 0; y < baseline.template.height; y++) for (let x = 0; x < baseline.template.width; x++) {
    const target = baseline.cells[y]![x]!.terrain, standing = current.cells[y]![x]!.terrain;
    if (JSON.stringify(target) === JSON.stringify(standing)) continue;
    const c = { x, y };
    if (!target || target.patchOnly) erase.push(c);
    else {
      const from = surfaceElevation(standing);
      for (let e = Math.min(from + 1, target.elevation); e <= target.elevation; e++) {
        if (e === target.elevation && target.type === TerrainType.Water) group(water, e, c);
        else group(mountains, e, c);
      }
    }
    if (target?.corners || target?.patchOnly) corners.push({
      type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'terrain',
      beforeCorners: standing?.corners, afterCorners: target.corners ?? ['square', 'square', 'square', 'square'],
      patchOnly: target.patchOnly, terrainType: target.type, elevation: target.elevation, patchBase: target.patchBase,
    });
  }
  if (erase.length > 0) commands.push({ type: CommandType.EraseTerrain, timestamp: Date.now(), cells: erase });
  for (const [type, groups] of [[TerrainType.Mountain, mountains], [TerrainType.Water, water]] as const) {
    for (const [e, cells] of [...groups].sort(([a], [b]) => a - b)) {
      commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: type, elevation: e });
    }
  }
  return [...commands, ...corners, ...replacements];
}
