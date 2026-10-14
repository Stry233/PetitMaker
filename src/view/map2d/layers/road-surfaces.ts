/**
 * The 2D road surfaces: one drawing per connected road region, rebuilt once per frame from the
 * shared region cache, under every object of its elevation. A group sweep carries its road members
 * as per-tile flight bodies while the rest of each surface stands.
 */
import * as PIXI from 'pixi.js-legacy';
import type { GridState, PlacedObject } from '../../../core/model/types';
import type { RoadLookup } from '../../../core/model/road-lookup';
import type { RoadMaterialSpec } from '../../../config/catalog/road-material';
import { hexStringToNumber } from '../../../core/base/color';
import { getCatalogItem } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { objectElevation } from '../../../state/object-geometry';
import { iconUrl } from '../../../assets/icon-urls';
import type { RoadRegion } from '../../shared/road/region';
import { RoadRegionCache, roadSurfaceTiles } from '../../shared/road/region-cache';
import { roadBandLayout, roadMaterialReady, type RoadBandWindow } from '../../shared/road/material';
import { RoadBuildCache } from '../../shared/road/build-cache';
import { carriedRoadSurfaces, standingRoadSurfaces } from '../../shared/road/flight';
import { FALLBACK_TINT } from '../../shared/icon/item-tint';
import { drawBandWindow, drawRegion, fadeQuadsByWindow, roadFillTexture } from '../draw/road-surface';

/** What the surfaces need from the object layer that holds them. */
export interface RoadSurfaceHost {
  /** The layer's root, destroyed with the world it stands in. */
  container(): PIXI.Container;
  requestRender(): void;
  /** The per-elevation container a surface draws at the bottom of. */
  layerContainerFor(elev: number): PIXI.Container;
  /** The map the layer draws. */
  state(): GridState | null;
}

export class RoadSurfaces {
  /** The drawn road surfaces, one Graphics per region, keyed by the region's content (members,
   *  corners, cells) so an unchanged surface is never redrawn. Region graphics sit at index 0 of
   *  their elevation container — under every wrapper, since nothing stands under a coating —
   *  and skip chunk bucketing (a surface spans chunks; a handful of Graphics needs no cull). */
  private regionGfx = new Map<string, {
    g: PIXI.Container; members: Set<string>; material: string;
    /** Band window keys drawn by `windowGfx` children; absent for an unbanded draw. */
    windows?: string[];
    /** Drawn in the swatch colour while the material's bands were unavailable. */
    unbanded?: boolean;
  }>();
  /** One Graphics per band window, reused by every region drawing that window. An edit redraws
   *  and re-triangulates only the windows whose pieces it changed. */
  private windowGfx = new RoadBuildCache<PIXI.Graphics>((g) => {
    if (g.destroyed) return;
    g.parent?.removeChild(g);
    g.destroy();
  });
  /** The road tile ids the layer draws as surfaces. */
  readonly ids = new Set<string>();
  private refreshQueued = false;
  /** The last flush's regions, re-derived only near the road tiles that changed since. */
  private regions = new RoadRegionCache();
  /** Road member ids currently carried by a group tween: their regions stay hidden and their
   *  wrappers wear per-tile flight bodies until the tween lands. */
  readonly inFlight = new Set<string>();

  constructor(private readonly host: RoadSurfaceHost) {}

  private repaint = (): void => this.host.requestRender();

