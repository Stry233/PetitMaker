import * as PIXI from 'pixi.js-legacy';
import { maxRenderScale } from '../../../core/runtime/device-quality';
import { TILE_SIZE } from '../../../core/model/constants';
import { drawRoadShape } from '../draw/trim-shapes';
import type { PlacedObject } from '../../../core/model/types';
import { ItemCategory } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { detectRoadConn } from '../../../core/edge-cut/road-cut-states';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { hexStringToNumber } from '../../../core/model/colors';
import { useEditorStore } from '../../../state/store';
import { iconUrl } from '../../../assets/icon-urls';
import { animConfig } from '../../../core/runtime/anim-config';
import { requestRender } from '../render-scheduler';
import { spawnPuff } from '../draw/particles';
import { getIconTexture, iconColor, iconLodVersion } from '../draw/icon-color';
import { fitSpriteToTexture } from '../draw/sprite-fit';
import { drawRamp, isRampItem } from '../draw/ramp-graphic';
import { ChunkGrid, type CullRect } from './chunk-grid';
import { CULL_MARGIN_PX } from './chunk-cull';
import { hiddenSetFrom } from './layer-visibility';
import { MIN_NUMBER_ZOOM } from './number-overlay';
import { animateSquash, animateRotation, animateGroupRotation, animateRemove, fadeLayer } from './object-animations';
import type { GroupRotation } from '../../group-arc';

// Backing tint for an object with no sprite/color of its own — the shared fallback from
// anim-config (single source; the 3D poof tint reads the same table).
const OBJECT_COLOR = animConfig.fallbackColor;
const OBJECT_ALPHA = 0.5;
const CORNER_RADIUS = 6;

const SPRITE_FILL = 1.1; // sprite size relative to the object footprint

export class ObjectLayer {
  public readonly container: PIXI.Container;
  private objectMap: Map<string, PIXI.Container> = new Map();
  /** Icon sprites tracked for zoom-driven LOD swaps: near-1:1 texture sampling
   *  is what keeps icons panel-crisp; a fixed LOD always minifies through
   *  trilinear mip-blends at rest zoom (uniformly soft on hi-res displays). */
  private lodSprites: Array<{ sprite: PIXI.Sprite; url: string; footprintPx: number }> = [];
  private hiddenLayers = new Set<number>();
  private showNumbers = false;
  // Elevation labels also honour the number-overlay zoom LOD: below MIN_NUMBER_ZOOM they'd be an
  // illegible blur, so they hide alongside the terrain number raster rather than tracking only the
  // show-layer-numbers toggle.
  private numberZoomOk = true;
  private pendingPlop = new Set<string>();
  /** One sub-container per elevation, so a layer can fade as a unit. Inside each,
   *  wrappers live in CULLED chunk buckets (ChunkGrid) so an off-screen chunk's whole subtree
   *  is skipped per frame — pan/zoom cost tracks the objects on screen, not the map total. */
  private layerContainers = new Map<number, PIXI.Container>();
  private layerChunks = new Map<number, ChunkGrid>();
  private layerFadeAnim = new Map<number, number>();
  private lastCullRect: CullRect | null = null;
  /** Deferred elevation-label geometry per object — the Text is built lazily, only while
   *  numbers are shown (an always-allocated Text per object is a rasterized texture each,
   *  pure texture memory + node count on a full map). */
  private labelMeta = new Map<string, { text: string; y: number }>();

  constructor() {
    this.container = new PIXI.Container();
    this.container.sortableChildren = true; // layer containers sort by zIndex = elevation
  }

  /** The per-elevation sub-container for `elev`, created (z-ordered, and honoring
   *  the current hidden set) on first use. */
  private layerContainerFor(elev: number): PIXI.Container {
    let lc = this.layerContainers.get(elev);
    if (!lc) {
      lc = new PIXI.Container();
      lc.zIndex = elev; // higher elevations render on top
      if (this.hiddenLayers.has(elev)) { lc.visible = false; lc.alpha = 0; }
      this.layerContainers.set(elev, lc);
      this.container.addChild(lc);
    }
    return lc;
  }

  /** The chunk bucket for an object at (worldX, worldY) on `elev`. */
  private bucketFor(elev: number, worldX: number, worldY: number): PIXI.Container {
    let grid = this.layerChunks.get(elev);
    if (!grid) {
      grid = new ChunkGrid(this.layerContainerFor(elev));
      if (this.lastCullRect) grid.cull(this.lastCullRect);
      this.layerChunks.set(elev, grid);
    }
    return grid.bucketFor(worldX, worldY);
  }

