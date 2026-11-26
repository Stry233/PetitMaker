import * as PIXI from 'pixi.js-legacy';
import { QUADRANT_PX, TILE_SIZE, gridOffsetPx } from '../../geometry/world';
import { getCatalogItem } from '../../../../state/catalog';
import { objectSpritePose } from '../../draw/object-sprite';
import { poseSprite } from '../../draw/sprite-fit';
import { materialTexture } from '../../draw/road-surface';
import { drawRoadShape, drawTrimmedBlock } from '../../draw/trim-shapes';
import { cellsBounds, cellKey } from '../../../../core/grid/rect';
import { TerrainType, type Corners, type GridState, type PlacedObject, type Rotation } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import type { TrimmedCell } from '../../../../tools/trim';
import type { GhostBlock, GhostCell, GhostPrior, GhostGround, GhostPaint, GhostRequest, PlacementGhost, PlacementPaint, PreviewCell, PreviewIcon } from '../../../../tools/pointer/runtime';
import { cellGrid, type CellSet, type GridId, type MixedCellSet } from '../../../../core/grid/grids';
import { edgeInsideSide, GHOST_WASH_ALPHA, ghostOutline, ghostPlan, trimmedOutline } from '../../../shared/overlay/ghost-geometry';
import { boundaryEdges, groupByGrid, mergeCellSpans, spansWithout, type CellSpan, type EdgeSegment, type RowSpan } from '../../../../core/grid/cell-spans';
import { CURVE_FOOTPRINT, boundsOfSpans, hatchBars, isPreviewCell, isSolidRect, previewDots, previewIconRect, previewPalette, PREVIEW_CELL_ART, type PreviewPalette } from '../../../shared/overlay/preview-cell';
import { previewIconCanvas } from '../../../shared/overlay/preview-cell-raster';
import type { OverlayHost } from './host';
import { cellRect, spanRect, type Shift } from './paint';
import { getCell } from '../../../../core/model/grid-model';
import { gridSize } from '../../../../core/grid/grid-convert';
import { GHOST_LOOK, GHOST_LOSS, ghostColor, ghostTint } from '../../../shared/viewport/view-constants';
import { lerpColor } from '../../../../core/base/color';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../../core/game/profile';
import { SQUARE_CORNERS } from '../../../../core/model/corners';
import { getTerrainColor, getZoneColor } from '../../draw/terrain-color';
import { animConfig } from '../../../shared/motion/anim-config';
import { flipScale, groupEase } from '../../../shared/motion/group-arc';
import type { FlipAxes } from '../../../../tools/objects';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { RoadSurfaces } from '../road-surfaces';
import { roadGhost } from '../../../shared/road/region-cache';
import type { RoadLookup } from '../../../../core/model/road-lookup';
import { timedBeat } from '../../../shared/viewport/frame-loop';
import { roadLookup } from '../../../../state/object-index';

/** The parts of a ghost request the drawing below reads, past the `clear` request. */
type DrawnGhost = Exclude<GhostRequest, { kind: 'clear' }>;

/** One texture per glyph, uploaded once: the ghost repaints on every pointer move. */
const iconTextures = new Map<string, PIXI.Texture | null>();

function previewIconTexture(icon: PreviewIcon): PIXI.Texture | null {
  const hit = iconTextures.get(icon);
  if (hit !== undefined) return hit;
  const canvas = previewIconCanvas(icon);
  const tex = canvas ? PIXI.Texture.from(canvas) : null;
  iconTextures.set(icon, tex);
  return tex;
}

