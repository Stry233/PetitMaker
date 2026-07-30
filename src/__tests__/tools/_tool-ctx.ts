import type { CommandExecutor } from '../../core/commands/command-executor';
import { TerrainType, type Command } from '../../core/model/types';
import type { ToolContext } from '../../tools/types';

/** ToolContext over a test gridState + executor; overlay is a no-op stub so
 *  ghost-drawing tools run headless. */
export function makeToolCtx(state: any, executor: CommandExecutor, brushSize = 1, elevation = 1): ToolContext {
  return {
    gridState: state,
    viewport: null as any,
    overlay: { showGhost() {}, clearGhost() {}, flashCommit() {} } as any,
    executeCommand: (cmd: Command) => executor.execute(cmd),
    commitStroke: (s: number) => executor.commitStroke(s),
    validateCommand: (cmd: Command) => executor.getRegistry().validatePreCommand(cmd, state),
    undo: () => executor.undo(),
    getUndoStackSize: () => executor.getUndoStackSize(),
    collapseHistory: (s: number) => executor.collapseHistory(s),
    t: (k: string) => k,
    setDisplayLayer: () => {},
    terrainType: TerrainType.Mountain,
    elevation,
    brushSize,
  };
}

/** Grid objects with a given catalogId. */
export function objectsByCatalog(state: any, catalogId: string): any[] {
  return [...state.objects.values()].filter((o: any) => o.catalogId === catalogId);
}
