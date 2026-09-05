/*
 * strips.tsx — the slices of real interface a demo figure stands beside.
 *
 * A scene that talks about the toolbar or the shelf shows the REAL cells and cards, inert: the
 * toolbar strip is the bar's own `TerrainRow` (real glyphs, real plates, live keybinding badges,
 * live auto-trim/eraser-shape chips) with the scene's tool posed, and the shelf strip is a row of
 * real `ItemCard`s standing on the shelf's own `ShelfBand`, for the pieces the scene places. Both
 * render under `pointer-events: none` + `inert` so nothing arms.
 */
import type { HTMLAttributes } from 'react';
import { PreviewFrame } from './PreviewFrame';
import type { BuildShape, BuildTool } from '../../../../../../core/model/edit-mode';
import { ELEVATION_COLORS } from '../../../../../../core/model/constants';
import { getCatalogItem } from '../../../../../../state/catalog';
import { useEditorStore } from '../../../../../../state/store';
import { ScaleProvider } from '../../../../../design/scale';
import { PLATE_BAND, QUAD, SHELF_SCALE } from '../../../../../shell/units';
import { ObjectShelf, ShelfBand } from '../../../../../shell/bars/ObjectShelf';
import { SettingChip } from '../../../../../shell/bars/SettingChip';
import { EC_STATE_KEY, edgeCutGlyph } from '../../../../../shell/bars/edge-cut-glyph';
import { useT } from '../../../../../../i18n/context';
import { TerrainRow } from '../../../../../shell/bars/TerrainBar';
import { TOOL_CELLS, type TerrainSurface } from '../../../../../shell/bars/terrain-cells';
import { ItemCard, SmartCard } from '../../../../../shell/bars/ItemCard';

const INERT = { inert: '' } as unknown as HTMLAttributes<HTMLDivElement>;

const noop = () => {};

const STRIP_GAP = 8;

/** The tool row's own inputs when nothing named in `TOOL_CELLS` matches the posed `active` id: the
 *  hand, with nothing armed, which is the row's own honest picture of "nothing chosen". */
const NOTHING_ARMED: { tool: BuildTool; shape?: BuildShape } = { tool: 'none' };

/**
 * The terrain toolbar's own row (`TerrainBar.tsx:TerrainRow`), the scene's tool posed active: the
 * same QUAD layout, pitch math and armed/sized dimming the live bar computes, so the figure cannot
 * drift from it. Drawn smaller than the live bar so the map stays the figure's subject.
 */
export function TerrainToolsStrip({ active, surface = 'mountain', size }: { active: string; surface?: TerrainSurface; size?: number }) {
  const eraserShape = useEditorStore((s) => s.eraserShape);
  const posed = TOOL_CELLS.find((cell) => cell.id === active)?.edit ?? NOTHING_ARMED;
  return (
    <div
      aria-hidden
      {...INERT}
      style={{
        display: 'flex', justifyContent: 'center',
        pointerEvents: 'none', userSelect: 'none', padding: `6px 12px ${QUAD.bottom}px`,
        // The figure has no map under it: a flat fill stands in for the ground the row floats
        // over. No radius, no shadow — the live bar wears neither, and the active cell's name
        // stands directly on it in the bar's own plateless outline (`ToolCell.tsx`'s `MAP_LABEL`).
        background: ELEVATION_COLORS[0], width: 'fit-content',
        zoom: 0.72,
      }}
    >
      <TerrainRow
        surface={surface}
        activeTool={posed.tool}
        activeShape={posed.shape ?? 'free'}
        eraserShape={eraserShape}
        brushSize={size ?? 3}
        onBrushSize={noop}
        onSelect={noop}
      />
    </div>
  );
}

/** A row of the shelf's own cards standing up out of the shelf's own dark band, the way the
 *  bottom bar draws them. `selected` is the card the demo pointer has picked up; `counts` feeds
 *  the cards' placed badges from the demo world. */
export function ShelfStrip({ items, smart = false, selected = null, counts = null }: {
  items: readonly string[];
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
        padding: '8px 22px 10px',
        // The strip is a glimpse of the shelf, not the shelf: drawn smaller than the bar so the
        // map stays the figure's subject.
        zoom: 0.72,
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
              <ItemCard item={item} placed={counts?.get(id) ?? 0} selected={i + lead === selected} onToggle={noop} onReach={noop} />
            </div>
          );
        })}
      </ScaleProvider>
    </div>
  );
}

/* ── the object shelf, whole: band, tabs, search and the card row ─────────── */

/** The real shelf as object mode opens it, reading the visitor's own map for its placed counts. */
export function ObjectShelfPreview() {
  return (
    <PreviewFrame height={230} zoom={0.62} align="top">
      <ObjectShelf />
    </PreviewFrame>
  );
}

/* ── the auto-trim chip's three faces, side by side ───────────────────────── */

/** The chip that rides the brush cell, posed at each of its three states: the same glyph table
 *  and state words the live chip cycles through. */
export function AutoTrimModesPreview() {
  const t = useT();
  const modes = ['off', 'rect', 'round'] as const;
  return (
    <PreviewFrame height={130}>
      <div style={{ display: 'flex', gap: 26, alignItems: 'center' }}>
        {modes.map((m) => (
          <SettingChip
            key={m}
            state={m}
            name={t(EC_STATE_KEY[m])}
            label={t('edgecut.auto')}
            on={m !== 'off'}
            glyph={(size, color) => edgeCutGlyph(m, size, color)}
            onCycle={() => {}}
          />
        ))}
      </div>
    </PreviewFrame>
  );
}
