import { cellEdges, dimensionDrawing } from '../../../core/model/annotation-dimensions';
import { dimensionBody } from './annotation-layer';
import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { LOSS_COLOR, TILE_SIZE } from '../../../core/model/constants';
import { hexStringToNumber } from '../../../core/model/colors';
import { animConfig, easeOutBack } from '../../../core/runtime/anim-config';
import { isMotionReduced } from '../../../core/runtime/motion-state';
import { requestRender } from '../render-scheduler';
import { getCatalogItem } from '../../../state/catalog';
import { getRotatedSize } from '../../../state/object-geometry';
import { iconUrl } from '../../../assets/icon-urls';
import { fitSpriteToTexture, footprintFit } from '../draw/sprite-fit';
import { drawRoadShape, drawTrimmedBlock } from '../draw/trim-shapes';
import { selectionPopAmplitude } from './object-animations';
import { HALF_TILE, cellsBounds } from '../../../core/model/grid-model';
import type { Corners, MacroCoord, MapTemplate, ValidationError, Rotation, Rect } from '../../../core/model/types';
import { shapeOfSpans, type TrimmedCell } from '../../../tools/edge-cut';
import type { MacroRect } from '../../interaction/marquee';
import {
  errorFlashSignature, resolveErrorFlashCells, resolveErrorFlashRects, shouldFlashErrors, flashDecay,
  type ErrorFlashCell, type ErrorFlashGate, type ErrorFlashRect,
} from '../../error-flash';
import { boundaryEdges, boundaryEdgesFromSpans, filletOnly, mergeCellSpans, roadTrimmedOutline, spansWithout, splitFlashShapes, trimmedOutline, type CellSpan, type EdgeSegment, type RoadTrimmedGhostCell, type RowSpan } from '../../ghost-geometry';
import {
  CURVE_FOOTPRINT, boundsOfSpans, hatchBars, isPreviewCell, isSolidRect, previewDots, previewIconRect,
  previewPalette, PREVIEW_CELL_ART, type GhostPaint, type PreviewCell, type PreviewIcon, type PreviewPalette, ROUTE_TINT, BAND_COLOR,
} from '../../../core/runtime/preview-cell';
import { previewIconCanvas } from '../../preview-cell-raster';
import { CellGrid } from '../draw/cell-grid';
import { CHUNK_GRID_STYLE, chunkStrokeCells, planetFrameRects } from '../../reference-grid';
import type { PlanetFrame } from '../../../core/model/planet';
import { MAP_TEXT, MAP_INK, MAP_EDGE_ALPHA, FRAME_INK } from '../../../core/runtime/brand-palette';

/** "Is this cell inside the span set?" — built once per ghost build, for the outline. */
function spanMembership(spans: readonly RowSpan[]): (x: number, y: number) => boolean {
  const rows = new Map<number, RowSpan[]>();
  for (const s of spans) {
    const row = rows.get(s.y);
    if (row) row.push(s); else rows.set(s.y, [s]);
  }
  return (x, y) => (rows.get(y) ?? []).some((s) => x >= s.x && x < s.x + s.w);
}

/** Selection marks wear the map-label treatment: warm off-white ink with a translucent dark edge. */
const SELECTION_CREAM = hexStringToNumber(MAP_TEXT);
const SELECTION_EDGE = hexStringToNumber(MAP_INK);
const SELECTION_EDGE_ALPHA = MAP_EDGE_ALPHA;
/** Mark geometry in SCREEN px, divided by the view zoom when drawn. */
const MARK_STROKE = 2.6;
const MARK_EDGE = 5;
const MARK_PAD = 4;
const MARK_GROUP_PAD = 10;
const MARK_ARM_MIN = 6;
const MARK_ARM_MAX = 14;

interface WorldRect { x: number; y: number; w: number; h: number }
/** A ghost's `losses` wash. */
const GHOST_LOSS = hexStringToNumber(LOSS_COLOR);
/** A plain-tint ghost's fill (a placement wash). A preview CARD brings its own alpha. */
const GHOST_WASH_ALPHA = 0.32;
// Hover preview: a thin translucent edge in the selection marks' ink over a faint light wash, in
// screen px like the marks.
const HOVER_EDGE_ALPHA = 0.5;
const HOVER_STROKE = 1.5;
const HOVER_FILL = 0xffffff;
const HOVER_FILL_ALPHA = 0.08;
const HOVER_RADIUS = 3;
/** Review marks: the least screen size of a cell, and the ink edge and yellow line widths, in screen px. */
const REVIEW_MIN_PX = 7;
const REVIEW_EDGE = 4;
const REVIEW_LINE = 2;
const BAND_DASH = 6;
const BAND_GAP = 4;

/** One dashed segment from (x0,y0) to (x1,y1); PIXI.Graphics has no native dash pattern. */
function dashedSegment(g: PIXI.Graphics, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len === 0) return;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  for (let d = 0; d < len; d += BAND_DASH + BAND_GAP) {
    const end = Math.min(d + BAND_DASH, len);
    g.moveTo(x0 + ux * d, y0 + uy * d);
    g.lineTo(x0 + ux * end, y0 + uy * end);
  }
}

/** Dashed rectangle outline, perimeter walked as four segments so the dash phase
 *  restarts at each corner rather than wrapping. */
function dashedRect(g: PIXI.Graphics, x: number, y: number, w: number, h: number): void {
  g.lineStyle(2, BAND_COLOR, 0.9);
  dashedSegment(g, x, y, x + w, y);
  dashedSegment(g, x + w, y, x + w, y + h);
  dashedSegment(g, x + w, y + h, x, y + h);
  dashedSegment(g, x, y + h, x, y);
}

/** Draw one cell-sized rect on `g`, offset by -HALF_TILE in terrainMode so it lands
 *  on the micro-grid cells terrain renders at (objects use the macro grid, no shift). */
function cellRect(g: PIXI.Graphics, x: number, y: number, terrainMode: boolean): void {
  const offset = terrainMode ? HALF_TILE : 0;
  g.drawRect(x * TILE_SIZE - offset, y * TILE_SIZE - offset, TILE_SIZE, TILE_SIZE);
}

/** Draw one merged row span (see ghost-geometry) on its grid. */
function spanRect(g: PIXI.Graphics, sp: CellSpan): void {
  const offset = sp.micro ? HALF_TILE : 0;
  g.drawRect(sp.x * TILE_SIZE - offset, sp.y * TILE_SIZE - offset, sp.w * TILE_SIZE, TILE_SIZE);
}

