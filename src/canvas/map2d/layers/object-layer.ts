import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { maxRenderScale } from '../../../core/runtime/device-quality';
import { TILE_SIZE } from '../../../core/model/constants';
import type { GridState, PlacedObject, CatalogItem } from '../../../core/model/types';
import { ItemCategory } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { hasTrait } from '../../../core/model/traits';
import { ROAD_FEATHER, roadBodyPoints, roadCutFeeds, type RoadPt } from '../../../core/edge-cut/road-shape';
import { updateRoadRegions, type RoadRegion } from '../../../core/edge-cut/road-region';
import { roadLookup } from '../../../state/object-index';
import { isMotionReduced } from '../motion-state';
import { objectElevation, getPlacedObjectSize } from '../../../state/object-geometry';
import { hexStringToNumber } from '../../../core/model/colors';
import { useEditorStore } from '../../../state/store';
import { iconUrl } from '../../../assets/icon-urls';
import { animConfig } from '../../../core/runtime/anim-config';
import { requestRender } from '../render-scheduler';
import { roadTileCanvas, ROAD_TEXTURE_SIZE } from '../../road-tile-texture';
import { spawnPuff } from '../draw/particles';
import { getIconTexture, iconColor, iconLodVersion } from '../draw/icon-color';
import { fitSpriteToTexture, footprintFit, SPRITE_FILL } from '../draw/sprite-fit';
import { drawRamp } from '../draw/ramp-graphic';
import { isRampItem, objectSpriteUrl } from '../object-sprite-url';

export { objectSpriteUrl } from '../object-sprite-url';
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


/**
 * Does this item's icon turn with the object's rotation?
 *
 * A rotatable item turns because the user turned it. A SPANNING one turns because the placement
 * turned it: a bridge cannot be rotated by hand, but it lies along the gap it crosses, and an icon
 * left lying east-west over a deck running north-south describes a bridge the map does not have.
 */
function spriteTurns(item: CatalogItem | undefined): boolean {
  return !!item && (item.rotatable || hasTrait(item, 'waterSpan'));
}

/**
 * The sprite an object draws with, or nothing where it draws as a shape.
 *
 * A self-described object (the plaza) names its own; a ramp wears its item's icon as a badge on the
 * drawn wedge; everything else wears it as the object itself, unless the item is colour-only (a
 * road), which is drawn rather than pictured. Exported because a caller that must have the art
 * DECODED before it draws — a capture of a map nobody is looking at, which cannot wait for a
 * texture to arrive and re-draw — has to ask the same question this layer answers.
 */
/** Feather steps: the fade is drawn as this many stepped alpha bands between the outline and the
 *  fully-opaque core. At ROAD_FEATHER of a 64px tile each band is ~1.3px — the steps disappear
 *  into the gradient at rest zoom, straight edges and the fans' concentric arcs alike. */
const FEATHER_STEPS = 12;

/** One texture per path material, keyed by icon url. A fill REFERENCES its texture rather than
 *  copying it, so a per-region texture would upload the same canvas once per surface on the map. */
const roadFillTextures = new Map<string, PIXI.Texture>();

/**
 * The repeating fill for a path material's tile art, or nothing while that art is still decoding —
 * `onReady` fires once it lands, and is where the surfaces already drawn get their redraw.
 */
function roadFillTexture(url: string, onReady: () => void): PIXI.Texture | undefined {
  const hit = roadFillTextures.get(url);
  if (hit) return hit;
  const canvas = roadTileCanvas(url, onReady);
  if (!canvas) return undefined;
  const tex = PIXI.Texture.from(canvas);
  // The fill must TILE, and the crop is power-of-two, which is what makes REPEAT legal on WebGL1
  // (an npot texture wraps to black there). Set at creation, so it holds from the first fill on.
  tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
  roadFillTextures.set(url, tex);
  return tex;
}

/** Texture space → world px: the 128px tile art covers exactly one macro block. Region points are
 *  world px and a region's Graphics sits at the world origin, so the pattern is anchored to the
 *  GRID — two surfaces of one material can never disagree on phase where they meet. Shared: Pixi
 *  clones this on `beginTextureFill`. */
const ROAD_FILL_MATRIX = new PIXI.Matrix(
  TILE_SIZE / ROAD_TEXTURE_SIZE, 0, 0, TILE_SIZE / ROAD_TEXTURE_SIZE, 0, 0,
);

