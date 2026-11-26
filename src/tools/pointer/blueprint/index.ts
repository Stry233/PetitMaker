/**
 * The pointer tool for an armed blueprint (`blueprint-tool.ts`, which `pointer/runtime` constructs)
 * and the channel through which it reports each placement to the editor and the editor offers the
 * drag of a placement it holds selected (`channel.ts`).
 */
export { BlueprintTool } from './blueprint-tool';
export type { PlacementDrag } from './channel';
