import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { maxRenderScale } from '../../../platform/device/device-quality';
import { TILE_SIZE } from '../geometry/world';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import { coatingLayer, hasTrait, isCoatingItem, isRamp, isSurfacePrint } from '../../../core/model/traits';
import { roadLookup } from '../../../state/object-index';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { objectElevation, getPlacedObjectSize } from '../../../state/object-geometry';
import { hexStringToNumber } from '../../../core/base/color';
import { iconUrl } from '../../../assets/icon-urls';
import { animConfig } from '../../shared/motion/anim-config';
import { FALLBACK_TINT } from '../../shared/icon/item-tint';
import { spawnPuff } from '../draw/particles';
import { getIconTexture, iconColor, iconLodVersion } from '../draw/icon-texture';
import { fitSpriteToTexture, footprintFit, itemSpriteFill, spriteTurns } from '../draw/sprite-fit';
import { drawRamp } from '../draw/ramp-graphic';
import { objectSpriteUrl } from '../draw/object-sprite-url';
import { ChunkGrid, type CullRect } from './chunk-grid';
import { RoadSurfaces } from './road-surfaces';
import { materialTexture } from '../draw/road-surface';
import { CULL_MARGIN_PX } from '../geometry/chunk-cull';
import { hiddenSetFrom } from '../../shared/terrain/layer-visibility';
import { MIN_NUMBER_ZOOM } from './number-overlay';
import { animateSquash, animateRotation, animateGroupRotation, animateRemove, fadeLayer } from './object-animations';
import type { GroupRotation } from '../../../tools/objects';
import { OBJECT_CHILD } from '../draw/object-children';
import { layerNumeral } from '../../../i18n/terms/layer-name';

// Backing tint for an object with no sprite/color of its own — the shared fallback from
// anim-config (single source; the 3D poof tint reads the same table).
const OBJECT_COLOR = FALLBACK_TINT;
const OBJECT_ALPHA = 0.5;
const CORNER_RADIUS = 6;


/**
 * Everything about an object that its drawing depends on, as one comparable string.
 *
 * The fields are exactly those `addObjects` reads: change this when that does, or `sync` stops
 * noticing an edit it should redraw. `patchOnly` is in because it decides whether a road is drawn as
 * a trimmed shape at all, and `corners` because it decides which way.
 */
function drawnAs(o: PlacedObject): string {
  return [
    o.catalogId, o.position.x, o.position.y, o.rotation, o.elevation,
    o.icon ?? '', o.color ?? '', o.patchOnly ? 1 : 0, o.corners?.join('') ?? '',
  ].join('|');
}

/** What the layer reads from the view that owns it. */
export interface ObjectLayerDeps {
  /** The map this layer draws: the editor's in the editor, a figure's or a capture's own elsewhere. */
  state(): GridState | null;
  /** Opens the owning renderer's render window. */
  requestRender: () => void;
}

type Size = { w: number; h: number };

/** A rounded box over the whole footprint: an icon's multi-cell backing, or an item's placeholder. */
function footprintBox(size: Size, fill: number, alpha: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  g.beginFill(fill, alpha);
  g.drawRoundedRect(0, 0, size.w * TILE_SIZE, size.h * TILE_SIZE, CORNER_RADIUS);
  g.endFill();
  return g;
}

/** The mark an object of an unknown item shows on its box. */
const UNKNOWN_ITEM_MARK = '?';