/** Draw one flashed BODY on its grid: the rect exactly as the thing it accuses is drawn, origin
 *  and size included (both are fractional for a half-grid footprint). */
function bodyRect(g: PIXI.Graphics, r: ErrorFlashRect): void {
  const offset = r.micro ? HALF_TILE : 0;
  g.drawRect(r.x * TILE_SIZE - offset, r.y * TILE_SIZE - offset, r.w * TILE_SIZE, r.h * TILE_SIZE);
}

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

export class OverlayLayer {
  public readonly container: PIXI.Container;
  /** Mounted separately so annotations can sit between the reference grid and tool feedback. */
  public readonly referenceGrid = new PIXI.Container();
  /** Opens the owning renderer's render window; MapRenderer rebinds it to itself right after
   *  construction. Defaults to the module broadcast, for an instance nobody has wired yet. */
  public requestRender: () => void = requestRender;
  private gridGraphics: CellGrid;
  private errorGraphics: PIXI.Graphics;
  private ghostGraphics: PIXI.Graphics;
  private curveGraphics = new PIXI.Graphics();
  private hoverGraphics: PIXI.Graphics;
  private bandGraphics: PIXI.Graphics;
  private selectionGraphics: PIXI.Graphics;
  /** The brackets around a whole group, redrawn as members append. */
  private selectionFrame: PIXI.Graphics;
  private selectionRects: WorldRect[] = [];
  private selectionUnion: WorldRect | null = null;
  private selectionExact = false;
  private viewZoom = 1;
  /** The preview card's centre glyph — a sprite rather than a path, so both views raster it once
   *  from the same drawing (canvas/preview-cell-raster). */
  private previewIcon: PIXI.Sprite;
  private selectionLabel: PIXI.Text | null = null;
  /** What shape a cell actually holds, for the flashes. Auto-trim cuts corners, so a flash of flat
   *  squares advertises a result the map does not have. Supplied by the renderer, which owns the
   *  live grid; absent (or for a macro-grid object flash) every cell reads as a plain square. */
  private shapeAt: (x: number, y: number) => { corners?: Corners; patchOnly?: boolean } | null = () => null;

  /** Point the flashes at the live grid. */
  setShapeSource(fn: (x: number, y: number) => { corners?: Corners; patchOnly?: boolean } | null): void {
    this.shapeAt = fn;
  }

  constructor() {
    this.container = new PIXI.Container();

    this.gridGraphics = new CellGrid();
    this.errorGraphics = new PIXI.Graphics();
    this.ghostGraphics = new PIXI.Graphics();
    this.hoverGraphics = new PIXI.Graphics();
    this.bandGraphics = new PIXI.Graphics();
    this.selectionGraphics = new PIXI.Graphics();
    this.selectionFrame = new PIXI.Graphics();
    this.previewIcon = new PIXI.Sprite();
    this.previewIcon.anchor.set(0.5);
    this.previewIcon.visible = false;

    // Paint order is this construction order, and every animation reuses its
    // Graphics with clear() — re-adding a child would silently hoist it above
    // the layers stacked after it here. The ERROR flash sits on top of the
    // ghost: at click time the ghost covers exactly the violating cells, and a
    // flash underneath its fill and outline reads as no feedback at all. The
    // hover preview sits under the selection ring so selecting visibly
    // "commits" the grey box into the selection marks. The band sits under the
    // selection rings too, so members already in the group stay legible while
    // dragging over them.
    this.referenceGrid.addChild(this.gridGraphics);
    this.container.addChild(this.planetFrameGraphics);
    this.container.addChild(this.planetFrameFlash);
    this.planetFrameFlash.alpha = 0;
    this.container.addChild(this.commitGraphics);
    this.container.addChild(this.curveGraphics);
    this.container.addChild(this.ghostGraphics);
    this.container.addChild(this.previewIcon);
    this.container.addChild(this.hoverGraphics);
    this.container.addChild(this.bandGraphics);
    this.container.addChild(this.selectionGraphics);
    this.container.addChild(this.selectionFrame);
    this.container.addChild(this.errorGraphics);
  }

  drawGridLines(template: MapTemplate, visible: boolean, scale: number, chunks: boolean): void {
    this.gridGraphics.draw(template, visible, scale, chunks);
  }

  private errorAnimId: number | null = null;

  /**
   * Shared alpha-fade flash loop (`alpha = peakAlpha·(1 − t²)`, ease-out: fast
   * attack, slow fade). Draws the cells as merged row spans each tick until the
   * alpha decays below the visible floor; `requestRender()` keeps it at 60fps
   * while live. Callers own the graphics lifecycle + animId storage via the callbacks.
   */
  private flashCells(opts: {
    g: PIXI.Graphics;
    cells: ErrorFlashCell[];
    /** Bodies to flash whole (an object's drawn footprint) — see `ErrorFlashRect`. Few by
     *  construction (one per accused body), so they need no span merging. */
    rects?: readonly ErrorFlashRect[];
    color: number;
    peakAlpha: number;
    durationMs: number;
    setAnimId: (id: number | null) => void;
    onEnd: () => void;
  }): void {
    const { g, cells, rects = [], color, peakAlpha, durationMs } = opts;
    // Resolved ONCE, against the map as it now stands — see `splitFlashShapes`.
    const { shaped, plain } = splitFlashShapes(cells, this.shapeAt);
    // Row spans, merged ONCE: the fade refills its Graphics every frame, and a
    // large region (a whole-shape commit, a big footprint) as per-cell rects
    // would tessellate tens of thousands of rects per frame.
    const spans = mergeCellSpans(plain);
    const startTime = performance.now();
    const animate = () => {
      this.requestRender();
      const t = Math.min((performance.now() - startTime) / durationMs, 1);
      const alpha = flashDecay(peakAlpha, t);
      try { g.clear(); } catch { opts.onEnd(); return; }
      if (alpha > 0.01) {
        g.beginFill(color, alpha);
        for (const sp of spans) spanRect(g, sp);
        for (const r of rects) bodyRect(g, r);
        g.endFill();
        for (const c of shaped) {
          const off = c.micro ? HALF_TILE : 0;
          drawTrimmedBlock(g, c.corners as Corners, c.x * TILE_SIZE - off, c.y * TILE_SIZE - off,
            HALF_TILE, color, alpha, c.patchOnly);
        }
        opts.setAnimId(requestAnimationFrame(animate));
      } else {
        opts.onEnd();
      }
    };
    opts.setAnimId(requestAnimationFrame(animate));
  }