/**
 * One connected road SURFACE, feathered as a whole (core/edge-cut/road-region — the same
 * derivation the 3D mesher blends with vertex colours): each band is one closed contour with the
 * next contour as its hole, so no radial edge exists anywhere for anti-aliasing to trace — band
 * seams only ever follow the outline. A region's boundary fades EVERYWHERE (interior cell lines
 * are cancelled out of it), so a band's hole never touches its outer path and the triangulation
 * stays sound. Ring signed area tells outer rings (positive, in this y-down frame) from holes.
 *
 * `texture` is the material's tile art where it has any: the GEOMETRY is identical either way —
 * same outlines, same bands, same stepped alpha — only what fills them changes.
 */
function drawRegion(
  g: PIXI.Graphics, region: RoadRegion, color: number, alpha: number, texture?: PIXI.Texture,
): void {
  const fill = (a: number): void => {
    if (texture) g.beginTextureFill({ texture, alpha: a, matrix: ROAD_FILL_MATRIX });
    else g.beginFill(color, a);
  };
  // Each ring sampled once per inset level, scaled to px. The point count is fixed across `t` by
  // construction (road-region.ts), which is what lets a band pair its two rings vertex by vertex.
  const ringSets = region.rings.map((ring) => ({
    levels: Array.from({ length: FEATHER_STEPS + 1 }, (_, i) =>
      ring.points(ROAD_FEATHER * (i / FEATHER_STEPS)).map(([px, py]) => [px * TILE_SIZE, py * TILE_SIZE] as RoadPt)),
    outer: ringArea(ring.points(0)) > 0,
  }));
  // The fade: quad bands between consecutive insets, one strip per ring — outer contours and holes
  // alike, since every vertex's inset direction already points into the surface. A quad is two
  // triangles to the triangulator, where a contour-with-hole polygon at every band re-triangulated
  // the whole surface once per band, and the triangulation is what a paint stroke's per-frame
  // redraw of a large connected network spends nearly all of its time in.
  for (let i = 0; i < FEATHER_STEPS; i++) {
    fill(alpha * ((i + 0.5) / FEATHER_STEPS));
    for (const ring of ringSets) {
      const outer = ring.levels[i]!;
      const inner = ring.levels[i + 1]!;
      for (let k = 0; k < outer.length; k++) {
        const k2 = (k + 1) % outer.length;
        const [a, b, c, d] = [outer[k]!, outer[k2]!, inner[k2]!, inner[k]!];
        if ((a[0] === d[0] && a[1] === d[1]) && (b[0] === c[0] && b[1] === c[1])) continue; // no fade here
        g.drawPolygon([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]);
      }
    }
    g.endFill();
  }
  // The core: the outer contour at full inset with the holes at theirs — the one shape that still
  // needs a real triangulation.
  fill(alpha);
  for (const ring of ringSets) {
    if (!ring.outer) continue;
    g.drawPolygon(ring.levels[FEATHER_STEPS]!.flat());
    g.beginHole();
    for (const hole of ringSets) if (!hole.outer) g.drawPolygon(hole.levels[FEATHER_STEPS]!.flat());
    g.endHole();
  }
  g.endFill();
}