  /** Queue a road-surface rebuild, coalesced to one per frame; a stroke announces several
   *  objects per command and every one lands here. */
  schedule(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => this.flush());
    this.host.requestRender();
  }

  /** Rebuild the road surfaces now. Unchanged regions keep their Graphics; changed ones redraw;
   *  gone ones drop. */
  flush(): void {
    this.refreshQueued = false;
    // A capture flushes synchronously and throws its world away; the frame its sync had queued
    // still arrives, with nothing left to draw into (`repaintMaterial` guards the same way).
    if (this.host.container().destroyed) return;
    const gridState = this.host.state();
    if (!gridState) return;
    const roads = roadLookup(gridState);
    const regions = this.regions.regionsFor(gridState, roadSurfaceTiles(gridState), roads);
    const carried = (id: string): boolean => this.inFlight.has(id);
    // While a group tween carries members, their surfaces draw as `shared/road/flight.ts` describes.
    const drawn = this.inFlight.size === 0 ? regions : regions.flatMap((region) =>
      region.members.some((m) => carried(m.id)) ? standingRoadSurfaces(region, carried, roads) : [region]);
    const seen = new Set<string>();
    for (const region of drawn) {
      const key = region.signature;
      seen.add(key);
      const existing = this.regionGfx.get(key);
      if (existing) {
        for (const window of existing.windows ?? []) this.windowGfx.touch(window);
        continue;
      }
      const spec = getCatalogItem(region.material)?.roadMaterial;
      const entry = spec && roadMaterialReady(this.onBandsReady)
        ? this.drawBandedRegion(region, spec)
        : { g: this.drawUnbandedRegion(region), unbanded: !!spec };
      const elev = objectElevation(gridState, region.members[0]!);
      this.host.layerContainerFor(elev).addChildAt(entry.g, 0);
      this.regionGfx.set(key, { ...entry, members: new Set(region.members.map((m) => m.id)), material: region.material });
    }
    for (const key of [...this.regionGfx.keys()]) {
      if (!seen.has(key)) this.dropRegion(key);
    }
    this.windowGfx.finish();
    this.host.requestRender();
  }

  /** A banded surface as one container of band-window Graphics, drawing only the windows no
   *  earlier build left behind. */
  private drawBandedRegion(region: RoadRegion, spec: RoadMaterialSpec): { g: PIXI.Container; windows: string[] } {
    const layout = roadBandLayout(region, spec);
    const node = new PIXI.Container();
    let fade: Map<RoadBandWindow, number[][][]> | null = null;
    const missing = layout.windows.filter((w) => !this.windowGfx.has(w.key));
    for (const window of layout.windows) {
      node.addChild(this.windowGfx.get(window.key, () => {
        fade ??= fadeQuadsByWindow(region, spec, layout, missing);
        const g = new PIXI.Graphics();
        drawBandWindow(g, spec, { fade: fade.get(window), patches: window.patches() }, 1, this.repaint);
        return g;
      }));
    }
    return { g: node, windows: layout.windows.map((w) => w.key) };
  }

  /** A surface drawn whole: a path's tile art or colour, or an authored material's swatch colour
   *  until its bands are available. */
  drawUnbandedRegion(region: RoadRegion, g = new PIXI.Graphics()): PIXI.Graphics {
    const item = getCatalogItem(region.material);
    const color = item?.color ? hexStringToNumber(item.color)
      : item?.roadMaterial ? hexStringToNumber(item.roadMaterial.edge.color) : FALLBACK_TINT;
    const material = region.material;
    // A path surface fills with its own tile art; the colour is the fill until that art has
    // decoded, and stays the fill for a surface that carries no art at all.
    const tileUrl = item?.icon && !item.roadMaterial ? iconUrl(item.icon) : undefined;
    const texture = tileUrl ? roadFillTexture(tileUrl, () => this.repaintMaterial(material)) : undefined;
    drawRegion(g, region, { color, alpha: 0.85, texture, feather: item?.roadMaterial?.feather });
    return g;
  }

  /** The clipper has arrived: surfaces drawn in their swatch colour redraw with their bands. */
  private onBandsReady = (): void => {
    if (this.host.container().destroyed) return;
    for (const [key, entry] of this.regionGfx) if (entry.unbanded) this.dropRegion(key);
    this.schedule();
  };

  /**
   * Forget one drawn surface, destroying its Graphics unless something else already has.
   *
   * A teardown destroys the nodes from above — the renderer's `app.destroy(false, { children: true
   * })`, a finished capture's `world.destroy({ children: true })` — and leaves this map holding
   * destroyed Graphics. Pixi's second destroy dereferences a geometry the first one nulled, and
   * this drop can run from a texture-arrival callback, where a throw would take every later
   * subscriber on that url down with it.
   */
  private dropRegion(key: string): void {
    const entry = this.regionGfx.get(key);
    if (!entry) return;
    if (!entry.g.destroyed) {
      // Band windows belong to `windowGfx`, which keeps them for the next build or destroys them.
      if (entry.windows) entry.g.removeChildren();
      entry.g.parent?.removeChild(entry.g);
      entry.g.destroy();
    }
    this.regionGfx.delete(key);
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
    if (this.host.container().destroyed) return;
    for (const [key, entry] of this.regionGfx) {
      if (entry.material === material) this.dropRegion(key);
    }
    // The texture arrived; the geometry did not move, so the rebuild keeps every region and only
    // redraws the Graphics dropped above.
    this.schedule();
  }

  /** A carried road tile's flight body for a group sweep, in world px. */
  carriedBody(obj: PlacedObject, roads: RoadLookup): PIXI.Graphics {
    const g = new PIXI.Graphics();
    for (const surface of carriedRoadSurfaces(obj, roads)) {
      const spec = getCatalogItem(surface.material)?.roadMaterial;
      if (spec && roadMaterialReady()) {
        const layout = roadBandLayout(surface, spec);
        const fade = fadeQuadsByWindow(surface, spec, layout);
        for (const window of layout.windows) drawBandWindow(g, spec, { fade: fade.get(window), patches: window.patches() }, 1, this.repaint);
      } else this.drawUnbandedRegion(surface, g);
    }
    return g;
  }
}