/** `r`, in cells of side `scale`, in map cells. */
function scaleRect(r: Rect, scale: number): Rect {
  return scale === 1 ? r : { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
}

/** A placement ghost's body as the object it would place. */
export function ghostObject({ catalogId, x, y, rotation, elevation, spanLength }: PlacementGhost): PlacedObject {
  return { id: '__ghost__', catalogId, position: { x, y }, rotation: rotation as Rotation, elevation, ...(spanLength ? { spanLength } : null) };
}

/** Point a sprite at one object's picture, posed as the object layer poses it (`objectSpritePose`):
 *  the hover-preview ghost, each member of the group drag ghost and a flagged object. Returns false
 *  (and hides `g`) when the object draws no picture (a road, whose surface draws it). `repaint` runs
 *  when the texture loads. */
export function paintItemSprite(g: PIXI.Sprite, obj: PlacedObject, valid: boolean, repaint: () => void): boolean {
  const pose = objectSpritePose(obj, getCatalogItem(obj.catalogId));
  if (!pose) { g.visible = false; return false; }
  const tex = pose.art.kind === 'icon' ? PIXI.Texture.from(pose.art.url) : materialTexture(pose.art.pattern, repaint);
  poseSprite(g, pose, tex, { x: obj.position.x * TILE_SIZE, y: obj.position.y * TILE_SIZE }, repaint);
  g.tint = ghostTint(valid);
  return true;
}

/** Placement ghosts: what a placement lays drawn as itself (terrain blocks, road surface, item
 *  sprites) under its footprint outline, the preview card a tool shows where it acts, and the
 *  editable curve footprint. */
export class OverlayGhosts {
  constructor(private readonly host: OverlayHost, private readonly mapState: () => GridState | null = () => null) {}

  /** The host's render request as a value, for callbacks that fire later. */
  private repaint = (): void => this.host.requestRender();

  readonly ghostGraphics = new PIXI.Graphics();
  readonly curveGraphics = new PIXI.Graphics();
  /** The preview card's centre glyph — a sprite rather than a path, so both views raster it once
   *  from the same drawing (view/shared/overlay/preview-cell-raster). */
  readonly previewIcon = new PIXI.Sprite();
  /** Holds the placement ghost sprite and, above it, the group drag ghost's sprites. */
  readonly placementSlot = new PIXI.Container();
  readonly groupSlot = new PIXI.Container();
  /** What a placement lays, under its outline: the road surface and, over it, the terrain blocks,
   *  the slot carrying the ghost's opacity so overlapping parts never stack it. */
  readonly laySlot = new PIXI.Container();
  private readonly blockGraphics = new PIXI.Graphics();
  /** The road tiles a ghost lays, on the live map's cells, for the road surfaces to draw. */
  private roadGhost: GridState | null = null;
  /** Each road ghost's own object version, so no cache keyed on one mistakes it for another map. */
  private roadGhostVersion = 0;
  /** The lookup the road ghost's surface reads. */
  private roadLookup: RoadLookup | null = null;

  /** The latest ghost request; rebuilt at most once per frame. */
  private pendingGhost: GhostRequest | null = null;
  private ghostRaf = 0;

  /**
   * Show a placement or the preview card over `cells`.
   * Coalesced to one rebuild per frame: a drag-shape preview arrives once per
   * pointer sample (several per frame under coalesced events), and only the
   * latest matters.
   */
  showGhost({ grid, cells }: MixedCellSet, paint: GhostPaint, trim?: readonly TrimmedCell[], losses?: readonly GhostCell[]): void {
    this.pendingGhost = { kind: 'cells', cells, paint, grid, trim, losses };
    this.scheduleGhostBuild();
  }

  /**
   * Span-native ghost for analytic drag shapes (rect/circle): a map-size
   * preview arrives as ~one span per row, so nothing ever expands to the
   * shape's full cell count. Spans must be per-row merged (the shape builders
   * in core/grid/shapes guarantee it).
   */
  showGhostSpans(spans: RowSpan[], paint: GhostPaint, grid: GridId, trim?: readonly TrimmedCell[]): void {
    this.pendingGhost = { kind: 'spans', spans, paint, grid, trim };
    this.scheduleGhostBuild();
  }

  private placementGhost: PIXI.Sprite | null = null;

  /** The object's own picture, see-through and tinted when refused: placement previews and object
   *  drags show the thing itself. An object without a picture shows only its footprint. */
  showPlacementGhost(obj: PlacedObject, valid: boolean): void {
    if (!this.placementGhost) {
      this.placementGhost = new PIXI.Sprite();
      this.placementGhost.alpha = GHOST_LOOK.opacity;
      this.placementSlot.addChild(this.placementGhost);
    }
    paintItemSprite(this.placementGhost, obj, valid, this.repaint);
    this.host.requestRender();
  }

  private dropPlacementGhost(): void {
    if (this.placementGhost) {
      this.placementGhost.visible = false;
      this.host.requestRender();
    }
  }

  /** Pool of sprites for the group drag ghost — one per member, reused across pointer moves
   *  (a 40-member drag would otherwise create/destroy 40 sprites on every sample). */
  private groupGhosts: PIXI.Sprite[] = [];

  showGroupPlacementGhost(members: readonly PlacedObject[], valid: boolean): void {
    while (this.groupGhosts.length > members.length) {
      const s = this.groupGhosts.pop()!;
      this.groupSlot.removeChild(s);
      s.destroy();
    }
    while (this.groupGhosts.length < members.length) {
      const s = new PIXI.Sprite();
      s.alpha = GHOST_LOOK.opacity;
      this.groupSlot.addChild(s);
      this.groupGhosts.push(s);
    }
    for (let i = 0; i < members.length; i++) {
      paintItemSprite(this.groupGhosts[i]!, members[i]!, valid, this.repaint);
    }
    this.host.requestRender();
  }

  private clearGroupPlacementGhost(): void {
    if (this.groupGhosts.length === 0) return;
    for (const s of this.groupGhosts) { this.groupSlot.removeChild(s); s.destroy(); }
    this.groupGhosts = [];
    this.host.requestRender();
  }

  clearGhost(): void {
    this.dropPlacementGhost();
    this.clearGroupPlacementGhost();
    this.pendingGhost = { kind: 'clear' };
    this.scheduleGhostBuild();
  }

  private scheduleGhostBuild(): void {
    if (this.host.disposed || this.ghostRaf) return;
    this.ghostRaf = requestAnimationFrame(() => {
      this.ghostRaf = 0;
      const p = this.pendingGhost;
      this.pendingGhost = null;
      if (!p) return;
      this.host.requestRender();
      this.ghostGraphics.clear();
      this.blockGraphics.clear();
      this.roadLayers.own.slot.visible = false;
      this.roadLayers.beside.slot.visible = false;
      this.previewIcon.visible = false;
      if (p.kind === 'clear') return;
      // A gain-less ghost with something to lose still has something to draw (a run that only
      // strips a coating and lays nothing back).
      const empty = p.kind === 'cells' ? p.cells.length === 0 && !(p.losses && p.losses.length > 0) : p.spans.length === 0;
      if (empty) return;
      // 0) the loss wash, under the gain: what this shape would replace, drawn first so a cell
      //    that both loses and gains reads as a gain over a loss rather than the reverse.
      if (p.kind === 'cells' && p.losses && p.losses.length > 0) {
        const lossSpans = mergeCellSpans(p.losses.map((c) => ({ x: c.x, y: c.y, grid: cellGrid(c, p.grid) })));
        this.ghostGraphics.beginFill(GHOST_LOSS, GHOST_WASH_ALPHA.map2d);
        for (const sp of lossSpans) spanRect(this.ghostGraphics, sp);
        this.ghostGraphics.endFill();
      }
      if (isPreviewCell(p.paint)) this.buildCard(p, p.paint);
      else this.buildPlacement(p, p.paint);
    });
  }

  /** The cells on the ghost's own grid, merged into row spans, with the trimmed ones left out to be
   *  drawn in their own shape. Merged spans because a large drag shape holds tens of thousands of
   *  cells, and one rect per cell would tessellate that many Graphics rects per pointer move. */
  private footprint(p: DrawnGhost): { own: GhostCell[]; across: GhostCell[]; trim: TrimmedCell[]; spans: CellSpan[] } {
    // Cells naming another grid draw beside the shape as their own plain footprint; the card,
    // the trim and the outline belong to the cells on the ghost's own grid.
    const { own, across, trim } = ghostPlan(p.kind === 'cells' ? p.cells : [], p.grid, p.trim ?? []);
    const trimmed = new Set(trim.map((t) => cellKey(t.x, t.y)));
    const spans: CellSpan[] = p.kind === 'spans'
      ? spansWithout(p.spans, trim).map((sp) => ({ ...sp, grid: p.grid }))
      : mergeCellSpans(own.filter((c) => !trimmed.has(cellKey(c.x, c.y))).map(({ x, y }) => ({ x, y, grid: p.grid })));
    return { own, across, trim, spans };
  }

  private outline(p: DrawnGhost, own: readonly GhostCell[], trim: readonly TrimmedCell[]): EdgeSegment[] {
    return ghostOutline(p.kind === 'spans' ? { spans: p.spans } : { cells: own }, trim);
  }

  /**
   * A placement: what it lays drawn as the real thing at the ghost's opacity, its footprint washed
   * in the loss red when refused, and its outline (a thin light line when valid, the loss red when
   * refused). Bodies arrive separately, as sprites over all of this.
   */
  private buildPlacement(p: DrawnGhost, paint: PlacementPaint): void {
    const g = this.ghostGraphics;
    const { own, across, trim, spans } = this.footprint(p);
    if (paint.ground?.length) this.paintGround(paint.ground, paint.valid);
    if (paint.blocks?.length) this.paintBlocks(paint.blocks, paint.valid);
    if (paint.tiles?.length) this.paintRoads(paint.tiles, paint.valid);
    this.laySlot.alpha = GHOST_LOOK.opacity;
    const shift = gridOffsetPx(p.grid);
    const scale = gridSize(p.grid);
    if (!paint.valid) {
      g.beginFill(GHOST_LOSS, GHOST_LOOK.refusedWash);
      for (const sp of spans) spanRect(g, sp);
      g.endFill();
      for (const t of trim) this.trimmedCell(t, shift, { color: GHOST_LOSS, alpha: GHOST_LOOK.refusedWash });
      for (const [grid, cells] of groupByGrid(across, p.grid)) {
        g.beginFill(GHOST_LOSS, GHOST_LOOK.refusedWash);
        for (const sp of mergeCellSpans(cells.map(({ x, y }) => ({ x, y, grid })))) spanRect(g, sp);
        g.endFill();
      }
    }
    this.strokePlacementEdges(this.outline(p, own, trim), shift, scale, paint.valid);
    for (const [grid, cells] of groupByGrid(across, p.grid)) {
      this.strokePlacementEdges(boundaryEdges(cells), gridOffsetPx(grid), gridSize(grid), paint.valid);
    }
  }

  /** One trimmed cell in the shape the trim leaves it: a road tile through the road painter the
   *  committed tile goes through, a block through its quadrants (`patch` picks the inner fan
   *  winding for a Γ fillet, as the committed terrain draws it). */
  private trimmedCell(t: TrimmedCell, shift: Shift, fill: { color: number; alpha: number }, g = this.ghostGraphics): void {
    if (t.road) {
      const box = { x: t.x * TILE_SIZE + shift.x, y: t.y * TILE_SIZE + shift.y, w: TILE_SIZE, h: TILE_SIZE };
      drawRoadShape(g, t.corners, t.road, box, fill);
      return;
    }
    const block = { bx: t.x * TILE_SIZE + shift.x, by: t.y * TILE_SIZE + shift.y, halfSize: QUADRANT_PX };
    drawTrimmedBlock(g, t.corners, block, { ...fill, patchOnly: t.patch });
  }

  /** Ground a placement turns, in its zone's colour, on the grid zones lie on, under the blocks. */
  private paintGround(ground: readonly GhostGround[], valid: boolean): void {
    const g = this.blockGraphics;
    const byZone = new Map<number, GhostGround[]>();
    for (const c of ground) {
      const group = byZone.get(c.zone);
      if (group) group.push(c); else byZone.set(c.zone, [c]);
    }
    for (const [zone, cells] of byZone) {
      g.beginFill(ghostColor(getZoneColor(zone), valid), 1);
      for (const sp of mergeCellSpans(cells.map(({ x, y }) => ({ x, y, grid: PLACEMENT_GRID })))) spanRect(g, sp);
      g.endFill();
    }
  }

  /** Terrain blocks in their own colours and cuts, square ones merged into spans per colour; a
   *  mountain tier's edge darkened so a first layer reads against the grass. */
  private paintBlocks(blocks: readonly GhostBlock[], valid: boolean, g: PIXI.Graphics = this.blockGraphics): void {
    const shift = gridOffsetPx(TERRAIN_GRID);
    const trimOf = (b: GhostBlock): TrimmedCell | null => (b.terrain.patchOnly || b.terrain.corners?.some((c) => c !== 'square')
      ? ghostPlan([], TERRAIN_GRID, [{ x: b.x, y: b.y, corners: [...b.terrain.corners ?? SQUARE_CORNERS] as Corners, patch: !!b.terrain.patchOnly }]).trim[0]!
      : null);
    const byColor = new Map<number, GhostBlock[]>();
    for (const b of blocks) {
      const color = getTerrainColor(b.terrain.type, b.terrain.elevation);
      const group = byColor.get(color);
      if (group) group.push(b); else byColor.set(color, [b]);
    }
    for (const [color, group] of byColor) {
      const fill = ghostColor(color, valid);
      const square = group.filter((b) => !trimOf(b));
      g.beginFill(fill, 1);
      for (const sp of mergeCellSpans(square.map(({ x, y }) => ({ x, y, grid: TERRAIN_GRID })))) spanRect(g, sp);
      g.endFill();
      for (const b of group) {
        const t = trimOf(b);
        if (t) this.trimmedCell(t, shift, { color: fill, alpha: 1 }, g);
      }
    }
    // Each mountain tier's own rim: the outline of everything at its layer and above, drawn where
    // the cell inside stands at that layer, so a tier's step shows and a hole for a higher one does not.
    const mountains = blocks.filter((b) => b.terrain.type === TerrainType.Mountain);
    const tierAt = new Map(mountains.map((b) => [cellKey(b.x, b.y), b.terrain.elevation]));
    for (const tier of new Set(mountains.map((b) => b.terrain.elevation))) {
      const atLeast = mountains.filter((b) => b.terrain.elevation >= tier);
      const trim = atLeast.map(trimOf).filter((t): t is TrimmedCell => t !== null);
      const edges = trim.length === 0 ? boundaryEdges(atLeast) : trimmedOutline(atLeast, trim);
      const color = ghostColor(getTerrainColor(TerrainType.Mountain, tier), valid);
      g.lineStyle(GHOST_LOOK.blockEdge.width * TILE_SIZE, lerpColor(color, 0x000000, GHOST_LOOK.blockEdge.darken), 1);
      for (const e of edges) this.insetEdge(g, e, shift, (x, y) => tierAt.get(cellKey(x, y)) === tier);
      g.lineStyle(0);
    }
  }

  /** One block edge, inset by half its width into the side `inside` holds, so the footprint outline
   *  drawn over the boundary leaves it showing; skipped when neither side is inside, centred when
   *  both are (a cut corner's diagonal, inside its own cell). */
  private insetEdge(g: PIXI.Graphics, e: EdgeSegment, shift: Shift, inside: (x: number, y: number) => boolean): void {
    const half = GHOST_LOOK.blockEdge.width / 2;
    const { nx, ny, ahead, behind } = edgeInsideSide(e, inside);
    if (!ahead && !behind) return;
    const k = ahead === behind ? 0 : ahead ? half : -half;
    g.moveTo((e.ax + nx * k) * TILE_SIZE + shift.x, (e.ay + ny * k) * TILE_SIZE + shift.y);
    g.lineTo((e.bx + nx * k) * TILE_SIZE + shift.x, (e.by + ny * k) * TILE_SIZE + shift.y);
  }

  /** The turning body of a placement turned a quarter: `blocks`, as the map now holds them, drawn
   *  as the ghost draws terrain and swung in from the pose before the turn on the group rotation's
   *  clock, about `pivot` in placement-grid cells; a flipped one opens out from its mirror across
   *  `flip`'s axes on the flip's clock. Reduced motion draws nothing. */
  readonly turnSlot = new PIXI.Container();
  private stopTurn: (() => void) | null = null;

  turnBlocks(blocks: readonly GhostBlock[], prior: readonly GhostPrior[], pivot: { x: number; y: number }, sweepDeg: number, flip?: FlipAxes): void {
    if (this.host.disposed || isMotionReduced() || blocks.length === 0) return;
    this.endTurn();
    // The landed cells stand as they were before the placement under the body, which brings the landing with it.
    const under = new PIXI.Graphics();
    this.paintPrior(prior, under);
    this.turnSlot.addChild(under);
    const body = new PIXI.Graphics();
    this.paintBlocks(blocks, true, body);
    const shift = gridOffsetPx(PLACEMENT_GRID);
    const at = { x: pivot.x * TILE_SIZE + shift.x, y: pivot.y * TILE_SIZE + shift.y };
    body.pivot.set(at.x, at.y);
    body.position.set(at.x, at.y);
    this.turnSlot.addChild(body);
    const sweepRad = (sweepDeg * Math.PI) / 180;
    let ended = false;
    const stop = this.host.play(timedBeat(animConfig.groupRotation.durationMs, (t) => {
      if (flip) {
        // Terrain is mirrored for real, so the body takes the signed scale, mirrored back at the start.
        const k = flipScale(groupEase(t));
        body.scale.set(flip.x ? k : 1, flip.y ? k : 1);
      } else {
        body.rotation = -sweepRad * (1 - groupEase(t));
      }
      if (t >= 1) { ended = true; this.endTurn(); }
    }));
    if (!ended) this.stopTurn = stop;
  }

  /** Cells as they stood before a placement, at full strength: terrain through the block paint, bare
   *  ground in its zone's colour. */
  private paintPrior(prior: readonly GhostPrior[], g: PIXI.Graphics): void {
    const terrain = prior.filter((p): p is GhostPrior & GhostBlock => p.terrain !== null);
    for (const p of prior) {
      if (p.terrain) continue;
      const zone = getCell(this.mapState()?.cells ?? [], p.x, p.y)?.zone;
      g.beginFill(zone === undefined ? 0 : getZoneColor(zone), 1);
      cellRect(g, p.x, p.y, TERRAIN_GRID);
      g.endFill();
    }
    if (terrain.length) this.paintBlocks(terrain, true, g);
  }

  private endTurn(): void {
    this.stopTurn?.();
    this.stopTurn = null;
    for (const child of this.turnSlot.removeChildren()) child.destroy();
    this.repaint();
  }

  /** Road tiles through the road surfaces the map draws, over a copy of the map holding only them. */
  private paintRoads(tiles: readonly PlacedObject[], valid: boolean): void {
    const live = this.mapState();
    if (!live) return;
    const ghost = roadGhost(live, tiles, --this.roadGhostVersion);
    this.roadGhost = ghost.state;
    this.roadLookup = ghost.roads;
    // A refused ghost is cut to its own tiles to take the tint; the tiles it joins draw again, cut
    // to their cells, in their own colours.
    const cut = !valid && ghost.beside.length > 0;
    this.drawRoadLayer(this.roadLayers.own, ghostTint(valid), cut ? tiles : null);
    this.roadLayers.beside.slot.visible = false;
    if (cut) this.drawRoadLayer(this.roadLayers.beside, ghostTint(true), ghost.beside);
  }

  /** Two road surface layers over the same ghost map: the ghost's own, and the tiles it joins. */
  private readonly roadLayers = { own: this.roadLayer(), beside: this.roadLayer() };

  private roadLayer(): { slot: PIXI.Container; mask: PIXI.Graphics; surfaces: RoadSurfaces | null } {
    return { slot: new PIXI.Container(), mask: new PIXI.Graphics(), surfaces: null };
  }

  /** One road layer's surfaces, worn in `tint`, cut to `cells` (the whole surface for null). */
  private drawRoadLayer(layer: ReturnType<OverlayGhosts['roadLayer']>, tint: number, cells: readonly PlacedObject[] | null): void {
    layer.surfaces ??= new RoadSurfaces({
      container: () => layer.slot,
      requestRender: this.repaint,
      surfaceContainerFor: () => layer.slot,
      state: () => this.roadGhost,
      roads: (state) => this.roadLookup ?? roadLookup(state),
    });
    layer.surfaces.flush();
    // The surfaces' drawings are cached across moves, so the tint is set on every flush.
    const wear = (node: PIXI.DisplayObject): void => {
      if (node instanceof PIXI.Graphics || node instanceof PIXI.Sprite) node.tint = tint;
      if (node instanceof PIXI.Container) for (const child of node.children) wear(child);
    };
    wear(layer.slot);
    layer.mask.clear();
    if (cells) {
      layer.mask.beginFill(0xffffff, 1);
      for (const o of cells) layer.mask.drawRect(o.position.x * TILE_SIZE, o.position.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      layer.mask.endFill();
    }
    layer.slot.mask = cells ? layer.mask : null;
    layer.slot.visible = true;
  }

  /** A placement's outline: a dark halo under a thin light line when valid, the loss red when
   *  refused. `scale` is the side of the edges' grid cells in map cells. */
  private strokePlacementEdges(edges: readonly EdgeSegment[], shift: Shift, scale: number, valid: boolean): void {
    const { outline } = GHOST_LOOK;
    const strokes: ReadonlyArray<readonly [number, number, number]> = valid
      ? [[outline.halo, 0x000000, 0.35], [outline.valid, 0xffffff, 0.9]]
      : [[outline.refused, GHOST_LOSS, 1]];
    for (const [width, color, alpha] of strokes) this.strokeEdges(edges, shift, scale, { width: width * TILE_SIZE, color, alpha });
    this.ghostGraphics.lineStyle(0);
  }

  private strokeEdges(edges: readonly EdgeSegment[], shift: Shift, scale: number, line: { width: number; color: number; alpha: number }): void {
    const px = scale * TILE_SIZE;
    this.ghostGraphics.lineStyle(line.width, line.color, line.alpha);
    for (const e of edges) {
      this.ghostGraphics.moveTo(e.ax * px + shift.x, e.ay * px + shift.y);
      this.ghostGraphics.lineTo(e.bx * px + shift.x, e.by * px + shift.y);
    }
  }

  /** The preview card a tool shows where it acts: its translucent background over the footprint,
   *  the refused state's stripes, its line and its marks. */
  private buildCard(p: DrawnGhost, card: PreviewCell): void {
    const shift = gridOffsetPx(p.grid);
    // Cell-unit geometry below is scaled to map cells by the ghost grid's cell side.
    const scale = gridSize(p.grid);
    const { own, across, trim, spans } = this.footprint(p);
    const palette = previewPalette(card);
    // A card over an untrimmed footprint that fills its own bounds is the design's own shape: one
    // rounded rectangle, however many cells it spans. Anything else (an irregular shape, a stroke
    // whose corners auto-trim will cut) keeps the exact silhouette the click will leave, which is
    // what the ghost is for — at this radius the rounding is a pixel and a half.
    const bounds = p.kind === 'spans' ? boundsOfSpans(p.spans) : cellsBounds(own);
    const cellCount = p.kind === 'spans' ? p.spans.reduce((n, s) => n + s.w, 0) : own.length;
    const solid = trim.length === 0 && isSolidRect(cellCount, bounds) ? bounds : null;
    const cardRect = solid && scaleRect(solid, scale);
    // The translucent background, kept low so it doesn't hide the terrain underneath.
    this.ghostGraphics.beginFill(palette.bg, palette.bgAlpha);
    if (cardRect) this.roundedCardRect(cardRect, shift);
    else for (const sp of spans) spanRect(this.ghostGraphics, sp);
    this.ghostGraphics.endFill();
    for (const t of trim) this.trimmedCell(t, shift, { color: palette.bg, alpha: palette.bgAlpha });

    // The refused state's stripes, over the same footprint the fill just covered.
    if (palette.hatch !== undefined) {
      const rects: Rect[] = cardRect
        ? [cardRect]
        : [...spans.map((sp) => scaleRect({ x: sp.x, y: sp.y, w: sp.w, h: 1 }, scale)),
           ...trim.map((t) => scaleRect({ x: t.x, y: t.y, w: 1, h: 1 }, scale))];
      this.ghostGraphics.beginFill(palette.hatch, palette.bgAlpha);
      for (const bar of hatchBars(rects)) {
        this.ghostGraphics.drawPolygon(bar.map((v, i) => v * TILE_SIZE + (i % 2 === 0 ? shift.x : shift.y)));
      }
      this.ghostGraphics.endFill();
    }

    // The card's line: the design's own inset line round a card rectangle, else the footprint's
    // outer boundary in the palette's colour.
    if (cardRect) {
      this.ghostGraphics.lineStyle({
        width: PREVIEW_CELL_ART.stroke * TILE_SIZE, color: palette.line, alpha: 1, alignment: 0,
      });
      this.roundedCardRect(cardRect, shift);
      this.ghostGraphics.lineStyle(0);
    } else {
      this.strokeGhostEdges(this.outline(p, own, trim), shift, palette, scale);
    }
    for (const [grid, cells] of groupByGrid(across, p.grid)) {
      this.ghostGraphics.beginFill(palette.bg, palette.bgAlpha);
      for (const sp of mergeCellSpans(cells.map(({ x, y }) => ({ x, y, grid })))) spanRect(this.ghostGraphics, sp);
      this.ghostGraphics.endFill();
      this.strokeGhostEdges(boundaryEdges(cells), gridOffsetPx(grid), palette, gridSize(grid));
    }

    if (bounds) this.paintCardMarks(card, palette, scaleRect(bounds, scale), shift);
  }

  /** The card's line along `edges`. `scale` is the side of the edges' grid cells in map cells. */
  private strokeGhostEdges(edges: readonly EdgeSegment[], shift: Shift, palette: PreviewPalette, scale: number): void {
    this.strokeEdges(edges, shift, scale, { width: PREVIEW_CELL_ART.stroke * TILE_SIZE, color: palette.line, alpha: 1 });
    this.ghostGraphics.lineStyle(0);
  }

  /** The card's background outline: the footprint, in map cells from its grid's origin, as one rounded rect. */
  private roundedCardRect(b: Rect, shift: Shift): void {
    this.ghostGraphics.drawRoundedRect(
      b.x * TILE_SIZE + shift.x, b.y * TILE_SIZE + shift.y,
      b.w * TILE_SIZE, b.h * TILE_SIZE, PREVIEW_CELL_ART.radius * TILE_SIZE,
    );
  }

  /** The card's four corner dots and its centre glyph, the two parts that do not stretch with the
   *  footprint (see view/shared/overlay/preview-cell), around `bounds` in map cells from its grid's origin. */
  private paintCardMarks(card: PreviewCell, palette: PreviewPalette, bounds: Rect, shift: Shift): void {
    this.ghostGraphics.beginFill(palette.line, 1);
    for (const dot of previewDots(bounds)) {
      this.ghostGraphics.drawCircle(dot.x * TILE_SIZE + shift.x, dot.y * TILE_SIZE + shift.y, dot.r * TILE_SIZE);
    }
    this.ghostGraphics.endFill();
    if (!card.icon) return;
    const tex = previewIconTexture(card.icon);
    if (!tex) return;
    const rect = previewIconRect(bounds, card.icon);
    this.previewIcon.texture = tex;
    this.previewIcon.width = rect.w * TILE_SIZE;
    this.previewIcon.height = rect.h * TILE_SIZE;
    this.previewIcon.position.set(
      (bounds.x + bounds.w / 2) * TILE_SIZE + shift.x, (bounds.y + bounds.h / 2) * TILE_SIZE + shift.y,
    );
    this.previewIcon.visible = true;
  }

  showCurveFootprint({ grid, cells }: CellSet): void {
    this.curveGraphics.clear();
    this.curveGraphics.beginFill(CURVE_FOOTPRINT.color, CURVE_FOOTPRINT.alpha);
    for (const { x, y } of cells) cellRect(this.curveGraphics, x, y, grid);
    this.curveGraphics.endFill();
    this.host.requestRender();
  }

  clearCurveFootprint(): void {
    this.curveGraphics.clear();
    this.host.requestRender();
  }

  dispose(): void {
    if (this.ghostRaf) cancelAnimationFrame(this.ghostRaf);
    this.ghostRaf = 0;
    this.stopTurn?.();
    this.stopTurn = null;
  }
  /** The preview card's glyph starts hidden, centred on its anchor. */
  init(): this {
    const { own, beside } = this.roadLayers;
    this.laySlot.addChild(beside.slot, own.slot, beside.mask, own.mask, this.blockGraphics);
    this.previewIcon.anchor.set(0.5);
    this.previewIcon.visible = false;
    return this;
  }

}