export class ObjectLayer {
  public readonly container: PIXI.Container;
  readonly requestRender: () => void;
  private objectMap: Map<string, PIXI.Container> = new Map();
  /** What each drawn object looked like when its sprite was built, by id — see `drawnAs`. `sync`
   *  compares against it, which is the only way that pass can notice an object edited in place. */
  private drawnFrom: Map<string, string> = new Map();
  /** Icon sprites tracked for zoom-driven LOD swaps, keyed by object id: near-1:1 texture
   *  sampling is what keeps icons panel-crisp; a fixed LOD always minifies through trilinear
   *  mip-blends at rest zoom (uniformly soft on hi-res displays). Keyed (not a flat array) so
   *  removeObjects drops an id in O(1) instead of filtering every tracked sprite on the map. */
  private lodSprites: Map<string, { sprite: PIXI.Sprite; url: string; footprintPx: number }> = new Map();
  private hiddenLayers = new Set<number>();
  private showNumbers = false;
  // Elevation labels also honour the number-overlay zoom LOD: below MIN_NUMBER_ZOOM they'd be an
  // illegible blur, so they hide alongside the terrain number raster rather than tracking only the
  // show-layer-numbers toggle.
  private numberZoomOk = true;
  private pendingPlop = new Set<string>();
  /** Print buckets keyed `elevation:coating layer`. */
  private printChunks = new Map<string, ChunkGrid>();
  /** One sub-container per elevation, so a layer can fade as a unit. Inside each,
   *  wrappers live in culled chunk buckets (ChunkGrid) so an off-screen chunk's whole subtree
   *  is skipped per frame — pan/zoom cost tracks the objects on screen, not the map total. */
  private layerContainers = new Map<number, PIXI.Container>();
  /** Per elevation, the coatings (road surfaces and prints) under every solid object, ordered by
   *  zIndex = `coatingLayer`, the key 3D's `renderOrder` reads, whatever order they were drawn in. */
  private surfaceContainers = new Map<number, PIXI.Container>();
  private layerChunks = new Map<number, ChunkGrid>();
  private layerFadeAnim = new Map<number, number>();
  private lastCullRect: CullRect | null = null;
  /** Deferred elevation-label geometry per object — the Text is built lazily, only while
   *  numbers are shown (an always-allocated Text per object is a rasterized texture each,
   *  pure texture memory + node count on a full map). */
  private labelMeta = new Map<string, { text: string; y: number }>();

  /** The road surfaces this layer's road tiles draw as. */
  private readonly roads = new RoadSurfaces({
    container: () => this.container,
    requestRender: () => this.requestRender(),
    surfaceContainerFor: (elev) => this.surfaceContainerFor(elev),
    state: () => this.deps.state(),
  });

  constructor(private readonly deps: ObjectLayerDeps) {
    this.requestRender = deps.requestRender;
    this.container = new PIXI.Container();
    this.container.sortableChildren = true; // layer containers sort by zIndex = elevation
  }

  /** Rebuild the road surfaces now (captures call this; everything else goes through the
   *  scheduler). */
  flushRoadRegions(): void {
    this.roads.flush();
  }

  /** The per-elevation sub-container for `elev`, created (z-ordered, and honoring
   *  the current hidden set) on first use. */
  private layerContainerFor(elev: number): PIXI.Container {
    let lc = this.layerContainers.get(elev);
    if (!lc) {
      lc = new PIXI.Container();
      lc.zIndex = elev; // higher elevations render on top
      if (this.hiddenLayers.has(elev)) { lc.visible = false; lc.alpha = 0; }
      const surfaces = new PIXI.Container();
      surfaces.sortableChildren = true;
      lc.addChild(surfaces);
      this.surfaceContainers.set(elev, surfaces);
      this.layerContainers.set(elev, lc);
      this.container.addChild(lc);
    }
    return lc;
  }

  /** The coatings container at the bottom of `elev`'s container; a child sets its `zIndex` to its
   *  coating layer. */
  private surfaceContainerFor(elev: number): PIXI.Container {
    this.layerContainerFor(elev);
    return this.surfaceContainers.get(elev)!;
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
    for (const grid of this.printChunks.values()) grid.cull(rect);
    // Newly visible chunks may hold objects whose labels were deferred.
    if (this.labelsVisible()) this.buildVisibleLabels();
  }

  /** Whether elevation labels should currently show: the toggle is on and we're zoomed in enough
   *  for them to be legible (mirrors the terrain number raster's MIN_NUMBER_ZOOM gate). */
  private labelsVisible(): boolean {
    return this.showNumbers && this.numberZoomOk;
  }

  /** Re-apply the current visibility to every built `_elev` label (a ramp carries two — its high
   *  and low elevation numbers — so toggle all matching children, not just the first). */
  private applyLabelVisibility(): void {
    const vis = this.labelsVisible();
    for (const wrapper of this.objectMap.values()) {
      for (const child of wrapper.children) if (child.name === OBJECT_CHILD.elevation) child.visible = vis;
    }
  }

