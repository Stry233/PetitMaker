import { isRamp } from '../../../../core/model/traits';
import { rampIconTurn } from '../../draw/ramp-graphic';
import * as PIXI from 'pixi.js-legacy';
import { QUADRANT_PX, TILE_SIZE, gridOffsetPx } from '../../geometry/world';
import { getCatalogItem } from '../../../../state/catalog';
import { getPlacedObjectSize } from '../../../../state/object-geometry';
import { getRotatedSize } from '../../../../core/grid/footprint';
import { iconUrl } from '../../../../assets/icon-urls';
import { fitSpriteToTexture, footprintFit, itemSpriteFill, spriteTurns } from '../../draw/sprite-fit';
import { drawRoadShape, drawTrimmedBlock } from '../../draw/trim-shapes';
import { cellsBounds, cellKey } from '../../../../core/grid/rect';
import type { Rotation } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import { shapeOfSpans, type TrimmedCell } from '../../../../tools/trim';
import type { GhostCell, GhostPaint, GhostRequest, PlacementGhost, PlacementWash, PreviewCell, PreviewIcon } from '../../../../tools/pointer/runtime';
import { cellGrid, type CellSet, type GridId, type MixedCellSet } from '../../../../core/grid/grids';
import { GHOST_WASH_ALPHA, ghostPlan, roadTrimmedOutline, trimmedOutline, type RoadTrimmedGhostCell } from '../../../shared/overlay/ghost-geometry';
import { boundaryEdges, boundaryEdgesFromSpans, groupByGrid, mergeCellSpans, spanMembership, spansWithout, type CellSpan, type EdgeSegment, type RowSpan } from '../../../../core/grid/cell-spans';
import { CURVE_FOOTPRINT, boundsOfSpans, hatchBars, isPreviewCell, isSolidRect, washColor, previewDots, previewIconRect, previewPalette, PREVIEW_CELL_ART, type PreviewPalette } from '../../../shared/overlay/preview-cell';
import { previewIconCanvas } from '../../../shared/overlay/preview-cell-raster';
import type { OverlayHost } from './host';
import { cellRect, spanRect, type Shift } from './paint';
import { gridSize } from '../../../../core/grid/grid-convert';
import { GHOST_LOSS } from '../../../shared/viewport/view-constants';
import { lerpColor } from '../../../../core/base/color';

/** The tint a refused ghost icon wears. A sprite tint multiplies the art, so the loss red is lifted
 *  toward white to keep the icon legible. */
const REFUSED_ICON_TINT = lerpColor(GHOST_LOSS, 0xffffff, 0.35);

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

/** Point a sprite at one item's placement: the hover-preview ghost, each member of the group drag
 *  ghost and a flagged object. Returns false (and hides `g`) when the item has no sprite icon
 *  (roads): the cell drawing is the only feedback those get. `repaint` runs when the texture loads. */
export function paintItemSprite(
  g: PIXI.Sprite, ghost: { catalogId: string; x: number; y: number; rotation: number; spanLength?: number }, valid: boolean,
  repaint: () => void,
): boolean {
  const { catalogId, x, y, rotation, spanLength } = ghost;
  const item = getCatalogItem(catalogId);
  const url = item?.icon ? iconUrl(item.icon) : undefined;
  if (!item || !url) { g.visible = false; return false; }
  const tex = PIXI.Texture.from(url);
  g.texture = tex;
  const size = spanLength === undefined ? getRotatedSize(item, rotation as Rotation)
    : getPlacedObjectSize({ id: '__ghost__', catalogId, position: { x, y }, rotation: rotation as Rotation, elevation: 0, spanLength });
  g.anchor.set(0.5);
  g.position.set((x + size.w / 2) * TILE_SIZE, (y + size.h / 2) * TILE_SIZE);
  // A uniform scale preserves the icon aspect ratio when placement changes the footprint.
  const rampTurn = isRamp(item) ? rampIconTurn(rotation) : null;
  g.rotation = rampTurn?.rotation ?? (spriteTurns(item) ? ((rotation % 360) * Math.PI) / 180 : 0);
  fitSpriteToTexture(g, tex, footprintFit(size.w * TILE_SIZE, size.h * TILE_SIZE, itemSpriteFill(item)), rampTurn?.flipX ?? false, repaint);
  g.tint = valid ? 0xffffff : REFUSED_ICON_TINT;
  return true;
}

/** Placement ghosts: the cell wash or preview card a shape would leave, item sprites riding it, and the editable curve footprint. */
export class OverlayGhosts {
  constructor(private readonly host: OverlayHost) {}

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

  /** The latest ghost request; rebuilt at most once per frame. */
  private pendingGhost: GhostRequest | null = null;
  private ghostRaf = 0;

