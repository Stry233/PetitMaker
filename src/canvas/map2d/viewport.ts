import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX, PAN_KEEP_PX } from '../../core/model/constants';
import type { MacroCoord, MicroCoord } from '../../core/model/types';

export class Viewport {
  private zoom = 1;
  private offsetX = 0;
  private offsetY = 0;
  private canvasWidth: number;
  private canvasHeight: number;
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

  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
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

    // World coordinate under the anchor before zoom change
    const worldX = (anchorScreenX + this.offsetX) / this.zoom;
    const worldY = (anchorScreenY + this.offsetY) / this.zoom;

    this.zoom = clamped;

    // Adjust offset so the same world point stays under the anchor
    this.offsetX = worldX * this.zoom - anchorScreenX;
    this.offsetY = worldY * this.zoom - anchorScreenY;
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

    // Center the map in the canvas
    const renderedWidth = worldWidth * this.zoom;
    const renderedHeight = worldHeight * this.zoom;
    this.offsetX = -(this.canvasWidth - renderedWidth) / 2;
    this.offsetY = -(this.canvasHeight - renderedHeight) / 2;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx + this.offsetX) / this.zoom,
      y: (sy + this.offsetY) / this.zoom,
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

  macroToScreen(coord: MacroCoord): { x: number; y: number } {
    return {
      x: coord.x * TILE_SIZE * this.zoom - this.offsetX,
      y: coord.y * TILE_SIZE * this.zoom - this.offsetY,
    };
  }

  /** ViewProjection contract: cell corner in screen px + projected cell size. */
  cellToScreen(x: number, y: number): { x: number; y: number; scale: number } {
    const p = this.macroToScreen({ x, y });
    return { x: p.x, y: p.y, scale: TILE_SIZE * this.zoom };
  }
}