  setShowNumbers(show: boolean): void {
    if (show === this.showNumbers) return;
    this.showNumbers = show;
    this.requestRender();
    this.applyLabelVisibility();
    // Labels that never existed build lazily, visible chunks only: rasterizing a
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
    this.requestRender();
    this.applyLabelVisibility();
    if (this.labelsVisible()) this.buildVisibleLabels();
  }

  /** Ids whose wrapper already carries its elevation label. */
  private labelBuilt = new Set<string>();

  /** Wrappers of objects too large for chunk bucketing (see addObjects) — they
   *  live unculled in their per-elevation container, so label building must
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
    this.requestRender();
  }

  private makeElevLabel(text: string, y: number): PIXI.Text {
    const numLabel = new PIXI.Text(text, {
      fontSize: 14,
      fontWeight: 'bold',
      fontFamily: APP_FONT_FAMILY,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
    });
    numLabel.name = OBJECT_CHILD.elevation;
    numLabel.x = 3;
    numLabel.y = y;
    numLabel.anchor.set(0, 1);
    numLabel.visible = this.labelsVisible();
    return numLabel;
  }

  setLayerVisibility(visibility: Record<number, boolean>): void {
    this.requestRender();
    this.hiddenLayers = hiddenSetFrom(visibility);
    // Fade each per-elevation container as a unit (one fade per layer, never
    // per-object). Reduced motion snaps instantly.
    for (const [elev, lc] of this.layerContainers) {
      fadeLayer(lc, elev, !this.hiddenLayers.has(elev), this.layerFadeAnim, this.requestRender);
    }
  }

  /** Synchronous capture preserves in-flight fades without advancing or cancelling them. */
  withAllLayersVisible<T>(capture: () => T): T {
    const previous = [...this.layerContainers.values()].map(layer => ({ layer, visible: layer.visible, alpha: layer.alpha }));
    try {
      for (const { layer } of previous) { layer.visible = true; layer.alpha = 1; }
      return capture();
    } finally {
      for (const { layer, visible, alpha } of previous) { layer.visible = visible; layer.alpha = alpha; }
    }
  }

  /** The zoom×resolution (and icon-LOD cache version) the LOD sprites were last settled
   *  at; −1 forces the next updateLod to run (async icon decodes swap cache entries under
   *  us — see iconLodVersion). */
  private lastLodScale = -1;
  private lastLodVersion = -1;
  /** Sprites added since the last settle — fresh sprites carry an oversized default texture,
   *  so the next updateLod settles just these: a placement costs O(new sprites), and a full
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
    for (const e of this.lodSprites.values()) this.settleLod(e, scale);
  }

  /**
   * Reconcile the layer with the full set of placed objects: drop what is gone, add what is new,
   * and redraw what changed under an id it already holds.
   *
   * That last case is why this compares `drawnAs` rather than only the id set. A road's corner cut
   * edits its object in place (same id, new corners, rotation and patchOnly), so a pass that asks only
   * "which ids exist" agrees with state and leaves the stale sprite standing.
   */
  sync(objects: Map<string, PlacedObject>): void {
    // Every ordinary removal path (removeObjects, below) drops its own id from this map already;
    // this bulk pass catches an id that left objectMap some other way (see animateRemove, which
    // detaches from objectMap immediately but destroys the sprite later). sync() runs only at bulk
    // moments (load/undo/generate), never per stroke.
    for (const [id, e] of this.lodSprites) if (e.sprite.destroyed) this.lodSprites.delete(id);
    this.requestRender();
    const toRemove: string[] = [];
    for (const id of this.objectMap.keys()) {
      if (!objects.has(id)) {
        toRemove.push(id);
      }
    }
    this.removeObjects(toRemove);

    const toAdd: PlacedObject[] = [];
    for (const [id, obj] of objects) {
      // Never drawn, or drawn from something this object no longer is. `addObjects` replaces an id
      // it already holds, so a redraw needs no removal first.
      if (!this.objectMap.has(id) || this.drawnFrom.get(id) !== drawnAs(obj)) {
        toAdd.push(obj);
      }
    }
    this.addObjects(toAdd);
    this.roads.schedule();
  }