  /**
   * Flash red on the errors' EVIDENCE (ValidationError.cells — the cells that cause the
   * violation — or, where the cause is an object, `ValidationError.rects`, its drawn body) —
   * quick bright flash that fades out smoothly.
   * Each error flashes on its own grid (`error.grid`); `terrainMode` is the
   * command-type fallback for errors that don't say (-HALF_TILE micro-grid for
   * terrain commands, macro grid for object commands). Deduped across rules.
   */
  private errorGate: ErrorFlashGate | null = null;

  flashErrors(errors: ValidationError[], terrainMode = false): void {
    const cells = resolveErrorFlashCells(errors, terrainMode);
    const rects = resolveErrorFlashRects(errors, terrainMode);
    // A held freehand brush over one forbidden region rejects a command per
    // pointer sample; identical evidence within the cooldown keeps the flash
    // that already played (or just finished) instead of strobing at peak.
    const sig = errorFlashSignature(cells, rects);
    const now = performance.now();
    if (!shouldFlashErrors(this.errorGate, sig, now, animConfig.flash.errorRepeatCooldownMs)) return;
    this.errorGate = { sig, at: now };

    if (this.errorAnimId !== null) {
      cancelAnimationFrame(this.errorAnimId);
      this.errorAnimId = null;
    }
    this.errorGraphics.clear();

    this.flashCells({
      g: this.errorGraphics,
      cells,
      rects,
      color: animConfig.flash.error.color,
      peakAlpha: animConfig.flash.error.peakAlpha,
      durationMs: animConfig.flash.error.durationMs,
      setAnimId: (id) => { this.errorAnimId = id; },
      onEnd: () => { this.errorAnimId = null; },
    });
  }

  private commitGraphics = new PIXI.Graphics();
  private commitAnimId: number | null = null;

  /**
   * Commit-acknowledge flash: one low-amplitude regional pulse over `cells`
   * (`alpha = peak·(1 − t²)`, see animConfig.flash.commit).
   * Latest-wins: a new flash clobbers the prior one, so a burst coalesces into a
   * single beat rather than stacking. Skipped entirely under reduced motion (the
   * cells already show their committed state). `terrainMode` offsets by -HALF_TILE
   * to match micro-grid terrain; objects/tiles pass false. A cell may carry its OWN
   * `micro` instead, for a step that moved terrain and objects at once.
   *
   * The fallback is the TERRAIN grid, and both views state the same one: a bare `MacroCoord`
   * list names grid cells, which is what terrain is drawn on. A caller holding object-anchored
   * cells says so — per cell, or with `terrainMode: false` for a whole list.
   */
  flashCommit(cells: readonly (MacroCoord & { micro?: boolean })[], opts: { color?: number; terrainMode?: boolean } = {}): void {
    if (isMotionReduced() || cells.length === 0) return;
    const { peakAlpha, durationMs, color: defaultColor } = animConfig.flash.commit;
    const color = opts.color ?? defaultColor;

    if (this.commitAnimId !== null) {
      cancelAnimationFrame(this.commitAnimId);   // latest-wins: restart, never stack
      this.commitAnimId = null;
    }

    const fallback = opts.terrainMode ?? true;
    this.flashCells({
      g: this.commitGraphics,
      cells: cells.map(({ x, y, micro }) => ({ x, y, micro: micro ?? fallback })),
      color,
      peakAlpha,
      durationMs,
      setAnimId: (id) => { this.commitAnimId = id; },
      onEnd: () => { this.endCommitFlash(); },
    });
  }

  private endCommitFlash(): void {
    try { this.commitGraphics.clear(); } catch { /* ignore */ }
    this.commitAnimId = null;
  }

  /** The latest ghost request; rebuilt at most once per frame ('clear' erases). */
  private pendingGhost:
    | { kind: 'cells'; cells: MacroCoord[]; paint: GhostPaint; micro: boolean; trim?: readonly TrimmedCell[]; losses?: readonly MacroCoord[] }
    | { kind: 'spans'; spans: RowSpan[]; paint: GhostPaint; micro: boolean; trim?: readonly TrimmedCell[] }
    | 'clear' | null = null;
  private ghostRaf = 0;

  /**
   * Draw semi-transparent fill on cells to show a placement ghost preview.
   * Terrain ghosts are offset by -HALF_TILE to match the intersection-centered rendering.
   * Coalesced to one rebuild per frame: a drag-shape preview arrives once per
   * pointer sample (several per frame under coalesced events), and only the
   * latest matters.
   */
  showGhost(cells: MacroCoord[], paint: GhostPaint, terrainMode = true, trim?: readonly TrimmedCell[], losses?: readonly MacroCoord[]): void {
    this.pendingGhost = { kind: 'cells', cells, paint, micro: terrainMode, trim, losses };
    this.scheduleGhostBuild();
  }

  /**
   * Span-native ghost for analytic drag shapes (rect/circle): a map-size
   * preview arrives as ~one span per ROW, so nothing ever expands to the
   * shape's full cell count. Spans must be per-row merged (the shape builders
   * in tools/paint/shapes guarantee it).
   */
  showGhostSpans(spans: RowSpan[], paint: GhostPaint, terrainMode = true, trim?: readonly TrimmedCell[]): void {
    this.pendingGhost = { kind: 'spans', spans, paint, micro: terrainMode, trim };
    this.scheduleGhostBuild();
  }

  private placementGhost: PIXI.Sprite | null = null;

  /** Point a ghost sprite at one item's ghosted placement. Shared by the single hover-preview
   *  ghost and each member of the group drag ghost. Returns false (and hides `g`) when the item
   *  has no sprite icon (roads) — the plain cell ghost is the only feedback those get. */
  private paintGhostSprite(
    g: PIXI.Sprite, catalogId: string, x: number, y: number, rotation: number, valid: boolean,
  ): boolean {
    const item = getCatalogItem(catalogId);
    const url = item?.icon ? iconUrl(item.icon) : undefined;
    if (!item || !url) { g.visible = false; return false; }
    const tex = PIXI.Texture.from(url);
    g.texture = tex;
    const size = getRotatedSize(item, rotation as Rotation);
    g.anchor.set(0.5);
    g.position.set((x + size.w / 2) * TILE_SIZE, (y + size.h / 2) * TILE_SIZE);
    // Every line below matches how ObjectLayer draws the PLACED sprite, so the preview shows the
    // shape the drop will produce: only a rotatable item turns, and the icon is fitted by ONE
    // scale. Sizing width and height separately would stretch the art to the footprint box.
    g.rotation = item.rotatable ? ((rotation % 360) * Math.PI) / 180 : 0;
    fitSpriteToTexture(g, tex, footprintFit(size.w * TILE_SIZE, size.h * TILE_SIZE), false, this.requestRender);
    g.tint = valid ? 0xffffff : 0xff8a8a;
    return true;
  }

