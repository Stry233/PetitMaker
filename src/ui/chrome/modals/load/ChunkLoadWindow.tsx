/*
 * Every region of the map and what it carries, as a grid laid out where the regions are and named as the
 * map names them (row letter, column number), empty ones included; each region has a bar and its figure,
 * the one under the pointer in yellow. A window, mounted by `Windows` outside the frame's zoom.
 */
import { useWindow } from '../use-window';
import { useMapRevision } from '../../../session/use-map-revision';
import { isChunkLoadEnforced } from '../../../../core/model/load';
import { formatLoad } from '../../../../i18n/load';
import { localeTag } from '../../../../i18n/locale-info';
import { Switch } from '../../../primitives/Switch';
import { useRef } from 'react';
import { useLocale, useT } from '../../../../i18n/context';
import { getMapStats } from '../../../../state/map-stats';
import { useEditorStore } from '../../../../state/store';
import { ModalShell } from '../../../primitives/ModalShell';
import { helpTargetAttr } from '../../../session/help-targets';
import { useScrollFade } from '../../../primitives/scroll-fade';
import { allChunkLoads, CHUNK_LOAD_MAX, getPointerRegion } from './map-load';
import { mapChunkAxes } from '../../../../core/grid/map-chunks';
import { ACTIVE, INSET, LOAD_FILL, PLATE_INK, TRACK } from '../../../design/tokens';
import { roleFont } from '../../../design/text-weight';

/** One region's tile in css px, between `min` and `max` within the window-capped card. */
const TILE = { min: 56, max: 74, h: 60, gap: 4, radius: 8, bar: 5 } as const;

export function ChunkLoadWindow() {
  const t = useT();
  const locale = useLocale();
  const enforced = useEditorStore((s) => !!s.gridState && isChunkLoadEnforced(s.gridState));
  const setLoadEnforced = useEditorStore((s) => s.setLoadEnforced);
  const { open, close } = useWindow('regionLoad');
  useMapRevision(open);
  const gridState = useEditorStore((s) => s.gridState);

  // Read while the window is up and not before: the stats are a live view mutated in place, so what
  // makes this current is that it is derived at the moment the window renders.
  const regions = open && gridState ? allChunkLoads(getMapStats(gridState), gridState.template) : [];
  const columns = gridState ? mapChunkAxes(gridState.template).columns.length : 1;
  const current = getPointerRegion();
  const gridRef = useRef<HTMLDivElement>(null);
  const gridFade = useScrollFade(gridRef, 'y');

  return (
    <ModalShell helpTarget={{ page: 'load' }}
      open={open && regions.length > 0}
      onClose={close}
      size="panel"
      cap={{ w: 92, h: 86 }}
      ariaLabel={t('hud.region_load')}
      cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {/* Wraps the whole card body: the pick layer's own markers are read off the real DOM, and this
          window is portalled clear of the shell's tree that would otherwise carry one. */}
      <div
        {...helpTargetAttr('load')}
        style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <span style={{ ...roleFont('head'), color: PLATE_INK, lineHeight: 1, whiteSpace: 'nowrap' }}>
            {t('hud.region_load')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ ...roleFont('body'), color: PLATE_INK }}>{t('load.enforce')}</span>
            <Switch on={enforced} onClick={() => setLoadEnforced(!enforced)} label={t('load.enforce')} />
          </div>
        </div>
        <div
          ref={gridRef}
          role="group"
          aria-label={t('hud.region_load')}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(${TILE.min}px, ${TILE.max}px))`,
            gap: TILE.gap,
            // The grid scrolls inside the height-capped card, which a flex item needs `minHeight` for.
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
                  minHeight: TILE.h, borderRadius: TILE.radius, background: here ? ACTIVE : INSET,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
                  padding: '4px 6px', boxSizing: 'border-box',
                }}
              >
                <span style={{ ...roleFont('small'), color: PLATE_INK, lineHeight: 1 }}>
                  {region.name}
                </span>
                <span style={{ ...roleFont('caption'), color: PLATE_INK, lineHeight: 1, opacity: 0.75 }}>
                  {formatLoad(locale, region.value, region.unknownLoads > 0)}
                </span>
                <span style={{ ...roleFont('caption'), color: PLATE_INK, lineHeight: 1 }}>
                  {new Intl.NumberFormat(localeTag(locale), { style: 'percent', maximumFractionDigits: 1 }).format(region.value / CHUNK_LOAD_MAX)}
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
      </div>
    </ModalShell>
  );
}