  /**
   * Draw the given objects: the item's icon sprite where it has one, else a coloured rounded rect
   * carrying the first three characters of its catalog id (a road draws as its surface region).
   */
  addObjects(objects: PlacedObject[]): void {
    const gridState = this.deps.state();
    for (const obj of objects) {
      if (this.objectMap.has(obj.id)) this.removeObjects([obj.id]); // idempotent: re-adding an id replaces, never orphans the old sprite
      const item = getCatalogItem(obj.catalogId);
      const size = getPlacedObjectSize(obj);
      // The live surface, not the one the placement recorded: raise the ground under a road and the
      // stored number is the height the ground used to have (`objectElevation`).
      const elev = gridState ? objectElevation(gridState, obj) : obj.elevation;
      // A surface print's art: drawn as a decal and bucketed apart from the solid objects.
      const print = isSurfacePrint(item) ? item?.surfacePrint : undefined;

      const wrapper = new PIXI.Container();
      wrapper.name = obj.id;
      if (print) this.drawPrint(wrapper, obj, print, size);
      else if (isRamp(item) && item) drawRamp(wrapper, obj, item, size, { showNumbers: this.labelsVisible(), requestRender: this.requestRender });
      else {
        this.drawBody(wrapper, obj, item, size);
        this.drawElevationLabel(wrapper, obj.id, elev, size);
      }
      wrapper.x = obj.position.x * TILE_SIZE;
      wrapper.y = obj.position.y * TILE_SIZE;

      this.objectMap.set(obj.id, wrapper);
      this.drawnFrom.set(obj.id, drawnAs(obj));
      this.mount(wrapper, elev, size, print ? coatingLayer(item) : undefined);
      // A deliberately point-placed object plops (squash + dust puff) the instant its wrapper
      // exists. Bulk adds never request a plop.
      if (this.pendingPlop.delete(obj.id)) this.playPlop(obj, item, size);
    }
    if (objects.some((o) => this.roads.ids.has(o.id))) this.roads.schedule();
  }

  /** A surface print: its art stretched over the footprint and turned with the object. */
  private drawPrint(wrapper: PIXI.Container, obj: PlacedObject, art: NonNullable<CatalogEntry['surfacePrint']>, size: Size): void {
    const sprite = new PIXI.Sprite(materialTexture(art, this.requestRender));
    sprite.anchor.set(0.5);
    sprite.position.set(size.w * TILE_SIZE / 2, size.h * TILE_SIZE / 2);
    sprite.width = size.w * TILE_SIZE; sprite.height = size.h * TILE_SIZE;
    sprite.rotation = obj.rotation * Math.PI / 180;
    wrapper.addChild(sprite);
  }

  /** An object's body: its icon over the footprint, or without art a placeholder box and label (a
   *  road has neither: its region draws it). */
  private drawBody(wrapper: PIXI.Container, obj: PlacedObject, item: CatalogEntry | undefined, size: Size): void {
    // Self-described off-catalog objects (landmarks) carry their own colour; catalog objects use
    // item.color. This lets a landmark render through the normal object path.
    const bgColor = obj.color ?? item?.color;
    const fill = bgColor ? hexStringToNumber(bgColor) : OBJECT_COLOR;
    const alpha = bgColor ? 0.85 : OBJECT_ALPHA;
    const spriteUrl = objectSpriteUrl(obj, item);
    if (spriteUrl) {
      // Non-1x1 footprints keep their background box (so the multi-cell extent stays visible) even
      // when an icon sits on top; 1x1 items show the icon alone.
      if (size.w > 1 || size.h > 1) wrapper.addChild(footprintBox(size, fill, alpha));
      this.drawIcon(wrapper, obj, item, size, spriteUrl);
      return;
    }
    if (isCoatingItem(item)) {
      // A road's surface is drawn by its region (`RoadSurfaces`): the connected same-material run
      // feathers as one whole, so no per-tile geometry exists to draw here. The wrapper stays for
      // what is per-tile: the elevation label, and the in-flight body a group tween lends it.
      this.roads.ids.add(obj.id);
    } else {
      wrapper.addChild(footprintBox(size, fill, alpha));
    }
    // Every catalog item has a sprite or a colour, so this is an object whose item the catalog does
    // not know (a save from a newer catalog): its box carries a question mark, never its raw id.
    if (!item?.color) {
      const label = new PIXI.Text(UNKNOWN_ITEM_MARK, {
        fontSize: Math.min(size.w, size.h) * TILE_SIZE * 0.6,
        fontFamily: APP_FONT_FAMILY,
      });
      label.anchor.set(0.5);
      label.x = (size.w * TILE_SIZE) / 2;
      label.y = (size.h * TILE_SIZE) / 2;
      label.rotation = (obj.rotation * Math.PI) / 180;
      wrapper.addChild(label);
    }
  }

