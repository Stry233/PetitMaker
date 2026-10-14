/* The editor's tool vocabulary: the tools, drawing modes and brush options the store and the tools share. */

/**
 * Auto edge-cutting mode for the terrain/tile build brushes. When not 'off', a
 * finished stroke auto-trims its freshly-exposed convex corners: 'rect' uses a
 * straight 45° bevel (triangle cut), 'round' uses a curved chamfer (fan cut).
 */
export type AutoEdgeCut = 'off' | 'rect' | 'round';

export const NEXT_AUTO_EDGE_CUT: Record<AutoEdgeCut, AutoEdgeCut> = { off: 'rect', rect: 'round', round: 'off' };

/** A figure the terrain brush, the eraser and the note brushes draw. */
export type BuildShape = 'free' | 'line' | 'curve' | 'rect' | 'circle';
/** Eraser footprints share the drawing tools' geometry. */
export type EraserShape = BuildShape;

export enum ToolType {
  TerrainBrush = 'TerrainBrush',
  ObjectPlacer = 'ObjectPlacer',
  Eraser = 'Eraser',
  Hand = 'Hand',
  EdgeCut = 'EdgeCut',
  Macro = 'Macro',
  Annotate = 'Annotate',
}

/**
 * The drawing mode a user picks, spelled as the build tools spell it: a figure the brush draws, or
 * the eraser, the edge-cut trim, or none (a surface chosen with no tool armed). Each maps to the
 * tool that implements it (`edit-mode.ts:designModeArming` arms it); it lives in state so the store can
 * name it without depending on ui.
 */
export type DesignMode = BuildShape | 'erase' | 'trim' | 'none';

/** Region-select brush vocabulary: a figure, or the eraser. The scope screen's row, and `store.regionTool`. */
export type RegionTool = BuildShape | 'erase';

export const REGION_TOOLS: readonly RegionTool[] = ['free', 'erase', 'line', 'curve', 'rect', 'circle'];

/** What the screen arming region selection asks of the brush: the store's `regionRequest`, set by
 *  that screen and read by the shortcuts and the brush, which never meet it. */
export interface RegionRequest {
  /** The region tools offered, in row order. */
  tools: readonly RegionTool[];
  /**
   * Whether a region is one figure rather than a collection of them. The generators that read a
   * region as an area are happy with any number of patches; the ones that fill it are not. A
   * picture is fitted to the region's bounding box, so two patches far apart give a box spanning
   * both with the picture drawn across the gap. In single mode a stroke replaces what was there.
   */
  single: boolean;
  /**
   * The shortest side a drawn figure may come out at, or null for no floor. A hard limit at
   * creation: the rect and circle drags clamp their extent to it, so a figure below the floor cannot
   * be drawn at all. The consumers that set it are the ones whose output degrades below some size
   * (the picture generators, whose stencil is exactly as many cells as the region).
   */
  minSide: number | null;
}

export const DEFAULT_REGION_REQUEST: RegionRequest = { tools: REGION_TOOLS, single: false, minSide: null };

/** Annotation tools; `none` enables selection and movement. */
export type AnnotationTool = 'zone' | 'chip' | 'route' | 'measure' | 'erase' | 'none';