function ringArea(pts: RoadPt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/**
 * A SINGLE tile's body with a feathered outline — the in-flight stand-in a group tween draws into
 * a road's wrapper while its surface region cannot travel (members on different arcs), matching
 * the 3D mesher's per-tile fallback. `outlineAt(t)` is the tile outline inset by `t` cells
 * (road-shape.ts, same point count at every `t`); quad bands, never ring-with-hole paths, because
 * a lone tile's outline has sides that do not fade and a hole sharing an edge with its outer path
 * breaks the triangulation.
 */
function drawFeathered(
  g: PIXI.Graphics, outlineAt: (t: number) => RoadPt[], color: number, alpha: number,
): void {
  let outer = outlineAt(0);
  for (let i = 0; i < FEATHER_STEPS; i++) {
    const inner = outlineAt(ROAD_FEATHER * ((i + 1) / FEATHER_STEPS));
    g.beginFill(color, alpha * ((i + 0.5) / FEATHER_STEPS));
    for (let k = 0; k < outer.length; k++) {
      const k2 = (k + 1) % outer.length;
      const [a, b, c, d] = [outer[k]!, outer[k2]!, inner[k2]!, inner[k]!];
      if ((a[0] === d[0] && a[1] === d[1]) && (b[0] === c[0] && b[1] === c[1])) continue; // no fade here
      g.drawPolygon([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]);
    }
    g.endFill();
    outer = inner;
  }
  g.beginFill(color, alpha);
  g.drawPolygon(outer.flat());
  g.endFill();
}

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

export class ObjectLayer {
  public readonly container: PIXI.Container;
  /** Opens the owning renderer's render window; MapRenderer rebinds it to itself right after
   *  construction. Defaults to the module broadcast, for an instance nobody has wired yet. */
  public requestRender: () => void = requestRender;
  private objectMap: Map<string, PIXI.Container> = new Map();
  /** What each drawn object looked like when its sprite was built, by id — see `drawnAs`. `sync`
   *  compares against it, which is the only way that pass can notice an object EDITED IN PLACE. */
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

  /** The drawn road surfaces, one Graphics per region, keyed by the region's content (members,
   *  corners, cells) so an unchanged surface is never redrawn. Region graphics sit at index 0 of
   *  their elevation container — under every wrapper, since nothing stands under a coating —
   *  and skip chunk bucketing (a surface spans chunks; a handful of Graphics needs no cull). */
  private roadRegionGfx = new Map<string, { g: PIXI.Graphics; members: Set<string>; material: string }>();
  private roadIds = new Set<string>();
  private roadRefreshQueued = false;
  private roadState: GridState | null = null;
  /** The last flush's regions and the map they describe, for the incremental rebuild: a region no
   *  changed cell can reach survives the next flush whole (`updateRoadRegions`). */
  private lastRoadRegions: RoadRegion[] | null = null;
  private lastRoadRegionsFor: GridState | null = null;
  /** Flat cell indices whose road tile changed since the last flush; null owes a full rebuild. */
  private roadDirty: Set<number> | null = null;
  /** Where each drawn road tile stands, so a removal can name the cell its wrapper no longer knows. */
  private roadCellById = new Map<string, number>();
  /** The map this layer was last synced to. The fallback for every incremental rebuild: a layer
   *  can serve a world that is not the store's (a Help figure's demo world), and reading the
   *  store there rebuilds the roads from a different map than the sprites standing here. */
  private lastSyncState: GridState | null = null;
  /** Road member ids currently carried by a group tween: their regions stay hidden and their
   *  wrappers wear per-tile flight bodies until the tween lands. */
  private roadsInFlight = new Set<string>();

  constructor() {
    this.container = new PIXI.Container();
    this.container.sortableChildren = true; // layer containers sort by zIndex = elevation
  }

  /** Queue a road-surface rebuild, coalesced to one per frame; a stroke announces several
   *  objects per command and every one lands here. */
  private scheduleRoadRefresh(forState?: GridState, dirtyCells?: readonly number[] | null): void {
    this.roadState = forState ?? null; // a capture's foreign state must not outlive its capture
    // Dirty cells accumulate until the flush; a caller that cannot name what changed (null) owes
    // the whole map, and that debt survives any narrower reports queued beside it.
    if (dirtyCells === null || dirtyCells === undefined) this.roadDirty = null;
    else if (this.roadDirty) for (const c of dirtyCells) this.roadDirty.add(c);
    if (this.roadRefreshQueued) return;
    this.roadRefreshQueued = true;
    requestAnimationFrame(() => this.flushRoadRegions());
    this.requestRender();
  }

  /** Rebuild the road surfaces NOW (captures call this; everything else goes through the
   *  scheduler). Unchanged regions keep their Graphics; changed ones redraw; gone ones drop. */
  flushRoadRegions(): void {
    this.roadRefreshQueued = false;
    // A capture flushes synchronously and throws its world away; the frame its sync had queued
    // still arrives, with nothing left to draw into (`repaintMaterial` guards the same way).
    if (this.container.destroyed) return;
    const gridState = this.roadState ?? this.lastSyncState ?? useEditorStore.getState().gridState;
    if (!gridState) return;
    const roadObjs: PlacedObject[] = [];
    for (const obj of gridState.objects.values()) {
      if (getCatalogItem(obj.catalogId)?.category === ItemCategory.Road) roadObjs.push(obj);
    }
    // Incremental against the last flush OF THIS MAP: a capture's foreign state, a map swap, or a
    // caller that could not name its cells all fall back to the full build inside.
    const dirty = this.lastRoadRegionsFor === gridState ? this.roadDirty : null;
    const regions = roadObjs.length > 0
      ? updateRoadRegions(dirty ? this.lastRoadRegions : null, dirty, roadObjs, roadLookup(gridState), gridState.template.width)
      : [];
    this.lastRoadRegions = regions;
    this.lastRoadRegionsFor = gridState;
    this.roadDirty = new Set();
    const seen = new Set<string>();
    for (const region of regions) {
      const key = region.signature;
      seen.add(key);
      const existing = this.roadRegionGfx.get(key);
      const inFlight = region.members.some((m) => this.roadsInFlight.has(m.id));
      if (existing) {
        existing.g.visible = !inFlight;
        continue;
      }
      const item = getCatalogItem(region.material);
      const color = item?.color ? hexStringToNumber(item.color) : OBJECT_COLOR;
      const material = region.material;
      // A path surface fills with its own tile art; the colour is the fill until that art has
      // decoded, and stays the fill for a surface that carries no art at all.
      const tileUrl = item?.icon ? iconUrl(item.icon) : undefined;
      const texture = tileUrl ? roadFillTexture(tileUrl, () => this.repaintMaterial(material)) : undefined;
      const g = new PIXI.Graphics();
      drawRegion(g, region, color, 0.85, texture);
      g.visible = !inFlight;
      const elev = objectElevation(gridState, region.members[0]!);
      this.layerContainerFor(elev).addChildAt(g, 0);
      this.roadRegionGfx.set(key, { g, members: new Set(region.members.map((m) => m.id)), material });
    }
    for (const key of [...this.roadRegionGfx.keys()]) {
      if (!seen.has(key)) this.dropRegion(key);
    }
    this.requestRender();
  }

  /**
   * Forget one drawn surface, destroying its Graphics unless something else already has.
   *
   * A teardown destroys the nodes from ABOVE — the renderer's `app.destroy(false, { children: true
   * })`, a finished capture's `world.destroy({ children: true })` — and leaves this map holding
   * destroyed Graphics. Pixi's second destroy dereferences a geometry the first one nulled, and
   * this drop can run from a texture-arrival callback, where a throw would take every later
   * subscriber on that url down with it.
   */
  private dropRegion(key: string): void {
    const entry = this.roadRegionGfx.get(key);
    if (!entry) return;
    if (!entry.g.destroyed) {
      entry.g.parent?.removeChild(entry.g);
      entry.g.destroy();
    }
    this.roadRegionGfx.delete(key);
  }

  /**
   * Throw away every drawn surface of one material so the next rebuild redraws it.
   *
   * This is how a path's tile art reaches the surfaces already standing: the art loads after the
   * first paint, and a region whose Graphics is cached by signature is otherwise never redrawn
   * (nothing about the map changed — only what we can now draw with). Dropping the entries is the
   * invalidation the rebuild already understands; the scheduler coalesces the redraw to one frame,
   * however many regions and however many arrivals land together.
   */
  private repaintMaterial(material: string): void {
    // Nothing to repaint into: this layer's world was destroyed under it (renderer teardown, or a
    // capture layer whose detached container has been thrown away) while its art was still loading.
    if (this.container.destroyed) return;
    for (const [key, entry] of this.roadRegionGfx) {
      if (entry.material === material) this.dropRegion(key);
    }
    // The texture arrived; the geometry did not move. An empty dirty set keeps every region and
    // only redraws the Graphics dropped above.
    this.scheduleRoadRefresh(undefined, []);
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
    this.requestRender();
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
    this.requestRender();
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
    numLabel.name = '_elev';
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
    for (const e of this.lodSprites.values()) this.settleLod(e, scale);
  }

  /**
   * Reconcile the layer with the full set of placed objects: drop what is gone, add what is new,
   * and REDRAW what changed under an id it already holds.
   *
   * That last case is why this compares `drawnAs` rather than only the id set. A road's corner cut
   * edits its object IN PLACE — same id, new corners/rotation/patchOnly — so a pass that asks only
   * "which ids exist" agrees with state and leaves the stale sprite standing.
   */
  sync(objects: Map<string, PlacedObject>, forState?: GridState): void {
    if (forState) this.lastSyncState = forState;
    // Every ordinary removal path (removeObjects, below) drops its own id from this map already;
    // this bulk pass catches an id that left objectMap some OTHER way (see animateRemove, which
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
    this.addObjects(toAdd, forState);
    // The road surfaces always follow the map THIS sync drew (a capture's foreign state included),
    // not whichever map the per-id passes above happened to touch last.
    this.scheduleRoadRefresh(forState);
  }

  /**
   * Draw the given objects: the item's icon sprite where it has one, else a coloured rounded rect
   * carrying the first three characters of its catalog id (a road draws as its surface region).
   *
   * `forState` is the map these objects belong to, for the questions a placement's drawing asks of
   * its surroundings (the road-surface regions, the live elevation under an object). It defaults to
   * the LIVE map, which is what every editing path wants; a capture of some other map must pass its
   * own or its roads are drawn the way the live map's are.
   */
  addObjects(objects: PlacedObject[], forState?: GridState): void {
    const gridState = forState ?? this.lastSyncState ?? useEditorStore.getState().gridState;
    for (const obj of objects) {
      if (this.objectMap.has(obj.id)) this.removeObjects([obj.id]); // idempotent: re-adding an id replaces, never orphans the old sprite
      const item = getCatalogItem(obj.catalogId);
      const size = getPlacedObjectSize(obj);
      const ramp = isRampItem(item);
      // The LIVE surface, not the one the placement recorded: raise the ground under a road and the
      // stored number is the height the ground used to have (`objectElevation`).
      const elev = gridState ? objectElevation(gridState, obj) : obj.elevation;
      // Resolved backing color: self-described off-catalog objects (the plaza) carry their own color;
      // catalog objects use item.color. This lets the plaza render through the normal object path.
      const bgColor = obj.color ?? item?.color;

      const wrapper = new PIXI.Container();
      wrapper.name = obj.id;

      if (ramp && item) {
        drawRamp(wrapper, obj, item, size, this.labelsVisible(), this.requestRender);
      } else {
        const spriteUrl = objectSpriteUrl(obj, item);

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
          // Rotatable items (buildings, facilities) spin their icon with the placement, and so does
          // anything whose orientation was decided FOR it — see `spriteTurns`.
          sprite.rotation = spriteTurns(item) ? (obj.rotation * Math.PI) / 180 : 0;
          if (item?.rotatable) sprite.name = '_icon'; // animateRotation tweens this
          const fw = size.w * TILE_SIZE;
          const fh = size.h * TILE_SIZE;
          // Self-described objects (the plaza) carry a filled platform image — CONTAIN it within the
          // footprint (no 1.1 overflow) so the icon stays inside its grey backing box.
          const spriteFill = obj.icon ? 1 : SPRITE_FILL;
          fitSpriteToTexture(sprite, tex, footprintFit(fw, fh, spriteFill), false, this.requestRender);
          const lodEntry = { sprite, url: spriteUrl, footprintPx: Math.max(fw, fh) };
          this.lodSprites.set(obj.id, lodEntry);
          this.pendingLod.push(lodEntry); // starts on the oversized default — next updateLod settles it (O(new))
          wrapper.addChild(sprite);
        } else {
          const fillColor = bgColor ? hexStringToNumber(bgColor) : OBJECT_COLOR;
          const fillAlpha = bgColor ? 0.85 : OBJECT_ALPHA;
          if (item?.category === ItemCategory.Road) {
            // A road's SURFACE is drawn by its region (flushRoadRegions): the connected
            // same-material run feathers as one whole, so no per-tile geometry exists to draw
            // here. The wrapper stays for what is per-tile — the elevation label, and the
            // in-flight body a group tween lends it.
            this.roadIds.add(obj.id);
            if (gridState) this.roadCellById.set(obj.id, obj.position.y * gridState.template.width + obj.position.x);
          } else {
            const g = new PIXI.Graphics();
            g.beginFill(fillColor, fillAlpha);
            g.drawRoundedRect(0, 0, size.w * TILE_SIZE, size.h * TILE_SIZE, CORNER_RADIUS);
            g.endFill();
            wrapper.addChild(g);
          }

          if (!item?.color) {
            const fontSize = Math.min(size.w, size.h) * TILE_SIZE * 0.6;
            const label = new PIXI.Text(obj.catalogId.slice(0, 3), {
              fontSize,
              fontFamily: APP_FONT_FAMILY,
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
        this.labelMeta.set(obj.id, { text: String(elev), y: size.h * TILE_SIZE - 3 });
        if (this.labelsVisible()) {
          wrapper.addChild(this.makeElevLabel(String(elev), size.h * TILE_SIZE - 3));
          this.labelBuilt.add(obj.id);
        }
      }

      wrapper.x = obj.position.x * TILE_SIZE;
      wrapper.y = obj.position.y * TILE_SIZE;

      this.objectMap.set(obj.id, wrapper);
      this.drawnFrom.set(obj.id, drawnAs(obj));
      // Into its chunk bucket inside the per-elevation container (which carries this layer's
      // visibility/alpha), so layer fades stay one operation AND off-screen chunks cull.
      // Chunks are bucketed by the ANCHOR cell with a CULL_MARGIN_PX overscan for spill —
      // an object that spills FURTHER (the plaza's 20×27 footprint) can be on screen while
      // its anchor chunk is culled, so it skips the buckets and never culls (still fades
      // with its elevation container; a map holds at most a handful of such giants).
      if (Math.max(size.w, size.h) * TILE_SIZE > CULL_MARGIN_PX) {
        this.layerContainerFor(elev).addChild(wrapper);
        this.unculledWrappers.add(wrapper);
      } else {
        this.bucketFor(elev, wrapper.x, wrapper.y).addChild(wrapper);
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
          this.requestRender,
        );
      }
    }
    const roadCells = objects.filter((o) => this.roadIds.has(o.id))
      .map((o) => this.roadCellById.get(o.id))
      .filter((c): c is number => c !== undefined);
    if (roadCells.length) this.scheduleRoadRefresh(forState, roadCells);
  }

  /**
   * Remove and destroy the visuals for the given object IDs.
   */
  removeObjects(ids: string[]): void {
    for (const id of ids) {
      if (this.roadIds.delete(id)) {
        const cell = this.roadCellById.get(id);
        this.roadCellById.delete(id);
        this.scheduleRoadRefresh(undefined, cell === undefined ? null : [cell]);
      }
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
    animateRotation(this.objectMap, id, fromDeg, toDeg, onFrame, this.requestRender);
  }

  /** Delegates to object-animations.ts animateGroupRotation — see there for the design notes.
   *  Road members need a body to fly: their surface region cannot travel (members ride different
   *  arcs), so each carried road's wrapper wears a per-tile stand-in for the sweep — the same
   *  fallback the 3D mesher makes — while the region graphics hide; landing rebuilds the
   *  surfaces at rest. */
  animateGroupRotation(turn: GroupRotation, onFrame?: (eased: number) => void): void {
    const roadMembers = turn.members.filter((m) => this.roadIds.has(m.id));
    if (roadMembers.length === 0 || isMotionReduced()) {
      animateGroupRotation(this.objectMap, turn, onFrame, this.requestRender);
      return;
    }
    const gridState = useEditorStore.getState().gridState;
    const roads = gridState ? roadLookup(gridState) : null;
    const flightGfx: PIXI.Graphics[] = [];
    for (const m of roadMembers) {
      const wrapper = this.objectMap.get(m.id);
      const obj = gridState?.objects.get(m.id);
      if (!wrapper || !obj || !roads) continue;
      const item = getCatalogItem(obj.catalogId);
      const color = item?.color ? hexStringToNumber(item.color) : OBJECT_COLOR;
      const g = new PIXI.Graphics();
      drawFeathered(g, (t) => roadBodyPoints(roads, obj, 0, 0, TILE_SIZE, TILE_SIZE, t), color, 0.85);
      for (const feed of roadCutFeeds(roads, obj)) {
        const feedColor = getCatalogItem(feed.feeders[0]!.catalogId)?.color;
        drawFeathered(g, (t) => feed.points(0, 0, TILE_SIZE, TILE_SIZE, t), feedColor ? hexStringToNumber(feedColor) : OBJECT_COLOR, 0.85);
      }
      wrapper.addChildAt(g, 0);
      flightGfx.push(g);
      this.roadsInFlight.add(m.id);
    }
    for (const entry of this.roadRegionGfx.values()) {
      if ([...entry.members].some((id) => this.roadsInFlight.has(id))) entry.g.visible = false;
    }
    animateGroupRotation(this.objectMap, turn, (eased) => {
      onFrame?.(eased);
      if (eased !== 1) return;
      for (const g of flightGfx) { g.parent?.removeChild(g); g.destroy(); }
      for (const m of roadMembers) this.roadsInFlight.delete(m.id);
      for (const entry of this.roadRegionGfx.values()) entry.g.visible = true;
      this.scheduleRoadRefresh();
    }, this.requestRender);
  }

  /** Delegates to object-animations.ts animateRemove — see there for the design notes.
   *  Must be called BEFORE the RemoveObject command executes, while the wrapper still exists. */
  animateRemove(id: string): void {
    animateRemove(this.objectMap, this.container, id, this.requestRender);
  }
}