  /** Toggle chunk visibility against the camera rect (called per viewport change). */
  cull(rect: CullRect): void {
    this.lastCullRect = rect;
    for (const grid of this.layerChunks.values()) grid.cull(rect);
    // Newly visible chunks may hold objects whose labels were deferred.
    if (this.labelsVisible()) this.buildVisibleLabels();
  }

  /** Whether elevation labels should currently show: the toggle is on AND we're zoomed in enough
   *  for them to be legible (mirrors the terrain number raster's MIN_NUMBER_ZOOM gate). */
  private labelsVisible(): boolean {
    return this.showNumbers && this.numberZoomOk;
  }

  /** Re-apply the current visibility to every built `_elev` label (a ramp carries two — its high
   *  and low elevation numbers — so toggle ALL matching children, not just the first). */
  private applyLabelVisibility(): void {
    const vis = this.labelsVisible();
    for (const wrapper of this.objectMap.values()) {
      for (const child of wrapper.children) if (child.name === '_elev') child.visible = vis;
    }
  }

  setShowNumbers(show: boolean): void {
    if (show === this.showNumbers) return;
    this.showNumbers = show;
    requestRender();
    this.applyLabelVisibility();
    // Labels that never existed build lazily, VISIBLE CHUNKS ONLY — rasterizing a
    // Text per object across a whole generated map in one frame is a toggle hitch
    // of thousands of mini-canvases; off-screen chunks get theirs on cull-in.
    if (this.labelsVisible()) this.buildVisibleLabels();
  }

  /** Gate the elevation labels by zoom, exactly like the terrain number raster: hide them below
   *  MIN_NUMBER_ZOOM and re-show (building any deferred ones) when zoomed back in. Called per
   *  viewport change from MapRenderer. */
  setNumberZoom(zoom: number): void {
    const ok = zoom >= MIN_NUMBER_ZOOM;
    if (ok === this.numberZoomOk) return;
    this.numberZoomOk = ok;
    requestRender();
    this.applyLabelVisibility();
    if (this.labelsVisible()) this.buildVisibleLabels();
  }

  /** Ids whose wrapper already carries its elevation label. */
  private labelBuilt = new Set<string>();

  /** Wrappers of objects too large for chunk bucketing (see addObjects) — they
   *  live UNCULLED in their per-elevation container, so label building must
   *  visit them explicitly (they're in no bucket). */
  private unculledWrappers = new Set<PIXI.Container>();

  private buildVisibleLabels(): void {
    for (const grid of this.layerChunks.values()) {
      for (const bucket of grid.visibleBuckets()) {
        for (const child of bucket.children) this.buildLabelFor(child);
      }
    }
    for (const wrapper of this.unculledWrappers) this.buildLabelFor(wrapper);
  }

  private buildLabelFor(child: PIXI.DisplayObject): void {
    const id = child.name;
    if (!id || this.labelBuilt.has(id)) return;
    const meta = this.labelMeta.get(id);
    if (!meta) return;
    (child as PIXI.Container).addChild(this.makeElevLabel(meta.text, meta.y));
    this.labelBuilt.add(id);
    requestRender();
  }

  private makeElevLabel(text: string, y: number): PIXI.Text {
    const numLabel = new PIXI.Text(text, {
      fontSize: 14,
      fontWeight: 'bold',
      fontFamily: 'monospace',
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
    });
    numLabel.name = '_elev';
    numLabel.x = 3;
    numLabel.y = y;
    numLabel.anchor.set(0, 1);
    numLabel.visible = this.labelsVisible();
    return numLabel;
  }

  setLayerVisibility(visibility: Record<number, boolean>): void {
    requestRender();
    this.hiddenLayers = hiddenSetFrom(visibility);
    // Fade each per-elevation container as a unit (one fade per layer, never
    // per-object). Reduced motion snaps instantly.
    for (const [elev, lc] of this.layerContainers) {
      fadeLayer(lc, elev, !this.hiddenLayers.has(elev), this.layerFadeAnim);
    }
  }

