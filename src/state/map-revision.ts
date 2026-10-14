import type { GridState } from '../core/model/types';

/** The map's edit revision as `cellsVersion:objectsVersion`; `0:0` for no map. Every edit, undo and
 *  redo moves it, so a value cached against it is current while the two strings match. */
export function mapRevisionOf(grid: Pick<GridState, 'cellsVersion' | 'objectsVersion'> | null | undefined): string {
  return `${grid?.cellsVersion ?? 0}:${grid?.objectsVersion ?? 0}`;
}