  /**
   * The item's icon, fitted within the footprint by its actual texture dimensions (icons vary:
   * 256x256 plants, 700x400 bridges) and scaled on load if the image has not decoded yet. The LOD
   * budget is in device px: footprint x renderer resolution (the DPR cap) x4 zoom-in headroom. The
   * resolution must be in it: a world-px budget would upscale at zoom > 1, leaving the map icon
   * blurry while the same icon is crisp as a DOM <img> in the placement panel.
   */
  private drawIcon(wrapper: PIXI.Container, obj: PlacedObject, item: CatalogEntry | undefined, size: Size, url: string): void {
    const fw = size.w * TILE_SIZE;
    const fh = size.h * TILE_SIZE;
    const tex = getIconTexture(url, Math.max(size.w, size.h) * TILE_SIZE * maxRenderScale() * 4);
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.x = fw / 2;
    sprite.y = fh / 2;
    sprite.rotation = spriteTurns(item) ? (obj.rotation * Math.PI) / 180 : 0;
    // animateRotation tweens this; a footprint-turning item's art rests upright and spins in only as it turns.
    if (item && (item.rotatable || hasTrait(item, 'footprintTurn'))) sprite.name = OBJECT_CHILD.icon;
    // Self-described objects (landmarks) carry a filled platform image: contain it within the
    // footprint (no 1.1 overflow) so the icon stays inside its grey backing box.
    const spriteFill = obj.icon ? 1 : itemSpriteFill(item);
    fitSpriteToTexture(sprite, tex, footprintFit(fw, fh, spriteFill), false, this.requestRender);
    const lodEntry = { sprite, url, footprintPx: Math.max(fw, fh) };
    this.lodSprites.set(obj.id, lodEntry);
    this.pendingLod.push(lodEntry); // starts on the oversized default; the next updateLod settles it (O(new))
    wrapper.addChild(sprite);
  }

  /** The elevation label: geometry recorded now, the Text built only while numbers are shown (see
   *  labelMeta: a Text per object is a rasterized texture each). */
  private drawElevationLabel(wrapper: PIXI.Container, id: string, elev: number, size: Size): void {
    const text = layerNumeral(elev);
    this.labelMeta.set(id, { text, y: size.h * TILE_SIZE - 3 });
    if (!this.labelsVisible()) return;
    wrapper.addChild(this.makeElevLabel(text, size.h * TILE_SIZE - 3));
    this.labelBuilt.add(id);
  }

  /**
   * Into its chunk bucket inside the per-elevation container (which carries this layer's
   * visibility and alpha), so layer fades stay one operation and off-screen chunks cull. Chunks are
   * bucketed by the anchor cell with a CULL_MARGIN_PX overscan for spill; an object that spills
   * further (a landmark's footprint) can be on screen while its anchor chunk is culled, so it skips
   * the buckets and never culls (it still fades with its elevation container; a map holds at most a
   * handful of such giants). A print (`printLayer`, its coating layer) keeps its own buckets among
   * the coatings, under the solid objects and over the pavement of a lower coating layer.
   */
  private mount(wrapper: PIXI.Container, elev: number, size: Size, printLayer?: number): void {
    if (printLayer !== undefined) {
      const key = `${elev}:${printLayer}`;
      let grid = this.printChunks.get(key);
      if (!grid) {
        const prints = new PIXI.Container();
        prints.zIndex = printLayer;
        this.surfaceContainerFor(elev).addChild(prints);
        grid = new ChunkGrid(prints);
        if (this.lastCullRect) grid.cull(this.lastCullRect);
        this.printChunks.set(key, grid);
      }
      grid.bucketFor(wrapper.x, wrapper.y).addChild(wrapper);
    } else if (Math.max(size.w, size.h) * TILE_SIZE > CULL_MARGIN_PX) {
      this.layerContainerFor(elev).addChild(wrapper);
      this.unculledWrappers.add(wrapper);
    } else {
      this.bucketFor(elev, wrapper.x, wrapper.y).addChild(wrapper);
    }
  }

