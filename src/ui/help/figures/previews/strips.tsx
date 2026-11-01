/** Inert previews reuse the editor controls and shelf cards. */
import { INERT, PreviewFrame } from './PreviewFrame';
import type { BuildShape, BuildTool } from '../../../../state/editing/edit-mode';
import { getCatalogItem } from '../../../../state/catalog';
import { sandboxArming } from '../../../../editor/sandbox/demo-world';
import { ScaleProvider } from '../../../design/scale';
import { PLATE_BAND, QUAD, SHELF_SCALE } from '../../../shell/units';
import { ObjectShelf } from '../../../shell/bars/objects/ObjectShelf';
import { ShelfBand } from '../../../shell/bars/ShelfBand';
import { AutoTrim } from '../../../shell/bars/terrain/AutoTrim';
import { TerrainRow } from '../../../shell/bars/terrain/TerrainBar';
import { BrushSizeControl } from '../../../shell/bars/BrushSizeControl';
import { TOOL_CELLS } from '../../../shell/bars/terrain-cells';
import { BUILD_SHAPES } from '../../../../state/editing/edit-mode';
import type { ContentType } from '../../../../state/editing/edit-mode';
import { ItemCard, SmartCard } from '../../../shell/bars/objects/ItemCard';


const noop = () => {};

const STRIP_GAP = 8;

/** The tool row's inputs when nothing in `TOOL_CELLS` matches the posed `active` id: no tool armed. */
const NOTHING_ARMED: { tool: BuildTool; shape?: BuildShape } = { tool: 'none' };

/** The size a figure's tools draw at until a beat poses another (`SandboxWorld.pick`), and the
 *  eraser footprint its eraser takes, so the pictured row agrees with the stroke. */
const FIGURE_BRUSH_SIZE = sandboxArming().brushSize;
const FIGURE_ERASER_SHAPE = sandboxArming().eraserShape;

/**
 * The terrain toolbar's own row (`TerrainBar.tsx:TerrainRow`), the scene's tool posed active: the
 * same `QUAD` layout, pitch math and armed/sized dimming the live bar computes, so the figure cannot
 * drift from it. It draws in frame px; the figure stands it on its map at the live frame zoom.
 */
export function TerrainToolsStrip({ active, surface = 'mountain', size, fill }: {
  active: string; surface?: ContentType; size?: number;
  /** The least width the row stands in, so its centring spans the figure's map as the bar spans the window. */
  fill?: number;
}) {
  const posed = TOOL_CELLS.find((cell) => cell.id === active)?.shows ?? NOTHING_ARMED;
  return (
    <div
      aria-hidden
      {...INERT}
      style={{
        display: 'flex', justifyContent: 'center',
        // The row stands over the figure's map as the live bar stands over the map, its names in
        // the bar's own plateless outline (`BarText`'s `onMap`).
        pointerEvents: 'none', userSelect: 'none', padding: `6px ${QUAD.left}px ${QUAD.bottom}px`,
        width: 'fit-content', minWidth: fill, boxSizing: 'border-box',
      }}
    >
      <TerrainRow
        surface={surface}
        activeTool={posed.tool}
        activeShape={posed.shape ?? 'free'}
        eraserShape={FIGURE_ERASER_SHAPE}
        sizeControl={<BrushSizeControl value={size ?? FIGURE_BRUSH_SIZE} onChange={noop}/>}
        onSelect={noop}
      />
    </div>
  );
}

/** A row of the shelf's own cards standing up out of the shelf's own dark band, the way the
 *  bottom bar draws them. `selected` is the card the demo pointer has picked up; `counts` feeds
 *  the cards' placed badges from the demo world. */
export function ShelfStrip({ items, smart = false, selected = null, counts = null, fill }: {
  items: readonly string[];
  /** The least width the band spans, the figure's map, as the shelf's band spans the window. */
  fill?: number;
  /** Lead the row with the smart-planting card, the way the live trees and plants tabs do.
   *  The card is strip index 0 and the items follow at 1.. */
  smart?: boolean;
  selected?: number | null;
  counts?: ReadonlyMap<string, number> | null;
}) {
  const lead = smart ? 1 : 0;
  return (
    <div
      aria-hidden
      {...INERT}
      style={{
        position: 'relative',
        display: 'flex', gap: STRIP_GAP, justifyContent: 'center', alignItems: 'flex-end',
        pointerEvents: 'none', userSelect: 'none',
        padding: '8px 22px 10px', minWidth: fill, boxSizing: 'border-box',
      }}
    >
      {/* Sized to just the band's own visible top (`units.ts:PLATE_BAND.top`), so `overflow:
          hidden` crops the band's off-screen corners the way the window's real edges do, without
          cutting into the cards standing taller above it. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: PLATE_BAND.top, overflow: 'hidden' }}>
        <ShelfBand />
      </div>
      <ScaleProvider value={SHELF_SCALE}>
        {smart && (
          <div data-strip-card style={{ position: 'relative' }}>
            <SmartCard selected={selected === 0} onToggle={noop} onReach={noop} />
          </div>
        )}
        {items.map((id, i) => {
          const item = getCatalogItem(id);
          if (!item) return null;
          return (
            <div key={id} data-strip-card style={{ position: 'relative' }}>
              <ItemCard item={item} placed={counts?.get(id) ?? 0} selected={i + lead === selected} onToggle={noop} onReach={noop} carries={false} />
            </div>
          );
        })}
      </ScaleProvider>
    </div>
  );
}

/* ── the object shelf, whole: band, tabs, search and the card row ─────────── */

/** The real shelf standing over the visitor's own map, as object mode opens it: its tab names are
 *  drawn in the outline the map reads through, so the map stands behind them here too. */
export function ShelfOverMap({ query, height = 371 }: { query?: string; height?: number }) {
  return (
    <PreviewFrame height={height} align="top" onMap>
      <ObjectShelf {...(query !== undefined ? { posedQuery: query } : {})} />
    </PreviewFrame>
  );
}

/** The three corner profiles share one selector. */
export function AutoTrimModesPreview() {
  return <PreviewFrame height={110} onMap><AutoTrim value="rect" disabled={false} onChange={noop}/></PreviewFrame>;
}

/** The slot a tool cell stands in on the live row: the brush, eraser and trim pills by their slot
 *  ids, a shape by its place in the shape pill. */
const PILL_SLOT: Record<string, string> = { draw: 'brush', erase: 'eraser', trim: 'trim' };

/** The element of strip card `i`: a shelf card, or the bar cell `TOOL_CELLS[i]` presses. */
export function stripCardElement(strip: HTMLElement, kind: 'tools' | 'shelf', i: number): Element | null {
  if (kind === 'shelf') return strip.querySelectorAll('[data-strip-card]')[i] ?? null;
  const cell = TOOL_CELLS[i];
  if (!cell) return null;
  const slot = PILL_SLOT[cell.id];
  if (slot) return strip.querySelector(`[data-toolbar-slot="${slot}"] button`) ?? strip.querySelector(`[data-toolbar-slot="${slot}"]`);
  const shape = cell.shows.shape;
  const at = shape ? BUILD_SHAPES.indexOf(shape) : -1;
  return at < 0 ? null : strip.querySelectorAll('[data-toolbar-slot="shape"] button')[at] ?? null;
}