  /** The item's SPRITE riding the ghost cell — placement previews and object
   *  drags show the thing itself, validity-tinted, over the cell wash. Items
   *  without a sprite icon (roads) keep the plain cell ghost. */
  showPlacementGhost(catalogId: string, x: number, y: number, rotation: number, valid: boolean, _elevation: number): void {
    if (!this.placementGhost) {
      this.placementGhost = new PIXI.Sprite();
      this.placementGhost.alpha = 0.65;
      this.container.addChild(this.placementGhost);
    }
    this.paintGhostSprite(this.placementGhost, catalogId, x, y, rotation, valid);
    this.requestRender();
  }

  private dropPlacementGhost(): void {
    if (this.placementGhost) {
      this.placementGhost.visible = false;
      this.requestRender();
    }
  }

  /** Pool of sprites for the group drag ghost — one per member, reused across pointer moves
   *  (a 40-member drag would otherwise create/destroy 40 sprites on every sample). */
  private groupGhosts: PIXI.Sprite[] = [];

  showGroupPlacementGhost(
    members: Array<{ catalogId: string; x: number; y: number; rotation: number; elevation: number }>,
    valid: boolean,
  ): void {
    while (this.groupGhosts.length > members.length) {
      const s = this.groupGhosts.pop()!;
      this.container.removeChild(s);
      s.destroy();
    }
    while (this.groupGhosts.length < members.length) {
      const s = new PIXI.Sprite();
      s.alpha = 0.65;
      this.container.addChild(s);
      this.groupGhosts.push(s);
    }
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      this.paintGhostSprite(this.groupGhosts[i]!, m.catalogId, m.x, m.y, m.rotation, valid);
    }
    this.requestRender();
  }

  private clearGroupPlacementGhost(): void {
    if (this.groupGhosts.length === 0) return;
    for (const s of this.groupGhosts) { this.container.removeChild(s); s.destroy(); }
    this.groupGhosts = [];
    this.requestRender();
  }

  clearGhost(): void {
    this.dropPlacementGhost();
    this.clearGroupPlacementGhost();
    this.pendingGhost = 'clear';
    this.scheduleGhostBuild();
  }

  private scheduleGhostBuild(): void {
    if (this.ghostRaf) return;
    this.ghostRaf = requestAnimationFrame(() => {
      this.ghostRaf = 0;
      const p = this.pendingGhost;
      this.pendingGhost = null;
      if (!p) return;
      this.requestRender();
      try { this.ghostGraphics.clear(); } catch { return; }
      this.previewIcon.visible = false;
      if (p === 'clear') return;
      // A gain-less ghost with something to LOSE still has something to draw (a run that only
      // strips a coating and lays nothing back).
      const empty = p.kind === 'cells' ? p.cells.length === 0 && !(p.losses && p.losses.length > 0) : p.spans.length === 0;
      if (empty) return;
      const offset = p.micro ? HALF_TILE : 0;
      // The preview CARD or a plain wash: the card carries its own paint (see core/runtime/
      // preview-cell), a wash is the content colour the caller named.
      const card = isPreviewCell(p.paint) ? p.paint : null;
      const palette = card ? previewPalette(card) : null;
      const fillColor = palette ? palette.bg : (p.paint as number);
      const fillAlpha = palette ? palette.bgAlpha : GHOST_WASH_ALPHA;

      // 0) the LOSS wash, under the gain: what this shape would replace, drawn first so a cell
      //    that both loses and gains reads as a gain over a loss rather than the reverse.
      if (p.kind === 'cells' && p.losses && p.losses.length > 0) {
        const lossSpans = mergeCellSpans(p.losses.map(({ x, y }) => ({ x, y, micro: p.micro })));
        this.ghostGraphics.beginFill(GHOST_LOSS, 0.32);
        for (const sp of lossSpans) spanRect(this.ghostGraphics, sp);
        this.ghostGraphics.endFill();
      }

      // 1) the translucent background: the card's palette, or a plain ghost's content tint. Kept low
      //    either way so it doesn't hide the terrain underneath. Drawn as merged row spans: a large
      //    drag shape holds tens of thousands of cells, and one rect per cell would tessellate that
      //    many Graphics rects per pointer move.
      // With auto-trim on, the cells whose corners it will cut are drawn one by one in the shape
      // they will actually have, and the rest still merge into spans.
      // Only what the stroke ADDS: a Γ patch's square quadrants are the block underneath it.
      const trim = (p.trim ?? []).map((t) => ({ ...t, corners: filletOnly(t.corners, t.patch) as Corners }));
      const trimmed = new Set(trim.map((t) => `${t.x},${t.y}`));
      const spans: CellSpan[] = p.kind === 'spans'
        ? spansWithout(p.spans, trim).map((sp) => ({ ...sp, micro: p.micro }))
        : mergeCellSpans(p.cells.filter((c) => !trimmed.has(`${c.x},${c.y}`))
          .map(({ x, y }) => ({ x, y, micro: p.micro })));
      // A card over an UNTRIMMED footprint that fills its own bounds is the design's own shape: one
      // rounded rectangle, however many cells it spans. Anything else (an irregular shape, a stroke
      // whose corners auto-trim will cut) keeps the exact silhouette the click will leave, which is
      // what the ghost is for — at this radius the rounding is a pixel and a half.
      const bounds = p.kind === 'spans' ? boundsOfSpans(p.spans) : cellsBounds(p.cells);
      const cellCount = p.kind === 'spans' ? p.spans.reduce((n, s) => n + s.w, 0) : p.cells.length;
      const cardRect = palette && trim.length === 0 && isSolidRect(cellCount, bounds) ? bounds : null;
      this.ghostGraphics.beginFill(fillColor, fillAlpha);
      if (cardRect) this.roundedCardRect(cardRect, offset);
      else for (const sp of spans) spanRect(this.ghostGraphics, sp);
      this.ghostGraphics.endFill();
      for (const t of trim) {
        // A ROAD tile's corners are canonical-state tokens, not quadrants, so it is drawn through
        // the road painter the committed tile goes through — the ghost wears the cut the lay makes.
        if (t.road) {
          drawRoadShape(this.ghostGraphics, t.corners, t.road,
            t.x * TILE_SIZE - offset, t.y * TILE_SIZE - offset, TILE_SIZE, TILE_SIZE, fillColor, fillAlpha);
          continue;
        }
        // `t.patch` picks the INNER fan winding for a Γ fillet — the committed terrain, the flash
        // path above and the 3D ghost all draw it that way; left to default, the fillet fills with
        // the OUTER fan, an outline/fill mismatch on every patched notch in the preview.
        drawTrimmedBlock(this.ghostGraphics, t.corners, t.x * TILE_SIZE - offset, t.y * TILE_SIZE - offset,
          HALF_TILE, fillColor, fillAlpha, t.patch);
      }

      // 1b) the refused state's stripes, over the same footprint the fill just covered.
      if (palette?.hatch !== undefined) {
        const rects: Rect[] = cardRect
          ? [cardRect]
          : [...spans.map((sp) => ({ x: sp.x, y: sp.y, w: sp.w, h: 1 })),
             ...trim.map((t) => ({ x: t.x, y: t.y, w: 1, h: 1 }))];
        this.ghostGraphics.beginFill(palette.hatch, palette.bgAlpha);
        for (const bar of hatchBars(rects)) {
          this.ghostGraphics.drawPolygon(bar.map((v) => v * TILE_SIZE - offset));
        }
        this.ghostGraphics.endFill();
      }

      // 2) a crisp OUTLINE of the footprint's outer boundary so the preview pops even when the fill colour
      //    nearly matches the terrain below (a flat fill alone would vanish over same-coloured mountain/water).
      //    Drawn as a dark halo + a bright white line, so it reads on ANY background. Boundary only (an edge
      //    whose neighbour is outside the set) — no internal grid clutter.
      // The trimmed silhouette when there is one: a cut corner and the Γ patch filling a notch are
      // both part of the shape the click leaves, and an outline drawn round the square footprint
      // would contradict the fill under it. A span ghost materialises only its rim — walking a
      // map-sized span set cell by cell is what the span form exists to avoid — so it hands the
      // outline a membership test for everything inside.
      // A CARD wears the design's own inset line in the palette's colour instead: the halo pair says
      // "a shape is being previewed", and the card already says it with four dots and a glyph.
      if (palette && cardRect) {
        this.ghostGraphics.lineStyle({
          width: PREVIEW_CELL_ART.stroke * TILE_SIZE, color: palette.line, alpha: 1, alignment: 0,
        });
        this.roundedCardRect(cardRect, offset);
        this.ghostGraphics.lineStyle(0);
      } else {
        const rim = p.kind === 'spans' ? shapeOfSpans(p.spans).rim : p.cells;
        const inShape = p.kind === 'spans' ? spanMembership(p.spans) : undefined;
        // Roads have their own silhouette machinery: a cut road is a polygon, not a set of quadrants.
        // A ghost lays ONE surface, so a payload is all road or all terrain.
        const roadTrim = trim.filter((t): t is typeof t & RoadTrimmedGhostCell => !!t.road);
        const edges: EdgeSegment[] = trim.length === 0
          ? (p.kind === 'spans' ? boundaryEdgesFromSpans(p.spans) : boundaryEdges(p.cells))
          : roadTrim.length > 0
            ? roadTrimmedOutline(rim, roadTrim, inShape)
            : trimmedOutline(rim, trim, inShape);
        const stroke = (width: number, col: number, alpha: number) => {
          this.ghostGraphics.lineStyle(width, col, alpha);
          for (const e of edges) {
            this.ghostGraphics.moveTo(e.ax * TILE_SIZE - offset, e.ay * TILE_SIZE - offset);
            this.ghostGraphics.lineTo(e.bx * TILE_SIZE - offset, e.by * TILE_SIZE - offset);
          }
        };
        if (palette) {
          stroke(PREVIEW_CELL_ART.stroke * TILE_SIZE, palette.line, 1);
        } else {
          stroke(4, 0x000000, 0.4);   // dark halo (reads on light terrain)
          stroke(1.75, 0xffffff, 0.95); // bright core (reads on dark terrain)
        }
        this.ghostGraphics.lineStyle(0);
      }

      if (palette && bounds) this.paintCardMarks(card!, palette, bounds, offset);
    });
  }

  /** The card's background outline: the footprint as one rounded rect on its grid. */
  private roundedCardRect(b: Rect, offset: number): void {
    this.ghostGraphics.drawRoundedRect(
      b.x * TILE_SIZE - offset, b.y * TILE_SIZE - offset,
      b.w * TILE_SIZE, b.h * TILE_SIZE, PREVIEW_CELL_ART.radius * TILE_SIZE,
    );
  }

  /** The card's four corner dots and its centre glyph — the two parts that do NOT stretch with the
   *  footprint (see core/runtime/preview-cell). */
  private paintCardMarks(card: PreviewCell, palette: PreviewPalette, bounds: Rect, offset: number): void {
    this.ghostGraphics.beginFill(palette.line, 1);
    for (const dot of previewDots(bounds)) {
      this.ghostGraphics.drawCircle(dot.x * TILE_SIZE - offset, dot.y * TILE_SIZE - offset, dot.r * TILE_SIZE);
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
      (bounds.x + bounds.w / 2) * TILE_SIZE - offset, (bounds.y + bounds.h / 2) * TILE_SIZE - offset,
    );
    this.previewIcon.visible = true;
  }

  private lastSelKey = '';
  private selAnimId: number | null = null;

  /** Brief scale-pop of the selection ring when a NEW block is selected —
   *  scales the selectionGraphics around the ring's center. Skipped under
   *  reduced motion. */
  private popSelection(cx: number, cy: number, spanPx: number): void {
    if (isMotionReduced()) return;
    if (this.selAnimId !== null) { cancelAnimationFrame(this.selAnimId); this.selAnimId = null; }
    const g = this.selectionGraphics;
    g.pivot.set(cx, cy);
    g.position.set(cx, cy);
    const amp = selectionPopAmplitude(spanPx);
    const { durationMs } = animConfig.selectionPop;
    const start = performance.now();
    const animate = () => {
      this.requestRender();
      const t = Math.min((performance.now() - start) / durationMs, 1);
      g.scale.set(1 - amp + amp * easeOutBack(t));
      if (t < 1) {
        this.selAnimId = requestAnimationFrame(animate);
      } else {
        g.scale.set(1, 1); g.pivot.set(0, 0); g.position.set(0, 0);
        this.selAnimId = null;
      }
    };
    this.selAnimId = requestAnimationFrame(animate);
  }

  private lastHoverKey = '';

  /**
   * The hover-preview box: what a click would select right now (the
   * hovered object's footprint, or a 1×1 terrain cell). Same grid semantics as
   * showSelection (terrainMode = micro-grid offset). Keyed so a stationary
   * hover — mousemove fires per pixel — doesn't rebuild or re-render.
   */
  showHover(x: number, y: number, w = 1, h = 1, terrainMode = false): void {
    const key = `${x},${y},${w},${h},${terrainMode ? 1 : 0}`;
    if (key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    const offset = terrainMode ? HALF_TILE : 0;
    this.hoverRect = { x: x * TILE_SIZE - offset, y: y * TILE_SIZE - offset, w: w * TILE_SIZE, h: h * TILE_SIZE };
    this.drawHover();
  }

  private hoverRect: WorldRect | null = null;

  private drawHover(): void {
    this.requestRender();
    try { this.hoverGraphics.clear(); } catch { return; }
    const r = this.hoverRect;
    if (!r) return;
    const k = 1 / this.viewZoom;
    this.hoverGraphics.lineStyle(HOVER_STROKE * k, SELECTION_EDGE, HOVER_EDGE_ALPHA);
    this.hoverGraphics.beginFill(HOVER_FILL, HOVER_FILL_ALPHA);
    this.hoverGraphics.drawRoundedRect(r.x, r.y, r.w, r.h, HOVER_RADIUS * k);
    this.hoverGraphics.endFill();
  }

  clearHover(): void {
    if (!this.lastHoverKey) return;
    this.lastHoverKey = '';
    this.hoverRect = null;
    this.requestRender();
    try { this.hoverGraphics.clear(); } catch { /* torn down mid-frame */ }
  }

  /**
   * Mark a selection at (x, y) with optional width and height: corner brackets around one member,
   * a ring per member plus brackets around the whole of a group. A terrain cell or a lone road
   * (`exact`) is regular, so it gets its exact outline instead. If elevation is provided, a label
   * is drawn at the bottom-left corner. Terrain blocks render on the micro-grid (offset by
   * -HALF_TILE), so pass terrainMode=true to match their pixel position; objects use the macro-grid.
   *
   * `append` adds a member to the marks already drawn this paint instead of starting over: a GROUP
   * selection is one `clearSelection()` up front, then one `append` call per member. Each append
   * costs one ring and one redraw of the group brackets. An appended member skips the entrance pop
   * and the elevation label.
   */
  showSelection(x: number, y: number, w = 1, h = 1, elevation?: number, terrainMode = false, append = false, exact = false): void {
    this.requestRender();
    const offset = terrainMode ? HALF_TILE : 0;
    const rect = { x: x * TILE_SIZE - offset, y: y * TILE_SIZE - offset, w: w * TILE_SIZE, h: h * TILE_SIZE };
    if (!append) {
      this.selectionRects = [rect];
      this.selectionUnion = rect;
      this.selectionExact = terrainMode || exact;
      this.drawSelectionMarks();
    } else {
      const u = this.selectionUnion ?? rect;
      const x0 = Math.min(u.x, rect.x), y0 = Math.min(u.y, rect.y);
      this.selectionUnion = { x: x0, y: y0, w: Math.max(u.x + u.w, rect.x + rect.w) - x0, h: Math.max(u.y + u.h, rect.y + rect.h) - y0 };
      this.selectionRects.push(rect);
      // The second member turns the first one's brackets into a ring; after that each append adds one.
      if (this.selectionRects.length === 2) this.drawSelectionMarks();
      else { this.drawRing(rect); this.drawGroupFrame(); }
      return;
    }
    // Pop only when a NEW selection appears (not on a re-paint of the same one,
    // e.g. after rotating the selected object).
    const selKey = `${x},${y},${w},${h},${offset}`;
    if (selKey !== this.lastSelKey) {
      this.lastSelKey = selKey;
      this.popSelection(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(w, h) * TILE_SIZE);
    }

    if (this.selectionLabel) {
      this.selectionLabel.parent?.removeChild(this.selectionLabel);
      this.selectionLabel.destroy();
      this.selectionLabel = null;
    }
    if (elevation !== undefined) {
      const label = new PIXI.Text(String(elevation), {
        fontSize: 16, fontWeight: 'bold', fontFamily: APP_FONT_FAMILY,
        fill: SELECTION_CREAM, stroke: SELECTION_EDGE, strokeThickness: 3,
      });
      label.x = x * TILE_SIZE + 3 - offset;
      label.y = (y + h) * TILE_SIZE - 3 - offset;
      label.anchor.set(0, 1);
      this.selectionLabel = label;
      this.container.addChild(label);
    }
  }

  /** The view's zoom (screen px per world px). Marks keep their screen size, so a real change redraws them. */
  setViewZoom(zoom: number): void {
    if (!(zoom > 0) || Math.abs(zoom - this.viewZoom) / this.viewZoom < 0.03) return;
    this.viewZoom = zoom;
    if (this.planetFrame) this.drawPlanetFrame();
    if (this.review) this.drawReview();
    if (this.selectionRects.length) { this.drawSelectionMarks(); this.requestRender(); }
    if (this.hoverRect) this.drawHover();
  }

  private drawSelectionMarks(): void {
    try { this.selectionGraphics.clear(); this.selectionFrame.clear(); } catch { return; }
    if (this.selectionRects.length === 1) {
      if (this.selectionExact) this.drawOutline(this.selectionRects[0]!);
      else this.drawBrackets(this.selectionGraphics, this.selectionRects[0]!, MARK_PAD);
      return;
    }
    for (const r of this.selectionRects) this.drawRing(r);
    this.drawGroupFrame();
  }

  private drawGroupFrame(): void {
    try { this.selectionFrame.clear(); } catch { return; }
    if (this.selectionUnion) this.drawBrackets(this.selectionFrame, this.selectionUnion, MARK_GROUP_PAD);
  }

  private drawBrackets(g: PIXI.Graphics, r: WorldRect, padPx: number): void {
    const k = 1 / this.viewZoom, pad = padPx * k;
    const x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad;
    const arm = Math.max(MARK_ARM_MIN * k, Math.min(MARK_ARM_MAX * k, Math.min(w, h) / 3));
    const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]];
    for (const [width, color, alpha] of [[MARK_EDGE * k, SELECTION_EDGE, SELECTION_EDGE_ALPHA], [MARK_STROKE * k, SELECTION_CREAM, 1]] as const) {
      g.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      for (const [cx, cy, sx, sy] of corners) {
        g.moveTo(cx, cy + sy * arm); g.lineTo(cx, cy); g.lineTo(cx + sx * arm, cy);
      }
    }
  }

  /** The exact outline of a regular cell, in the marks' treatment. */
  private drawOutline(r: WorldRect): void {
    const k = 1 / this.viewZoom, g = this.selectionGraphics;
    for (const [width, color, alpha] of [[MARK_EDGE * k, SELECTION_EDGE, SELECTION_EDGE_ALPHA], [MARK_STROKE * k, SELECTION_CREAM, 1]] as const) {
      g.lineStyle({ width, color, alpha, join: PIXI.LINE_JOIN.ROUND });
      g.drawRect(r.x, r.y, r.w, r.h);
    }
  }

  private drawRing(r: WorldRect): void {
    const k = 1 / this.viewZoom, g = this.selectionGraphics;
    const radius = Math.max(4 * k, Math.min(r.w, r.h) / 2 + k);
    g.lineStyle({ width: 4 * k, color: SELECTION_EDGE, alpha: SELECTION_EDGE_ALPHA });
    g.drawCircle(r.x + r.w / 2, r.y + r.h / 2, radius);
    g.lineStyle({ width: 2 * k, color: SELECTION_CREAM, alpha: 1 });
    g.drawCircle(r.x + r.w / 2, r.y + r.h / 2, radius);
  }

  /**
   * Clear the selection rectangle and any elevation label.
   */
  clearSelection(): void {
    this.requestRender();
    this.selectionRects = [];
    this.selectionUnion = null;
    try { this.selectionGraphics.clear(); this.selectionFrame.clear(); } catch { /* ignore */ }
    this.lastSelKey = '';
    if (this.selectionLabel) {
      this.selectionLabel.parent?.removeChild(this.selectionLabel);
      this.selectionLabel.destroy();
      this.selectionLabel = null;
    }
  }

  private buildableGraphics = new PIXI.Graphics();
  private buildableAdded = false;
  private regionDimensions: PIXI.Container | null = null;

  showBuildableRegion(cells: MacroCoord[], terrainMode: boolean, dimensionScale?: number): void {
    this.regionDimensions?.destroy({ children: true });
    this.regionDimensions = null;
    const bounds = dimensionScale === undefined ? null : cellEdges(cells);
    if (bounds && dimensionScale !== undefined) {
      this.regionDimensions = dimensionBody(dimensionDrawing(bounds, dimensionScale), '#ffffff', dimensionScale);
      if (!terrainMode) this.regionDimensions.position.set(HALF_TILE, HALF_TILE);
      this.container.addChild(this.regionDimensions);
    }
    this.requestRender();
    if (!this.buildableAdded) {
      this.container.addChildAt(this.buildableGraphics, 0);
      this.buildableAdded = true;
    }
    try { this.buildableGraphics.clear(); } catch { /* ignore */ }

    if (cells.length === 0) return;

    this.buildableGraphics.beginFill(0xffffff, 0.24);
    for (const { x, y } of cells) cellRect(this.buildableGraphics, x, y, terrainMode);
    this.buildableGraphics.endFill();
    const offset = terrainMode ? HALF_TILE : 0;
    const edges = boundaryEdges(cells);
    for (const [width, color, alpha] of [[4, hexStringToNumber(FRAME_INK), 0.55], [1.75, 0xffffff, 0.95]] as const) {
      this.buildableGraphics.lineStyle(width, color, alpha);
      for (const edge of edges) {
        this.buildableGraphics.moveTo(edge.ax * TILE_SIZE - offset, edge.ay * TILE_SIZE - offset);
        this.buildableGraphics.lineTo(edge.bx * TILE_SIZE - offset, edge.by * TILE_SIZE - offset);
      }
    }
    this.buildableGraphics.lineStyle();
  }

  clearBuildableRegion(): void {
    this.regionDimensions?.destroy({ children: true });
    this.regionDimensions = null;
    this.requestRender();
    this.endRegionPulse();
    try { this.buildableGraphics.clear(); } catch { /* ignore */ }
  }

  private regionPulseAnim: number | null = null;

  /**
   * The standing region dipping once and coming back (`panel.region.pulse`, whose numbers the
   * caller passes in — the registry is the one place a duration is declared).
   *
   * A DIP RATHER THAN A NEW MARK. The outline is already on the map; what says "this is why the
   * edit was refused" is that same line breathing, not something arriving beside it. `sin` gives
   * both ends at rest with the trough at the middle, so the beat has no seam at either edge.
   *
   * UNDER REDUCED MOTION IT LANDS ON THE END STATE and nothing runs: the region is still drawn, and
   * the refusal has its own row in the record saying the same thing in words.
   */
  pulseBuildableRegion(durationMs: number, dip: number): void {
    this.endRegionPulse();
    this.requestRender();
    if (isMotionReduced()) return;
    const start = performance.now();
    const step = () => {
      this.requestRender();
      const t = Math.min((performance.now() - start) / durationMs, 1);
      this.buildableGraphics.alpha = 1 - dip * Math.sin(Math.PI * t);
      if (t < 1) { this.regionPulseAnim = requestAnimationFrame(step); return; }
      this.endRegionPulse();
    };
    this.regionPulseAnim = requestAnimationFrame(step);
  }

  private endRegionPulse(): void {
    if (this.regionPulseAnim !== null) cancelAnimationFrame(this.regionPulseAnim);
    this.regionPulseAnim = null;
    this.buildableGraphics.alpha = 1;
  }

  private planetFrame: PlanetFrame | null = null;
  private planetFrameGraphics = new PIXI.Graphics();
  /** The same dashes in the warning tint, faded in and out over the ink by a flash. */
  private planetFrameFlash = new PIXI.Graphics();
  private planetFlashAnim: number | null = null;

  showPlanetFrame(frame: PlanetFrame | null): void {
    this.planetFrame = frame;
    this.drawPlanetFrame();
  }

  /** Dash widths are screen px, so the frame redraws as the zoom moves. */
  private drawPlanetFrame(): void {
    this.requestRender();
    const ink = this.planetFrameGraphics, flash = this.planetFrameFlash;
    try { ink.clear(); flash.clear(); } catch { return; }
    if (!this.planetFrame) { this.endPlanetFlash(); return; }
    const rects = planetFrameRects(this.planetFrame, chunkStrokeCells(this.viewZoom * TILE_SIZE));
    for (const [g, color, alpha] of [[ink, CHUNK_GRID_STYLE.planetFrame.ink, CHUNK_GRID_STYLE.planetFrame.opacity], [flash, GHOST_LOSS, 1]] as const) {
      g.beginFill(color, alpha);
      for (const r of rects) g.drawRect(r.x * TILE_SIZE, r.y * TILE_SIZE, r.width * TILE_SIZE, r.height * TILE_SIZE);
      g.endFill();
    }
  }

  /**
   * The warning tint rising over the frame and falling away once (`sin`, so both ends are at rest).
   * Under reduced motion nothing runs: the frame itself still shows where the planet ends.
   */
  flashPlanetFrame(durationMs: number): void {
    if (!this.planetFrame || this.planetFlashAnim !== null || isMotionReduced()) return;
    const start = performance.now();
    const step = () => {
      this.requestRender();
      const t = Math.min((performance.now() - start) / durationMs, 1);
      this.planetFrameFlash.alpha = Math.sin(Math.PI * t);
      if (t < 1) { this.planetFlashAnim = requestAnimationFrame(step); return; }
      this.endPlanetFlash();
    };
    this.planetFlashAnim = requestAnimationFrame(step);
  }

  /** Ends a running frame flash; the renderer calls it on teardown so no frame outlives it. */
  endPlanetFlash(): void {
    if (this.planetFlashAnim !== null) cancelAnimationFrame(this.planetFlashAnim);
    this.planetFlashAnim = null;
    this.planetFrameFlash.alpha = 0;
  }

  private reviewGraphics = new PIXI.Graphics();
  private reviewAdded = false;
  private review: { cells: readonly MacroCoord[]; landmark: Rect | null } | null = null;

  /** The cells to check in the route's yellow with an ink edge, and the landmark's footprint
   *  outlined alone. Strokes keep their screen width, and a cell drawn smaller than
   *  `REVIEW_MIN_PX` on screen grows about its centre to it, so a lone cell can be found on a
   *  whole-planet view. Ground cells and the landmark both stand on the macro grid. */
  showReviewCells(cells: readonly MacroCoord[] | null, landmark: Rect | null): void {
    this.review = cells ? { cells, landmark } : null;
    this.drawReview();
  }

  private drawReview(): void {
    this.requestRender();
    if (!this.reviewAdded) {
      this.container.addChildAt(this.reviewGraphics, this.container.getChildIndex(this.planetFrameGraphics));
      this.reviewAdded = true;
    }
    const g = this.reviewGraphics;
    try { g.clear(); } catch { return; }
    if (!this.review) return;
    const { cells, landmark } = this.review;
    const k = 1 / this.viewZoom;
    const side = Math.max(TILE_SIZE, REVIEW_MIN_PX * k);
    const inset = (TILE_SIZE - side) / 2;
    for (const [width, color, alpha] of [[REVIEW_EDGE * k, hexStringToNumber(FRAME_INK), 0.7], [REVIEW_LINE * k, ROUTE_TINT, 1]] as const) {
      g.lineStyle(width, color, alpha);
      if (landmark) g.drawRect(landmark.x * TILE_SIZE, landmark.y * TILE_SIZE, landmark.w * TILE_SIZE, landmark.h * TILE_SIZE);
    }
    g.lineStyle(REVIEW_LINE * k, hexStringToNumber(FRAME_INK), 0.7);
    g.beginFill(ROUTE_TINT, 0.55);
    for (const { x, y } of cells) g.drawRect(x * TILE_SIZE + inset, y * TILE_SIZE + inset, side, side);
    g.endFill();
    g.lineStyle();
  }

  private routeGraphics = new PIXI.Graphics();
  private routeAdded = false;

  showCurveFootprint(cells: MacroCoord[], terrainGrid: boolean): void {
    this.curveGraphics.clear();
    this.curveGraphics.beginFill(CURVE_FOOTPRINT.color, CURVE_FOOTPRINT.alpha);
    for (const { x, y } of cells) cellRect(this.curveGraphics, x, y, terrainGrid);
    this.curveGraphics.endFill();
    this.requestRender();
  }

  clearCurveFootprint(): void {
    this.curveGraphics.clear();
    this.requestRender();
  }

  /** The maze's answer, in the chosen-card yellow: solid enough to read as a path, translucent
   *  enough that the ground it walks stays visible. ON THE TERRAIN GRID, deliberately: the walls
   *  render at −HALF_TILE, so the visible corridor floor between two walls IS the corridor cell's
   *  terrain-shifted rect, and the macro rect would put half the wash under the walls. */
  showRoute(cells: MacroCoord[]): void {
    this.requestRender();
    if (!this.routeAdded) {
      this.container.addChildAt(this.routeGraphics, this.buildableAdded ? 1 : 0);
      this.routeAdded = true;
    }
    try { this.routeGraphics.clear(); } catch { /* ignore */ }
    if (cells.length === 0) return;
    this.routeGraphics.beginFill(ROUTE_TINT, 0.55);
    for (const { x, y } of cells) cellRect(this.routeGraphics, x, y, true);
    this.routeGraphics.endFill();
  }

  clearRoute(): void {
    this.requestRender();
    try { this.routeGraphics.clear(); } catch { /* ignore */ }
  }

  /** The Ctrl+drag rubber band: a translucent fill + dashed outline over the raw
   *  macro rect (no terrain shift — a band only ever selects objects). */
  showBand(rect: MacroRect): void {
    this.requestRender();
    try { this.bandGraphics.clear(); } catch { return; }
    const x = rect.x * TILE_SIZE, y = rect.y * TILE_SIZE, w = rect.w * TILE_SIZE, h = rect.h * TILE_SIZE;
    this.bandGraphics.beginFill(BAND_COLOR, 0.06);
    this.bandGraphics.drawRect(x, y, w, h);
    this.bandGraphics.endFill();
    dashedRect(this.bandGraphics, x, y, w, h);
  }

  clearBand(): void {
    this.requestRender();
    try { this.bandGraphics.clear(); } catch { /* ignore */ }
  }
}
