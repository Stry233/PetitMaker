import type { RegionTool } from '../../../../state/editing/vocabulary';

/** Image and text fills require an interior, so their scopes offer only rectangles and circles. */
export const SCOPE_TOOLS_FOR: Readonly<Record<string, readonly RegionTool[] | undefined>> = {
  image: ['rect', 'circle'],
  text: ['rect', 'circle'],
};