  /** The zoom×resolution (and icon-LOD cache version) the LOD sprites were last settled
   *  at; −1 forces the next updateLod to run (async icon decodes swap cache entries under
   *  us — see iconLodVersion). */
  private lastLodScale = -1;
  private lastLodVersion = -1;
  /** Sprites added since the last settle — fresh sprites carry an oversized default texture,
   *  so the next updateLod settles JUST these: a placement costs O(new sprites), and a full
   *  sweep runs only when the scale or icon-LOD version changes. */
  private pendingLod: Array<{ sprite: PIXI.Sprite; url: string; footprintPx: number }> = [];

  private settleLod(e: { sprite: PIXI.Sprite; url: string; footprintPx: number }, scale: number): void {
    if (e.sprite.destroyed) return;
    const w = e.sprite.width, h = e.sprite.height; // absolute size — survives the swap
    const tex = getIconTexture(e.url, e.footprintPx * scale);
    if (e.sprite.texture !== tex) { e.sprite.texture = tex; e.sprite.width = w; e.sprite.height = h; }
  }

  /** Swap icon textures to the LOD bucket matching the live zoom (device px). */
  updateLod(zoom: number, resolution: number): void {
    // Pans call this every pointer-move with an unchanged zoom — the buckets can't
    // change, so skip the all-sprites loop unless the scale actually moved or an
    // async icon decode swapped a cached texture since the last settle. Newly added
    // sprites still need their first settle: O(new), never O(all).
    const scale = zoom * resolution;
    const version = iconLodVersion();
    if (scale === this.lastLodScale && version === this.lastLodVersion) {
      if (this.pendingLod.length) {
        for (const e of this.pendingLod) this.settleLod(e, scale);
        this.pendingLod = [];
      }
      return;
    }
    this.lastLodScale = scale;
    this.lastLodVersion = version;
    this.pendingLod = [];
    for (const e of this.lodSprites) this.settleLod(e, scale);
  }

  /**
   * Synchronize the layer with the full set of placed objects.
   * Adds new objects and removes deleted ones.
   */
  sync(objects: Map<string, PlacedObject>): void {
    this.lodSprites = this.lodSprites.filter((e) => !e.sprite.destroyed);
    requestRender();
    // Remove objects no longer present
    const toRemove: string[] = [];
    for (const id of this.objectMap.keys()) {
      if (!objects.has(id)) {
        toRemove.push(id);
      }
    }
    this.removeObjects(toRemove);

    // Add objects not yet rendered
    const toAdd: PlacedObject[] = [];
    for (const [id, obj] of objects) {
      if (!this.objectMap.has(id)) {
        toAdd.push(obj);
      }
    }
    this.addObjects(toAdd);
  }

