/*
 * ChunkLoadWindow.tsx — every region of the map and what it carries.
 *
 * The corner disc reads ONE region, the one under the pointer, which is the right thing to watch
 * while building and the wrong thing for "where is there room". So the press opens this: the whole
 * island as a grid of its regions, each named the way the map itself names it (row letter down the
 * left, column number along the bottom, so "B4" here is "B4" there).
 *
 * A GRID, NOT A TABLE. The question is spatial, and a list sorted by name is a list of names: the
 * regions are laid out where they are, so a crowded corner of the island looks like a crowded
 * corner. Empty regions are drawn too, for the same reason: a table of only the regions holding
 * something would have no map in it.
 *
 * A tint alone cannot carry a reading that is usually a few percent of the limit, so each region
 * gets a bar as well as its figure. The one under the pointer wears the interface's yellow, which
 * is what ties the window to the disc that opened it.
 *
 * It is a WINDOW, so it is mounted by `Windows` outside the frame's own page zoom and reads its
 * open state from the store like every other one. Mounted inside the frame it would be zoomed twice
 * and would stack against the bars rather than over them.
 */
import { useRef } from 'react';
import { useT } from '../../../i18n/context';
import { getMapStats } from '../../../state/map-stats';
import { useEditorStore } from '../../../state/store';
import { ModalShell } from '../../primitives/ModalShell';
import { useScrollFade } from '../../primitives/scroll-fade';
import { allChunkLoads, chunksAcross, CHUNK_LOAD_MAX, getPointerRegion } from './map-load';
import { ACTIVE, INSET, LOAD_FILL, PLATE_INK, TRACK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';

/** One region's tile, in css px. Wide enough for a five-figure load at the `small` rung, and small
 *  enough that a real map's eleven columns fit a window without scrolling sideways. */
const TILE = { w: 56, h: 46, gap: 4, radius: 8, bar: 5 } as const;

export function ChunkLoadWindow() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.regionLoad);
  const setModal = useEditorStore((s) => s.setModal);
  const gridState = useEditorStore((s) => s.gridState);

  const width = gridState?.template.width ?? 0;
  const height = gridState?.template.height ?? 0;
  // Read while the window is up and not before: the stats are a live view mutated in place, so what
  // makes this current is that it is derived at the moment the window renders.
  const regions = open && gridState ? allChunkLoads(getMapStats(gridState), width, height) : [];
  const current = getPointerRegion();
  const gridRef = useRef<HTMLDivElement>(null);
  const gridFade = useScrollFade(gridRef, 'y');

  return (
    <ModalShell
      open={open && regions.length > 0}
      onClose={() => setModal('regionLoad', false)}
      maxVwPct={92}
      maxVh={86}
      ariaLabel={t('hud.region_load')}
      cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <span style={{ ...roleFont('head'), color: PLATE_INK, lineHeight: 1 }}>
        {t('hud.region_load')}
      </span>
      <div
        ref={gridRef}
        role="group"
        aria-label={t('hud.region_load')}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${chunksAcross(width)}, ${TILE.w}px)`,
          gap: TILE.gap,
          // The card is capped by the window's height, so the GRID is what scrolls inside it. A
          // flex item will not shrink below its content without this, and the last row of a tall
          // map is then simply cut off by the card's edge.
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          ...gridFade,
        }}
      >
        {regions.map((region) => {
          const share = Math.min(1, region.value / CHUNK_LOAD_MAX);
          const here = current !== null && current.cx === region.cx && current.cy === region.cy;
          return (
            <div
              key={region.name}
              data-testid={`shell-region-${region.name}`}
              style={{
                height: TILE.h, borderRadius: TILE.radius, background: here ? ACTIVE : INSET,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
                padding: '0 6px', boxSizing: 'border-box',
              }}
            >
              <span style={{ ...roleFont('small'), color: PLATE_INK, lineHeight: 1 }}>
                {region.name}
              </span>
              <span style={{ ...roleFont('caption'), color: PLATE_INK, lineHeight: 1, opacity: 0.75 }}>
                {region.value.toLocaleString()}
              </span>
              {/* The figure is usually a few percent of the limit, which no tint can show. The bar
                  is the reading; the tile's own colour only says which region the disc is on. */}
              <span style={{ height: TILE.bar, borderRadius: TILE.bar, background: TRACK, overflow: 'hidden' }}>
                <span style={{ display: 'block', width: `${share * 100}%`, height: '100%', background: LOAD_FILL }} />
              </span>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}
