/** Whether the map holds edits made since its last export: the undo depth moved past the mark
 *  `markExported` set (`exportedAt`), or there are edits and no export yet. */
export function hasUnsavedEdits(undoDepth: number | undefined, exportedAt: number | null): boolean {
  const depth = undoDepth ?? 0;
  return depth > 0 && depth !== exportedAt;
}