  /**
   * Add visual placeholders for the given objects.
   * Each is a colored rounded rectangle with a 3-char label.
   */
  addObjects(objects: PlacedObject[]): void {
    for (const obj of objects) {
      if (this.objectMap.has(obj.id)) this.removeObjects([obj.id]); // idempotent: re-adding an id replaces, never orphans the old sprite
      const item = getCatalogItem(obj.catalogId);
      const size = getPlacedObjectSize(obj);
      const ramp = isRampItem(item);
      // Resolved backing color: self-described off-catalog objects (the plaza) carry their own color;
      // catalog objects use item.color. This lets the plaza render through the normal object path.
      const bgColor = obj.color ?? item?.color;

      const wrapper = new PIXI.Container();
      wrapper.name = obj.id;

      if (ramp && item) {
        drawRamp(wrapper, obj, item, size, this.labelsVisible());
      } else {
        // Icon: self-described objects (plaza) carry obj.icon; catalog objects use item.icon unless
        // they are color-only (roads). spriteUrl drives the sprite path; otherwise a colored box.
        const iconName = obj.icon ?? (!item?.color ? item?.icon : undefined);
        const spriteUrl = iconName ? iconUrl(iconName) : undefined;

        if (spriteUrl) {
          // Non-1x1 footprints keep their background box (so the multi-cell
          // extent stays visible) even when an icon sits on top; 1x1 items show
          // the icon alone.
          if (size.w > 1 || size.h > 1) {
            const bg = new PIXI.Graphics();
            bg.beginFill(bgColor ? hexStringToNumber(bgColor) : OBJECT_COLOR, bgColor ? 0.85 : OBJECT_ALPHA);
            bg.drawRoundedRect(0, 0, size.w * TILE_SIZE, size.h * TILE_SIZE, CORNER_RADIUS);
            bg.endFill();
            wrapper.addChild(bg);
          }
          // Real sprite art on top. Fit the icon within the footprint by its
          // actual texture dimensions (icons vary: 256x256 plants, 700x400
          // bridges). Scale on load if the image hasn't decoded yet (avoids
          // reading width=0), hidden until then.
          // LOD budget in DEVICE px: footprint x renderer resolution (DPR cap) x4
          // zoom-in headroom. Resolution must be in the formula — a world-px
          // budget would upscale at zoom>1, leaving the map icon blurry while
          // the same icon is crisp as a DOM <img> in the placement panel.
          const tex = getIconTexture(spriteUrl, Math.max(size.w, size.h) * TILE_SIZE * maxRenderScale() * 4);
          const sprite = new PIXI.Sprite(tex);
          sprite.anchor.set(0.5);
          sprite.x = (size.w * TILE_SIZE) / 2;
          sprite.y = (size.h * TILE_SIZE) / 2;
          // Rotatable items (buildings, facilities) spin their icon with the
          // placement; fixed-orientation items (bridges, ramps, …) never do.
          sprite.rotation = item?.rotatable ? (obj.rotation * Math.PI) / 180 : 0;
          if (item?.rotatable) sprite.name = '_icon'; // animateRotation tweens this
          const fw = size.w * TILE_SIZE;
          const fh = size.h * TILE_SIZE;
          // Self-described objects (the plaza) carry a filled platform image — CONTAIN it within the
          // footprint (no 1.1 overflow) so the icon stays inside its grey backing box.
          const spriteFill = obj.icon ? 1 : SPRITE_FILL;
          fitSpriteToTexture(sprite, tex, (tw, th) => Math.min(fw / tw, fh / th) * spriteFill);
          const lodEntry = { sprite, url: spriteUrl, footprintPx: Math.max(fw, fh) };
          this.lodSprites.push(lodEntry);
          this.pendingLod.push(lodEntry); // starts on the oversized default — next updateLod settles it (O(new))
          wrapper.addChild(sprite);
        } else {
          const fillColor = bgColor ? hexStringToNumber(bgColor) : OBJECT_COLOR;
          const fillAlpha = bgColor ? 0.85 : OBJECT_ALPHA;
          const g = new PIXI.Graphics();
          if (item?.category === ItemCategory.Road) {
            // Roads always go through drawRoadShape: uncut → square full tile
            // (continuous), cut → the canonical trimmed state.
            const state = useEditorStore.getState().gridState;
            const connSide = state ? detectRoadConn(state, obj) : 'left';
            drawRoadShape(g, obj.corners, connSide, 0, 0, size.w * TILE_SIZE, size.h * TILE_SIZE, fillColor, fillAlpha);
          } else {
            g.beginFill(fillColor, fillAlpha);
            g.drawRoundedRect(0, 0, size.w * TILE_SIZE, size.h * TILE_SIZE, CORNER_RADIUS);
            g.endFill();
          }
          wrapper.addChild(g);

          if (!item?.color) {
            const emoji = item?.emoji;
            const fontSize = Math.min(size.w, size.h) * TILE_SIZE * 0.6;
            const label = new PIXI.Text(emoji ?? obj.catalogId.slice(0, 3), {
              fontSize,
              fontFamily: 'serif',
            });
            label.anchor.set(0.5);
            label.x = (size.w * TILE_SIZE) / 2;
            label.y = (size.h * TILE_SIZE) / 2;
            label.rotation = (obj.rotation * Math.PI) / 180;
            wrapper.addChild(label);
          }
        }

        // Elevation label: geometry recorded now, the Text built only while numbers are
        // shown (see labelMeta — a Text per object is a rasterized texture each).
        this.labelMeta.set(obj.id, { text: String(obj.elevation), y: size.h * TILE_SIZE - 3 });
        if (this.labelsVisible()) {
          wrapper.addChild(this.makeElevLabel(String(obj.elevation), size.h * TILE_SIZE - 3));
          this.labelBuilt.add(obj.id);
        }
      }

      wrapper.x = obj.position.x * TILE_SIZE;
      wrapper.y = obj.position.y * TILE_SIZE;

      this.objectMap.set(obj.id, wrapper);
      // Into its chunk bucket inside the per-elevation container (which carries this layer's
      // visibility/alpha), so layer fades stay one operation AND off-screen chunks cull.
      // Chunks are bucketed by the ANCHOR cell with a CULL_MARGIN_PX overscan for spill —
      // an object that spills FURTHER (the plaza's 20×27 footprint) can be on screen while
      // its anchor chunk is culled, so it skips the buckets and never culls (still fades
      // with its elevation container; a map holds at most a handful of such giants).
      if (Math.max(size.w, size.h) * TILE_SIZE > CULL_MARGIN_PX) {
        this.layerContainerFor(obj.elevation).addChild(wrapper);
        this.unculledWrappers.add(wrapper);
      } else {
        this.bucketFor(obj.elevation, wrapper.x, wrapper.y).addChild(wrapper);
      }

      // A deliberately point-placed object plops (squash + dust puff) the
      // instant its wrapper exists. Bulk adds never request a plop.
      if (this.pendingPlop.has(obj.id)) {
        this.pendingPlop.delete(obj.id);
        this.animateSquash(obj.id, Math.max(size.w, size.h));
        const place = animConfig.puff.place;
        // Tint the dust with the icon's own hue (falls back to the warm default
        // until the texture image is decoded).
        const placeUrl = item?.icon ? iconUrl(item.icon) : undefined;
        const placeColor = (placeUrl ? iconColor(placeUrl) : null) ?? place.color;
        // Bigger objects kick up dust across a wider base: scale travel by the
        // footprint extent (1 for a 1x1, larger for big items) and add a few more
        // particles to keep the spread from looking thin. Emitted at the base and
        // rendered UNDER the icon (behind:true) so it reads as dust beneath it.
        const ext = (size.w + size.h) / 2;
        spawnPuff(
          this.container,
          (obj.position.x + size.w / 2) * TILE_SIZE,
          (obj.position.y + size.h) * TILE_SIZE,
          {
            count: Math.min(animConfig.puff.globalCap, Math.round(place.count * Math.sqrt(ext))),
            color: placeColor, spreadPx: place.spread * TILE_SIZE * ext,
            lifetimeMs: place.lifetimeMs, risePx: place.risePx, gravity: place.gravity,
            arcSpread: place.arcSpread, maxRadiusPx: place.maxRadiusPx, behind: true,
          },
        );
      }
    }
  }