  /** The placement plop: a squash, and dust in the icon's own hue (the warm default until the
   *  texture decodes) kicked up across the footprint's base and drawn under the icon. Bigger
   *  objects scale the travel by their extent and add a few particles so the spread stays full. */
  private playPlop(obj: PlacedObject, item: CatalogEntry | undefined, size: Size): void {
    this.animateSquash(obj.id, Math.max(size.w, size.h));
    const place = animConfig.puff.place;
    const placeUrl = item?.icon ? iconUrl(item.icon) : undefined;
    const placeColor = (placeUrl ? iconColor(placeUrl) : null) ?? place.color;
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
      this.requestRender,
    );
  }

  /**
   * Remove and destroy the visuals for the given object IDs.
   */
  removeObjects(ids: string[]): void {
    for (const id of ids) {
      if (this.roads.ids.delete(id)) this.roads.schedule();
      const wrapper = this.objectMap.get(id);
      if (wrapper) {
        this.unculledWrappers.delete(wrapper);
        wrapper.parent?.removeChild(wrapper); // parent: its chunk bucket, or the elevation container for unculled giants
        wrapper.destroy({ children: true });
        this.objectMap.delete(id);
      }
      this.drawnFrom.delete(id);
      this.labelMeta.delete(id);
      this.labelBuilt.delete(id);
      // O(1) by key: removal must never cost a walk over every sprite on the map,
      // since a trim stroke removes and re-adds coatings several times per dab.
      this.lodSprites.delete(id);
    }
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
    animateSquash(this.objectMap, objectId, sizeCells, this.requestRender);
  }

  /** Delegates to object-animations.ts animateRotation — see there for the design notes. */
  animateRotation(id: string, fromDeg: number, toDeg: number, onFrame?: (eased: number) => void): void {
    animateRotation(this.objectMap, id, { fromDeg, toDeg }, this.requestRender, onFrame);
  }

  /** Delegates to object-animations.ts animateGroupRotation — see there for the design notes.
   *  Road members need a body to fly: a surface cannot stretch between members on different arcs,
   *  so their surfaces draw as `shared/road/flight.ts` describes, the same split the 3D mesher makes. Each
   *  carried road's wrapper wears its one-tile surfaces for the sweep; landing rebuilds the surfaces
   *  at rest. */
  animateGroupRotation(turn: GroupRotation, onFrame?: (eased: number) => void): void {
    const roadMembers = turn.members.filter((m) => this.roads.ids.has(m.id));
    if (roadMembers.length === 0 || isMotionReduced()) {
      animateGroupRotation(this.objectMap, turn, this.requestRender, onFrame);
      return;
    }
    const gridState = this.deps.state();
    const roads = gridState ? roadLookup(gridState) : null;
    for (const m of roadMembers) this.roads.inFlight.add(m.id);
    // The standing parts replace the carried surfaces before the first frame of the sweep.
    this.flushRoadRegions();
    const flightGfx: PIXI.Graphics[] = [];
    for (const m of roadMembers) {
      const wrapper = this.objectMap.get(m.id);
      const obj = gridState?.objects.get(m.id);
      if (!wrapper || !obj || !roads) continue;
      const g = this.roads.carriedBody(obj, roads);
      // Surfaces are drawn in world px; the wrapper stands at the tile's corner.
      g.position.set(-obj.position.x * TILE_SIZE, -obj.position.y * TILE_SIZE);
      wrapper.addChildAt(g, 0);
      flightGfx.push(g);
    }
    animateGroupRotation(this.objectMap, turn, this.requestRender, (eased) => {
      onFrame?.(eased);
      if (eased !== 1) return;
      for (const g of flightGfx) { g.parent?.removeChild(g); g.destroy(); }
      for (const m of roadMembers) this.roads.inFlight.delete(m.id);
      // Nothing moved since the tween began: the rebuild keeps every region and redraws only the landed surfaces.
      this.roads.schedule();
    });
  }

  /** Delegates to object-animations.ts animateRemove — see there for the design notes.
   *  Must be called before the RemoveObject command executes, while the wrapper still exists. */
  animateRemove(id: string): void {
    animateRemove(this.objectMap, this.container, id, this.deps.state()?.objects.get(id), this.requestRender);
  }
}
