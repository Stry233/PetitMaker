/** Values a tool uses for an omitted argument. Handlers, schema text and approval descriptions read them here. */
import { getRoadMaterials } from '../../state/catalog';

export const TOOL_DEFAULTS = {
  terraceBaseRadius: 5,
  terraceTiers: 2,
  wallCrest: 6,
  wallDepth: 14,
  poolElevation: 1,
  riverWidth: 4,
  historySteps: 1,
} as const;

/** The catalog's first road, the surface the tile brush arms by default. */
export const defaultRoadId = (): string => getRoadMaterials()[0]!.id;