  /**
   * Remove and destroy the visuals for the given object IDs.
   */
  removeObjects(ids: string[]): void {
    for (const id of ids) {
      const wrapper = this.objectMap.get(id);
      if (wrapper) {
        this.unculledWrappers.delete(wrapper);
        wrapper.parent?.removeChild(wrapper); // parent: its chunk bucket, or the elevation container for unculled giants
        wrapper.destroy({ children: true });
        this.objectMap.delete(id);
      }
      this.labelMeta.delete(id);
      this.labelBuilt.delete(id);
    }
    // Destroyed sprites must leave the LOD list here too — sync() only runs on bulk
    // ops, and a long editing session would otherwise sweep an ever-growing tail of
    // dead entries on every zoom change.
    this.lodSprites = this.lodSprites.filter((e) => !e.sprite.destroyed);
  }

  /**
   * Mark an object id to "plop" (squash + dust puff) the instant its wrapper is
   * next created in addObjects. Called only for a deliberate point-placement, so
   * bulk adds (load / undo / generate / scatter) never animate.
   */
  requestPlop(id: string): void {
    this.pendingPlop.add(id);
  }

  /** Delegates to object-animations.ts animateSquash — see there for the design notes. */
  animateSquash(objectId: string, sizeCells = 1): void {
    animateSquash(this.objectMap, objectId, sizeCells);
  }

  /** Delegates to object-animations.ts animateRotation — see there for the design notes. */
  animateRotation(id: string, fromDeg: number, toDeg: number, onFrame?: (eased: number) => void): void {
    animateRotation(this.objectMap, id, fromDeg, toDeg, onFrame);
  }

  /** Delegates to object-animations.ts animateGroupRotation — see there for the design notes. */
  animateGroupRotation(turn: GroupRotation, onFrame?: (eased: number) => void): void {
    animateGroupRotation(this.objectMap, turn, onFrame);
  }

  /** Delegates to object-animations.ts animateRemove — see there for the design notes.
   *  Must be called BEFORE the RemoveObject command executes, while the wrapper still exists. */
  animateRemove(id: string): void {
    animateRemove(this.objectMap, this.container, id);
  }
}
