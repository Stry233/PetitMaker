import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX, PAN_KEEP_PX } from '../geometry/world';
import { CULL_MARGIN_PX, type CullRect } from '../geometry/chunk-cull';
import type { MacroCoord } from '../../../core/model/types';
import { mapPoint, type MapPoint } from '../../../core/grid/grids';
import type { View2dCamera } from '../../../state/view-camera';

/** A 2D camera pose: zoom, the pan offset in the unturned frame, and the heading in radians. */
export interface View2dPose { zoom: number; offsetX: number; offsetY: number; heading: number }

/** An angle in radians as the same direction within (-π, π]. */
export const withinOneTurn = (h: number): number => Math.atan2(Math.sin(h), Math.cos(h));

/** A pose as the editor hands it between views, sessions and saves; the home heading is left out,
 *  so a pose at it reads as it did before the view could turn. */
export function cameraOfPose(v: View2dPose): View2dCamera {
  return { x: v.offsetX, y: v.offsetY, zoom: v.zoom, ...(v.heading ? { rotation: v.heading } : {}) };
}

/** A handed or saved camera as a pose, at the home heading where it names none. */
export function poseOfCamera(c: View2dCamera): View2dPose {
  return { zoom: c.zoom, offsetX: c.x, offsetY: c.y, heading: c.rotation ?? 0 };
}

/**
 * The 2D camera and conversion between client pixels and map coordinates. Each conversion reads the
 * current canvas origin because layout transforms can move the canvas without a resize event.
 *
 * The heading turns the drawn map about the canvas centre, a positive one counter-clockwise on
 * screen. Zoom, offset and the pan clamp live in the unturned frame, the canvas as it stands at the
 * home heading, so every conversion turns a canvas point into that frame first and nothing else
 * knows the map is turned.
 */
export class Viewport {
  private zoom = 1;
  private offsetX = 0;
  private offsetY = 0;
  private heading = 0;
  private canvasWidth: number;
  private canvasHeight: number;
  /** Where the canvas's own top-left corner stands in the window, in css px. */
  private originSource: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
  /** Map world size in unscaled px (0 until fitToMap runs) — the pan bounds. */
  private worldWidth = 0;
  private worldHeight = 0;
  private worldX = 0;
  private worldY = 0;

  constructor(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  getZoom(): number {
    return this.zoom;
  }

  getOffset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }

  /** The heading in radians, positive turning the map counter-clockwise on screen. */
  getHeading(): number {
    return this.heading;
  }

  /** Full view state, for tweening the camera between two views. */
  getView(): View2dPose {
    return { zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY, heading: this.heading };
  }

