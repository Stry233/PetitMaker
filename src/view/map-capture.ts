/**
 * What a 2D capture of the live map shows, one options object for every caller: the export, the share preview,
 * the stylize steps, the map review, the assistant's snapshot and scripts. The 2D renderer answers
 * it (`MapRenderer.capture`) and `editor/host/host.ts` offers it to callers outside the view.
 *
 * Every capture bakes the map in its capture frame with the editor's camera, selection marks, tool
 * feedback and chunk labels left out, so the picture depends on the map alone.
 */

/** `map` is the map as the editor shows its layers; `complete` the map with every layer shown;
 *  `notes` the plan-notes ink alone and `grid` the grid lines alone, both on transparency. */
import type { GridState } from '../core/model/types';
import type { CameraAngle } from '../state/view-camera';

export type MapCaptureContent = 'map' | 'complete' | 'notes' | 'grid';

/** An inclusive rect of saved cells; the capture clamps it to the map. */
export interface CaptureCellRect { x1: number; y1: number; x2: number; y2: number }

/** One export tile in px relative to the whole map's capture frame (its sea margin or terrain bleed
 *  included), rendered at `resolution`. */
export interface CaptureTile { region: { x: number; y: number; w: number; h: number }; resolution: number }

export interface MapCaptureOptions {
  /** Longest side of the picture in px, clamped to the GPU's texture limit; 1024 when omitted. A
   *  `tile` capture takes its own resolution instead. */
  maxPx?: number;
  /** `map` when omitted. */
  content?: MapCaptureContent;
  /** Bakes the reference grid into a `map` or `complete` capture. */
  grid?: boolean;
  /** Whether a `map` or `complete` capture draws the plan notes: omitted follows the notes layer's
   *  live visibility for `map` and draws them for `complete`. */
  annotations?: boolean;
  /** Frames a `map` capture to these cells, terrain's half-cell bleed included; the whole map when omitted. */
  rect?: CaptureCellRect;
  /** One tile of a `map` capture painted in parts. */
  tile?: CaptureTile;
}

/** The longest side a capture takes when the options name none. */
export const DEFAULT_CAPTURE_PX = 1024;

/** The captures a caller outside the view reads, as `editor/host/host.ts` offers them. */
export interface MapCapturer {
  /** The capture as a canvas, or null with no 2D view or a failed bake. */
  capture2d(options?: MapCaptureOptions): HTMLCanvasElement | null;
  /** The capture as a PNG data URL, or null with no 2D view or a failed bake or encoding. */
  capture2dImage(options?: MapCaptureOptions): string | null;
  /** Longest side one 2D capture may have on this GPU. */
  capture2dTextureCap(): number;
  /** 3D stills of `state` from `angles` (smart angles when omitted) on an off-screen scene, as PNG
   *  data URLs; an empty string for a still that failed, none without WebGL2. */
  capture3dStills(state: GridState, angles: CameraAngle[] | undefined, opts: { maxPx?: number; aspect?: number }): Promise<string[]>;
}
