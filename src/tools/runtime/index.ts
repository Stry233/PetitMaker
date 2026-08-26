/**
 * THE TOOL RUNTIME: what owns the active tool, and the interface every tool implements.
 *
 * `types.ts` is the contract (`Tool`, `ToolContext`) each module under `tools/` writes against;
 * `tool-manager.ts` is the one object that holds the tools, builds their context from the live
 * editor and routes the pointer to whichever is active; `hand.ts` is the manager's own initial
 * tool, which moves the view and edits nothing.
 *
 * WHAT CROSSES IT. The canvas, which owns a `ToolManager` per view. `HandTool` does not: the manager
 * constructs it, and the modules inside `tools/` write against `types.ts` by importing that FILE (see
 * the paint door for why peers do not go through a barrel). The contract is re-exported here so a
 * caller outside `tools/` can name what a manager holds, which is the only reason it crosses.
 */
export { ToolManager } from './tool-manager';
export type { Tool, ToolContext } from './types';
