import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX, PAN_KEEP_PX } from '../../core/model/constants';
import type { MacroCoord, MicroCoord } from '../../core/model/types';

/**
 * The 2D camera, and the conversion between the WINDOW's coordinates and the map's.
 *
 * SCREEN MEANS CLIENT PX, which is `ViewProjection`'s contract on both live views: the pointer
 * machine hands `clientX`/`clientY` in unconverted and the React chrome anchors to what comes back.
 * The canvas is not always at the window's corner — the assistant's docked panel takes a strip of
 * the window and the map occupies what is left of it — so every conversion asks WHERE THE CANVAS
 * STANDS NOW (`setOriginSource`, the 3D projection's own per-ray rect read). Read at use, never
 * recorded: the box also MOVES without resizing (the dock slide settles a transform away, a banner
 * above the plane departs), and no resize event marks those moments, so an origin captured at the
 * last resize answers for where the canvas used to be.
 */
export class Viewport {
  private zoom = 1;
  private offsetX = 0;
  private offsetY = 0;
  private canvasWidth: number;
  private canvasHeight: number;
  /** Where the canvas's own top-left corner stands in the window, in css px. */
  private originSource: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
  /** Map world size in unscaled px (0 until fitToMap runs) — the pan bounds. */
  private worldWidth = 0;
  private worldHeight = 0;

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

  /** Full view state (zoom + offset), for tweening the camera between two views. */
  getView(): { zoom: number; offsetX: number; offsetY: number } {
    return { zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY };
  }

  setView(v: { zoom: number; offsetX: number; offsetY: number }): void {
    this.zoom = v.zoom;
    this.offsetX = v.offsetX;
    this.offsetY = v.offsetY;
    this.clampOffset();
  }

  /**
   * A BOX CHANGE KEEPS THE WORLD POINT AT THE BOX'S CENTRE, at the zoom the camera holds — the 3D
   * camera's own behaviour, whose projection is about its box centre and takes only the aspect from
   * a resize. A page-zoom step needs the anchor read BEFORE its rebase redefines the css px, which
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
   * Where the canvas stands in the window, in css px. Moves the CANVAS and not the camera: the same
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
   * map keeps its PHYSICAL scale, which is the thing the user is looking at and the thing the 3D
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
   * Keep the map on screen: at least PAN_KEEP_PX of it (or half of it, when it
   * renders smaller) stays inside the canvas on each axis. One clamp under
   * every camera mutation, so no pan/zoom/tween/restore path can lose the map.
   */
  private clampOffset(): void {
    if (this.worldWidth <= 0 || this.worldHeight <= 0) return;
    const mapW = this.worldWidth * this.zoom;
    const mapH = this.worldHeight * this.zoom;
    const keepX = Math.min(PAN_KEEP_PX, mapW / 2);
    const keepY = Math.min(PAN_KEEP_PX, mapH / 2);
    this.offsetX = Math.min(mapW - keepX, Math.max(keepX - this.canvasWidth, this.offsetX));
    this.offsetY = Math.min(mapH - keepY, Math.max(keepY - this.canvasHeight, this.offsetY));
  }

  /**
   * Set zoom level, clamped to [ZOOM_MIN, ZOOM_MAX], centered on the given
   * screen anchor point so the world coordinate under the cursor stays fixed.
   */
  setZoom(newZoom: number, anchorScreenX: number, anchorScreenY: number): void {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
    const origin = this.originSource();
    const ax = anchorScreenX - origin.x;
    const ay = anchorScreenY - origin.y;

    // World coordinate under the anchor before zoom change
    const worldX = (ax + this.offsetX) / this.zoom;
    const worldY = (ay + this.offsetY) / this.zoom;

    this.zoom = clamped;

    // Adjust offset so the same world point stays under the anchor
    this.offsetX = worldX * this.zoom - ax;
    this.offsetY = worldY * this.zoom - ay;
    this.clampOffset();
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampOffset();
  }

  /**
   * Auto-zoom and center so the full map (mapWidth x mapHeight macro cells)
   * fits within the canvas.
   */
  fitToMap(mapWidth: number, mapHeight: number): void {
    const worldWidth = mapWidth * TILE_SIZE;
    const worldHeight = mapHeight * TILE_SIZE;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    const scaleX = this.canvasWidth / worldWidth;
    const scaleY = this.canvasHeight / worldHeight;
    const idealZoom = Math.min(scaleX, scaleY);
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, idealZoom));

    const renderedWidth = worldWidth * this.zoom;
    const renderedHeight = worldHeight * this.zoom;
    this.offsetX = -(this.canvasWidth - renderedWidth) / 2;
    this.offsetY = -(this.canvasHeight - renderedHeight) / 2;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const origin = this.originSource();
    return {
      x: (sx - origin.x + this.offsetX) / this.zoom,
      y: (sy - origin.y + this.offsetY) / this.zoom,
    };
  }

  screenToMacro(sx: number, sy: number): MacroCoord {
    const world = this.screenToWorld(sx, sy);
    return {
      x: Math.floor(world.x / TILE_SIZE),
      y: Math.floor(world.y / TILE_SIZE),
    };
  }

  screenToMicro(sx: number, sy: number): MicroCoord {
    const world = this.screenToWorld(sx, sy);
    const halfTile = TILE_SIZE / 2;
    return {
      x: Math.floor(world.x / halfTile),
      y: Math.floor(world.y / halfTile),
    };
  }

  screenToHalf(sx: number, sy: number): MacroCoord {
    const world = this.screenToWorld(sx, sy);
    return {
      x: Math.round((world.x / TILE_SIZE) * 2) / 2,
      y: Math.round((world.y / TILE_SIZE) * 2) / 2,
    };
  }

  macroToScreen(coord: MacroCoord): { x: number; y: number } {
    const origin = this.originSource();
    return {
      x: coord.x * TILE_SIZE * this.zoom - this.offsetX + origin.x,
      y: coord.y * TILE_SIZE * this.zoom - this.offsetY + origin.y,
    };
  }

  /** ViewProjection contract: cell corner in screen px + projected cell size. */
  cellToScreen(x: number, y: number): { x: number; y: number; scale: number } {
    const p = this.macroToScreen({ x, y });
    return { x: p.x, y: p.y, scale: TILE_SIZE * this.zoom };
  }
}
