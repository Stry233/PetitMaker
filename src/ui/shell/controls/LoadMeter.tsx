/*
 * The corner disc: how full the chunk under the pointer is, as the game's Regional load reads per chunk.
 * It holds the last chunk once the pointer leaves the map (to pick an item) and reads the map's middle
 * before it has been over it. No text: the press opens `ChunkLoadWindow`. The pointer is sampled on a
 * timer, a 3D pick being a ray-march.
 */
import { ActionButton } from '../../primitives/ActionButton';
import { tourTargetAttr } from '../../chrome/tour/steps';
import { formatLoad } from '../../../i18n/load';
import { cssMotion } from '../../design/motion';
import { clientPoint } from '../../../platform/device/viewport-space';
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { helpTargetAttr } from '../../session/help-targets';
import { useUiPreview } from '../../design/preview';
import { formatNumber, useLocale, useT } from '../../../i18n/context';
import { getMapStats} from '../../../state/map-stats';
import { useEditorStore } from '../../../state/store';
import { btnReset, cursors, radii } from '../../design/styles';
import { topRightHeight, type FrameArt } from '../frame';
import {
  chunkLoad, CHUNK_LOAD_MAX, getPointerRegion, MAP_LOAD_SHOWN, setPointerRegion,
  subscribePointerRegion, type ChunkLoad,
} from '../../chrome/modals/load/map-load';
import { mapChunkAt } from '../../../core/grid/map-chunks';
import { chunkAtClient } from '../../../editor/host/map-pointer';
import { INK, LOAD_FILL, MASK_CUT, MASK_KEEP } from '../../design/tokens';
import { useMapRevision } from '../../session/use-map-revision';

/** The control in a 100-unit box, measured off the game's: disc, hole, and a round-capped arc from twelve o'clock. */
export const DISC = { r: 50, hole: 10, arc: 30, band: 30 } as const;
const CIRCUMFERENCE = 2 * Math.PI * DISC.arc;

/** The track's opacity over the map, as the game's translucent disc lets the map show through. */
const TRACK_ALPHA = 0.44;

/** Unique per document, and there is one of these. */
const HOLE_MASK = 'shell-load-hole';

/** How often the pointer is turned into a region. Fast enough that crossing a boundary reads as
 *  immediate, slow enough that a 3D surface pick is not run every frame. */
const SAMPLE_MS = 100;

export function LoadMeter({ art }: { art: FrameArt }) {
  const t = useT();
  const locale = useLocale();
  // A pictured meter shows the reading and samples nothing (`ui-preview.tsx`): its global
  // pointermove would be a second surface pick per pointer step for a figure that cannot be hovered.
  const preview = useUiPreview();
  // The grid is mutated in place, so this is not an edit signal — it is which map is loaded, and a
  // map that arrives after the frame is mounted has to be read once without waiting for an edit.
  const gridState = useEditorStore((s) => s.gridState);
  const setModal = useEditorStore((s) => s.setModal);
  /** The region under the pointer, held in `map-load.ts` because the window reads it too. Null
   *  until the pointer has been over the map at all. */
  const at = useSyncExternalStore(subscribePointerRegion, getPointerRegion, getPointerRegion);
  // The stats are a live view mutated in place, so the map revision re-renders this once a frame at most.
  useMapRevision(MAP_LOAD_SHOWN && !!gridState, 'frame');

  useEffect(() => {
    if (!MAP_LOAD_SHOWN || preview) return undefined;
    let last = 0;
    const onMove = (e: PointerEvent) => {
      // Only a pointer over the map canvas points at a region; the panels over it do not.
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const now = performance.now();
      if (now - last < SAMPLE_MS) return;
      last = now;
      const { x, y } = clientPoint(e);
      const at = chunkAtClient(x, y);
      if (at) setPointerRegion(at.cx, at.cy);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [preview]);

  if (!MAP_LOAD_SHOWN || !gridState) return null;
  const { width, height } = gridState.template;
  const stats = getMapStats(gridState);
  const region = at ?? mapChunkAt(gridState.template, Math.floor(width / 2), Math.floor(height / 2));
  const load: ChunkLoad | null = chunkLoad(stats, region.cx, region.cy);
  if (!load) return null;

  // Its own height, the one that puts a disc filling its box at the size a rail button reads. The
  // three in the corner are one reading, not one box.
  const size = topRightHeight(art);
  const filled = Math.min(1, Math.max(0, load.value / CHUNK_LOAD_MAX));
  return (
    <ActionButton
      {...helpTargetAttr('load')}
      {...tourTargetAttr('load')}
      interaction="tile"
      data-testid="shell-load"
      // The reading is in the name too, since the disc carries no text.
      aria-label={t('load.aria', {
        label: t(art.labelKey), region: load.name,
        value: formatLoad(locale, load.value, load.unknownLoads > 0), max: formatNumber(locale, CHUNK_LOAD_MAX),
      })}
      onClick={() => setModal('regionLoad', true)}
      style={{
        ...btnReset, width: size, height: size, flex: 'none',
        // The disc fills its box, so a round button is the shape a focus ring should follow.
        borderRadius: radii.pill,
        display: 'block', cursor: cursors.clickable,
      }}
    >
      <LoadDiscSvg fill={filled} maskId={HOLE_MASK} animated style={{ display: 'block', width: '100%', height: '100%' }} />
    </ActionButton>
  );
}

/** The disc drawing alone, so exactly one place draws it (the Help figure renders it too).
 *  `maskId` must be unique among the instances a document mounts. */
export function LoadDiscSvg({ fill, maskId, animated = false, style }: {
  fill: number;
  maskId: string;
  animated?: boolean;
  style?: CSSProperties;
}) {
  const filled = Math.min(1, Math.max(0, fill));
  return (
    <svg aria-hidden viewBox="0 0 100 100" style={style}>
      <mask id={maskId}>
        <rect x="0" y="0" width="100" height="100" fill={MASK_KEEP} />
        <circle cx="50" cy="50" r={DISC.hole} fill={MASK_CUT} />
      </mask>
      <circle
        cx="50" cy="50" r={DISC.r}
        fill={INK} fillOpacity={TRACK_ALPHA} mask={`url(#${maskId})`}
      />
      {filled > 0 ? (
        <circle
          cx="50" cy="50" r={DISC.arc}
          fill="none" stroke={LOAD_FILL} strokeWidth={DISC.band} strokeLinecap="round"
          strokeDasharray={`${filled * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="rotate(-90 50 50)"
          style={animated ? { transition: cssMotion('meter.fill', ['stroke-dasharray']) } : undefined}
        />
      ) : null}
    </svg>
  );
}