  /** A camera from outside (a save, a script): the zoom is held inside this view's range, and a pose
   *  without a heading stands at the home heading. */
  setView(v: { zoom: number; offsetX: number; offsetY: number; heading?: number }): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom));
    this.offsetX = v.offsetX;
    this.offsetY = v.offsetY;
    this.heading = withinOneTurn(v.heading ?? 0);
    this.clampOffset();
  }

  /** Turn the map about the canvas centre; the map point there stays put. */
  turnBy(dRadians: number): void {
    this.turnTo(this.heading + dRadians);
  }

  /** Turn the map about the canvas centre to `heading`. */
  turnTo(heading: number): void {
    this.heading = withinOneTurn(heading);
    this.clampOffset();
  }

  /**
   * The transform that draws the world as the conversions read it, in a scene graph's terms
   * (screen = position + rotate(rotation) · scale · (world − pivot)): the world point at the canvas
   * centre pivots there. A graph that turns clockwise for a positive rotation, as Pixi does, takes
   * the heading negated.
   */
  stageTransform(): { scale: number; pivot: { x: number; y: number }; position: { x: number; y: number }; rotation: number } {
    const cx = this.canvasWidth / 2, cy = this.canvasHeight / 2;
    return {
      scale: this.zoom,
      pivot: { x: (this.offsetX + cx) / this.zoom, y: (this.offsetY + cy) / this.zoom },
      position: { x: cx, y: cy },
      rotation: -this.heading,
    };
  }

  /** A canvas-local point (css px from the canvas's top-left) in the unturned frame. */
  private toFrame(x: number, y: number): { x: number; y: number } {
    const cx = this.canvasWidth / 2, cy = this.canvasHeight / 2;
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  /** An unturned-frame point back to canvas-local css px. */
  private fromFrame(x: number, y: number): { x: number; y: number } {
    const cx = this.canvasWidth / 2, cy = this.canvasHeight / 2;
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
  }

  /**
   * A box change keeps the world point at the box's centre, at the zoom the camera holds — the 3D
   * camera's own behaviour, whose projection is about its box centre and takes only the aspect from
   * a resize. A page-zoom step needs the anchor read before its rebase redefines the css px, which
   * is `MapRenderer.resize`'s pin; this one serves every caller that has no rebase in between.
   */
  resize(width: number, height: number): void {
    const centre = this.worldAtCentre();
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.centreOn(centre);
  }

  /** The world point standing at the canvas's own centre: the anchor a box change preserves. */
  worldAtCentre(): { x: number; y: number } {
    return {
      x: (this.canvasWidth / 2 + this.offsetX) / this.zoom,
      y: (this.canvasHeight / 2 + this.offsetY) / this.zoom,
    };
  }

  /** Put a world point at the canvas's centre, at the zoom the camera already holds. */
  centreOn(world: { x: number; y: number }): void {
    this.offsetX = world.x * this.zoom - this.canvasWidth / 2;
    this.offsetY = world.y * this.zoom - this.canvasHeight / 2;
    this.clampOffset();
  }

  /**
   * Where the canvas stands in the window, in css px. Moves the canvas and not the camera: the same
   * world point is drawn at a client point this much further along, and a client point picks the
   * world point that is now under it. A constant place, for a surface no layout ever moves.
   */
  setOrigin(left: number, top: number): void {
    this.originSource = () => ({ x: left, y: top });
  }

  /** A live reading of where the canvas stands, consulted by every conversion at the moment it
   *  runs. The renderer hands in its own container's rect, so the answer follows the box through
   *  moves nothing resizes. */
  setOriginSource(source: () => { x: number; y: number }): void {
    this.originSource = source;
  }

  /**
   * Re-express the camera after the page zoom changed by `ratio`, so the map holds the size it
   * had on screen.
   *
   * `zoom` and the offsets are both in CSS px, and page zoom redefines what a CSS px is: at 110%
   * the same numbers draw the map 10% bigger. Dividing both by the ratio cancels that exactly — the
   * map keeps its physical scale, which is the thing the user is looking at and the thing the 3D
   * view already holds (its canvas covers the same device pixels either way). Without this the two
   * views disagree about how big the world is, and only one of them answers to the app's own zoom.
   */
  rebaseForPageZoom(ratio: number): void {
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return;
    this.zoom /= ratio;
    this.offsetX /= ratio;
    this.offsetY /= ratio;
    this.clampOffset();
  }

  /**
   * Keep the map on screen: at least PAN_KEEP_PX of it (or half of it, when it renders smaller)
   * stays inside the shown rect on each axis. One clamp under every camera mutation, so no
   * pan/zoom/turn/tween/restore path can lose the map.
   */
  private clampOffset(): void {
    if (this.worldWidth <= 0 || this.worldHeight <= 0) return;
    const mapW = this.worldWidth * this.zoom;
    const mapH = this.worldHeight * this.zoom;
    const keepX = Math.min(PAN_KEEP_PX, mapW / 2);
    const keepY = Math.min(PAN_KEEP_PX, mapH / 2);
    const left = this.worldX * this.zoom, top = this.worldY * this.zoom;
    const shown = this.shownFrameRect();
    this.offsetX = Math.min(left + mapW - keepX - shown.x, Math.max(left + keepX - shown.x - shown.w, this.offsetX));
    this.offsetY = Math.min(top + mapH - keepY - shown.y, Math.max(top + keepY - shown.y - shown.h, this.offsetY));
  }

  /**
   * The largest rect of the canvas's own shape, centred on it and square to the unturned frame, that
   * the turned canvas still shows whole: the canvas itself at the home heading, smaller between, so
   * what the clamp keeps inside it is on screen at any heading.
   */
  private shownFrameRect(): { x: number; y: number; w: number; h: number } {
    const w = this.canvasWidth, h = this.canvasHeight;
    const cos = Math.abs(Math.cos(this.heading)), sin = Math.abs(Math.sin(this.heading));
    const scale = Math.min(1, w / (w * cos + h * sin), h / (w * sin + h * cos));
    return { x: (w - w * scale) / 2, y: (h - h * scale) / 2, w: w * scale, h: h * scale };
  }

  /**
   * Set zoom level, clamped to [ZOOM_MIN, ZOOM_MAX], centered on the given
   * screen anchor point so the world coordinate under the cursor stays fixed.
   */
  setZoom(newZoom: number, anchorScreenX: number, anchorScreenY: number): void {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
    const origin = this.originSource();
    const { x: ax, y: ay } = this.toFrame(anchorScreenX - origin.x, anchorScreenY - origin.y);

    // World coordinate under the anchor before zoom change
    const worldX = (ax + this.offsetX) / this.zoom;
    const worldY = (ay + this.offsetY) / this.zoom;

    this.zoom = clamped;

    // Adjust offset so the same world point stays under the anchor
    this.offsetX = worldX * this.zoom - ax;
    this.offsetY = worldY * this.zoom - ay;
    this.clampOffset();
  }

  /** Zoom about the canvas's own centre, the anchor a box change preserves. */
  setZoomAtCentre(newZoom: number): void {
    const origin = this.originSource();
    this.setZoom(newZoom, origin.x + this.canvasWidth / 2, origin.y + this.canvasHeight / 2);
  }

  /** Slide the view by a screen delta, along the screen whatever the heading. */
  pan(dx: number, dy: number): void {
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    this.offsetX += dx * cos - dy * sin;
    this.offsetY += dx * sin + dy * cos;
    this.clampOffset();
  }

  /**
   * Auto-zoom and center so the full map (mapWidth x mapHeight macro cells)
   * fits within the canvas.
   */
  fitToMap(mapWidth: number, mapHeight: number, originX = 0, originY = 0): void {
    this.worldWidth = mapWidth * TILE_SIZE;
    this.worldHeight = mapHeight * TILE_SIZE;
    this.worldX = originX * TILE_SIZE;
    this.worldY = originY * TILE_SIZE;
    this.setView(this.fittedView(mapWidth, mapHeight, originX, originY));
  }

  /** The view `fitToMap` lands on for the same map, at the home heading, leaving this one as it
   *  stands. */
  fittedView(mapWidth: number, mapHeight: number, originX = 0, originY = 0): View2dPose {
    const worldWidth = mapWidth * TILE_SIZE;
    const worldHeight = mapHeight * TILE_SIZE;
    const idealZoom = Math.min(this.canvasWidth / worldWidth, this.canvasHeight / worldHeight);
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, idealZoom));
    return {
      zoom,
      offsetX: originX * TILE_SIZE * zoom - (this.canvasWidth - worldWidth * zoom) / 2,
      offsetY: originY * TILE_SIZE * zoom - (this.canvasHeight - worldHeight * zoom) / 2,
      heading: 0,
    };
  }

  /**
   * The view at this heading that draws the map rectangle `box` (in cells) as large as fits the
   * window box `into` (client px), centred in it; the zoom stays in range and the pan clamp holds.
   */
  boxedView(box: { x: number; y: number; w: number; h: number }, into: { left: number; top: number; width: number; height: number }): View2dPose {
    const cos = Math.abs(Math.cos(this.heading)), sin = Math.abs(Math.sin(this.heading));
    const across = (box.w * cos + box.h * sin) * TILE_SIZE, deep = (box.w * sin + box.h * cos) * TILE_SIZE;
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(into.width / across, into.height / deep)));
    const origin = this.originSource();
    const at = this.toFrame(into.left + into.width / 2 - origin.x, into.top + into.height / 2 - origin.y);
    const cx = (box.x + box.w / 2) * TILE_SIZE, cy = (box.y + box.h / 2) * TILE_SIZE;
    return { zoom, offsetX: cx * zoom - at.x, offsetY: cy * zoom - at.y, heading: this.heading };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const origin = this.originSource();
    return this.canvasToWorld(sx - origin.x, sy - origin.y);
  }

  /** The world point (unscaled px) drawn at a canvas-local point. */
  private canvasToWorld(x: number, y: number): { x: number; y: number } {
    const q = this.toFrame(x, y);
    return { x: (q.x + this.offsetX) / this.zoom, y: (q.y + this.offsetY) / this.zoom };
  }

  /**
   * The world rect (unscaled px, overscan included) holding everything drawn on the canvas, or on a
   * square of it given in canvas css px: the bounds of its turned corners.
   */
  visibleWorldRect(square?: { x: number; y: number; side: number }): CullRect {
    const x0 = square?.x ?? 0, y0 = square?.y ?? 0;
    const x1 = square ? x0 + square.side : this.canvasWidth, y1 = square ? y0 + square.side : this.canvasHeight;
    const corners = [this.canvasToWorld(x0, y0), this.canvasToWorld(x1, y0), this.canvasToWorld(x0, y1), this.canvasToWorld(x1, y1)];
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    return {
      left: Math.min(...xs) - CULL_MARGIN_PX,
      top: Math.min(...ys) - CULL_MARGIN_PX,
      right: Math.max(...xs) + CULL_MARGIN_PX,
      bottom: Math.max(...ys) + CULL_MARGIN_PX,
    };
  }

  /** ViewProjection contract: the map point under a screen point, in cells. */
  screenToPoint(sx: number, sy: number): MapPoint {
    const world = this.screenToWorld(sx, sy);
    return mapPoint({ x: world.x / TILE_SIZE, y: world.y / TILE_SIZE });
  }

  macroToScreen(coord: MacroCoord): { x: number; y: number } {
    const origin = this.originSource();
    const p = this.fromFrame(coord.x * TILE_SIZE * this.zoom - this.offsetX, coord.y * TILE_SIZE * this.zoom - this.offsetY);
    return { x: p.x + origin.x, y: p.y + origin.y };
  }

  /** ViewProjection contract: cell corner in screen px + projected cell size. */
  cellToScreen(x: number, y: number): { x: number; y: number; scale: number } {
    const p = this.macroToScreen({ x, y });
    return { x: p.x, y: p.y, scale: TILE_SIZE * this.zoom };
  }
}
