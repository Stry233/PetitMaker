/**
 * The tool runtime: what owns the active tool, and the interface every tool implements.
 *
 * `types.ts` is the contract (`Tool`, `ToolHost`, `ToolContext`) each module under `tools/` writes
 * against, naming no feature; `host.ts:createToolHost` builds the host, with the feature channels, the app, the Help figures and the tests run
 * tools on; `tool-manager.ts` holds the tools, builds their context from the arming source and host
 * channels its caller supplies, and routes the pointer to the active one; `hand.ts` is the manager's
 * initial tool, which edits nothing; `tool-set.ts` is the editor's tool set and what each tool
 * declares about itself; `view-seam.ts` declares what a map view implements for them. Modules inside `tools/` import these files directly.
 */
export { ToolManager, type ToolManagerDeps } from './tool-manager';
export { createToolHost } from './host';
export { resolvePointer } from './pointer';
export { toolDeclares } from './tool-set';
export type { Tool, ToolContext, ToolHost } from './types';
export type {
  ActiveView, EditorView, GhostCell, GhostPaint, GhostRequest, PlacementGhost, PlacementWash, PreviewCell, PreviewIcon,
  SelectionOpts, ToolOverlay, ViewCamera, ViewProjection,
} from './view-seam';