  /**
   * Draw semi-transparent fill on cells to show a placement ghost preview.
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

  /** The item's sprite riding the ghost cell — placement previews and object
   *  drags show the thing itself, validity-tinted, over the cell wash. Items
   *  without a sprite icon (roads) keep the plain cell ghost. */
  showPlacementGhost({ catalogId, x, y, rotation, spanLength }: PlacementGhost, valid: boolean): void {
    if (!this.placementGhost) {
      this.placementGhost = new PIXI.Sprite();
      this.placementGhost.alpha = 0.65;
      this.placementSlot.addChild(this.placementGhost);
    }
    paintItemSprite(this.placementGhost, { catalogId, x, y, rotation, spanLength }, valid, this.repaint);
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

  showGroupPlacementGhost(members: readonly PlacementGhost[], valid: boolean): void {
    while (this.groupGhosts.length > members.length) {
      const s = this.groupGhosts.pop()!;
      this.groupSlot.removeChild(s);
      s.destroy();
    }
    while (this.groupGhosts.length < members.length) {
      const s = new PIXI.Sprite();
      s.alpha = 0.65;
      this.groupSlot.addChild(s);
      this.groupGhosts.push(s);
    }
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      paintItemSprite(this.groupGhosts[i]!, { catalogId: m.catalogId, x: m.x, y: m.y, rotation: m.rotation }, valid, this.repaint);
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
      this.previewIcon.visible = false;
      if (p.kind === 'clear') return;
      // A gain-less ghost with something to lose still has something to draw (a run that only
      // strips a coating and lays nothing back).
      const empty = p.kind === 'cells' ? p.cells.length === 0 && !(p.losses && p.losses.length > 0) : p.spans.length === 0;
      if (empty) return;
      const shift = gridOffsetPx(p.grid);
      // Cell-unit geometry below is scaled to map cells by the ghost grid's cell side.
      const scale = gridSize(p.grid);
      // Cells naming another grid draw beside the shape as their own plain footprint; the card,
      // the trim and the outline below belong to the cells on the ghost's own grid.
      const { own, across, trim } = ghostPlan(p.kind === 'cells' ? p.cells : [], p.grid, p.trim ?? []);
      // The preview card or a placement wash: the card carries its own paint (see
      // view/shared/overlay/preview-cell), a wash is the content colour the caller named.
      const card = isPreviewCell(p.paint) ? p.paint : null;
      const palette = card ? previewPalette(card) : null;
      const fillColor = palette ? palette.bg : washColor(p.paint as PlacementWash);
      const fillAlpha = palette ? palette.bgAlpha : GHOST_WASH_ALPHA.map2d;

      // 0) the loss wash, under the gain: what this shape would replace, drawn first so a cell
      //    that both loses and gains reads as a gain over a loss rather than the reverse.
      if (p.kind === 'cells' && p.losses && p.losses.length > 0) {
        const lossSpans = mergeCellSpans(p.losses.map((c) => ({ x: c.x, y: c.y, grid: cellGrid(c, p.grid) })));
        this.ghostGraphics.beginFill(GHOST_LOSS, GHOST_WASH_ALPHA.map2d);
        for (const sp of lossSpans) spanRect(this.ghostGraphics, sp);
        this.ghostGraphics.endFill();
      }

      // 1) the translucent background: the card's palette, or a plain ghost's content tint. Kept low
      //    either way so it doesn't hide the terrain underneath. Drawn as merged row spans: a large
      //    drag shape holds tens of thousands of cells, and one rect per cell would tessellate that
      //    many Graphics rects per pointer move.
      // With auto-trim on, the cells whose corners it will cut are drawn one by one in the shape
      // they will actually have, and the rest still merge into spans.
      const trimmed = new Set(trim.map((t) => cellKey(t.x, t.y)));
      const spans: CellSpan[] = p.kind === 'spans'
        ? spansWithout(p.spans, trim).map((sp) => ({ ...sp, grid: p.grid }))
        : mergeCellSpans(own.filter((c) => !trimmed.has(cellKey(c.x, c.y)))
          .map(({ x, y }) => ({ x, y, grid: p.grid })));
      // A card over an untrimmed footprint that fills its own bounds is the design's own shape: one
      // rounded rectangle, however many cells it spans. Anything else (an irregular shape, a stroke
      // whose corners auto-trim will cut) keeps the exact silhouette the click will leave, which is
      // what the ghost is for — at this radius the rounding is a pixel and a half.
      const bounds = p.kind === 'spans' ? boundsOfSpans(p.spans) : cellsBounds(own);
      const cellCount = p.kind === 'spans' ? p.spans.reduce((n, s) => n + s.w, 0) : own.length;
      const solid = palette && trim.length === 0 && isSolidRect(cellCount, bounds) ? bounds : null;
      const cardRect = solid && scaleRect(solid, scale);
      this.ghostGraphics.beginFill(fillColor, fillAlpha);
      if (cardRect) this.roundedCardRect(cardRect, shift);
      else for (const sp of spans) spanRect(this.ghostGraphics, sp);
      this.ghostGraphics.endFill();
      for (const t of trim) {
        // A road tile's corners are canonical-state tokens, not quadrants, so it is drawn through
        // the road painter the committed tile goes through — the ghost wears the cut the lay makes.
        if (t.road) {
          const box = { x: t.x * TILE_SIZE + shift.x, y: t.y * TILE_SIZE + shift.y, w: TILE_SIZE, h: TILE_SIZE };
          drawRoadShape(this.ghostGraphics, t.corners, t.road, box, { color: fillColor, alpha: fillAlpha });
          continue;
        }
        // `t.patch` picks the inner fan winding for a Γ fillet — the committed terrain, the flash
        // path above and the 3D ghost all draw it that way; left to default, the fillet fills with
        // the outer fan, an outline/fill mismatch on every patched notch in the preview.
        const block = { bx: t.x * TILE_SIZE + shift.x, by: t.y * TILE_SIZE + shift.y, halfSize: QUADRANT_PX };
        drawTrimmedBlock(this.ghostGraphics, t.corners, block, { color: fillColor, alpha: fillAlpha, patchOnly: t.patch });
      }

      // 1b) the refused state's stripes, over the same footprint the fill just covered.
      if (palette?.hatch !== undefined) {
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

      // 2) a crisp outline of the footprint's outer boundary so the preview pops even when the fill colour
      //    nearly matches the terrain below (a flat fill alone would vanish over same-coloured mountain/water).
      //    Drawn as a dark halo + a bright white line, so it reads on any background. Boundary only (an edge
      //    whose neighbour is outside the set) — no internal grid clutter.
      // The trimmed silhouette when there is one: a cut corner and the Γ patch filling a notch are
      // both part of the shape the click leaves, and an outline drawn round the square footprint
      // would contradict the fill under it. A span ghost materialises only its rim — walking a
      // map-sized span set cell by cell is what the span form exists to avoid — so it hands the
      // outline a membership test for everything inside.
      // A card wears the design's own inset line in the palette's colour instead: the halo pair says
      // "a shape is being previewed", and the card already says it with four dots and a glyph.
      if (palette && cardRect) {
        this.ghostGraphics.lineStyle({
          width: PREVIEW_CELL_ART.stroke * TILE_SIZE, color: palette.line, alpha: 1, alignment: 0,
        });
        this.roundedCardRect(cardRect, shift);
        this.ghostGraphics.lineStyle(0);
      } else {
        const rim = p.kind === 'spans' ? shapeOfSpans(p.spans).rim : own;
        const inShape = p.kind === 'spans' ? spanMembership(p.spans) : undefined;
        // Roads have their own silhouette machinery: a cut road is a polygon, not a set of quadrants.
        // A ghost lays one surface, so a payload is all road or all terrain.
        const roadTrim = trim.filter((t): t is typeof t & RoadTrimmedGhostCell => !!t.road);
        const edges: EdgeSegment[] = trim.length === 0
          ? (p.kind === 'spans' ? boundaryEdgesFromSpans(p.spans) : boundaryEdges(own))
          : roadTrim.length > 0
            ? roadTrimmedOutline(rim, roadTrim, inShape)
            : trimmedOutline(rim, trim, inShape);
        this.strokeGhostEdges(edges, shift, palette, scale);
      }
      for (const [grid, cells] of groupByGrid(across, p.grid)) {
        this.ghostGraphics.beginFill(fillColor, fillAlpha);
        for (const sp of mergeCellSpans(cells.map(({ x, y }) => ({ x, y, grid })))) spanRect(this.ghostGraphics, sp);
        this.ghostGraphics.endFill();
        this.strokeGhostEdges(boundaryEdges(cells), gridOffsetPx(grid), palette, gridSize(grid));
      }

      if (palette && bounds) this.paintCardMarks(card!, palette, scaleRect(bounds, scale), shift);
    });
  }

  /** A ghost outline: the card's line, or a dark halo under a bright core that reads on any ground.
   *  `scale` is the side of the edges' grid cells in map cells. */
  private strokeGhostEdges(edges: readonly EdgeSegment[], shift: Shift, palette: PreviewPalette | null, scale: number): void {
    const px = scale * TILE_SIZE;
    const stroke = (width: number, col: number, alpha: number) => {
      this.ghostGraphics.lineStyle(width, col, alpha);
      for (const e of edges) {
        this.ghostGraphics.moveTo(e.ax * px + shift.x, e.ay * px + shift.y);
        this.ghostGraphics.lineTo(e.bx * px + shift.x, e.by * px + shift.y);
      }
    };
    if (palette) {
      stroke(PREVIEW_CELL_ART.stroke * TILE_SIZE, palette.line, 1);
    } else {
      stroke(4, 0x000000, 0.4);
      stroke(1.75, 0xffffff, 0.95);
    }
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
  }
  /** The preview card's glyph starts hidden, centred on its anchor. */
  init(): this {
    this.previewIcon.anchor.set(0.5);
    this.previewIcon.visible = false;
    return this;
  }

}
