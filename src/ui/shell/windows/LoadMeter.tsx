import { clientPoint } from '../../../core/runtime/viewport-space';
/*
 * LoadMeter.tsx — the corner disc: how full the region under the pointer is.
 *
 * THE READING FOLLOWS THE POINTER. The game calls this 区域负荷, a REGIONAL load, and the limit it
 * reports is per chunk: what decides whether the next placement is refused is what the chunk you
 * are about to build in holds, not a total for the planet. So the disc reads the region under the
 * cursor and changes as the cursor crosses into the next one. It HOLDS the last region once the
 * pointer leaves the map, because the pointer leaves the map to go and pick an item off the shelf,
 * which is exactly when the reading matters; before the pointer has been over the map at all it
 * reads the region at the middle of it, where the camera opens.
 *
 * NO TEXT AND NO NUMBER. The game draws a disc alone, and the whole point of a proportion is that
 * it is read at a glance: a four-digit count standing where the eye passes constantly answers a
 * question almost nobody is asking. The press opens `ChunkLoadWindow`, which is where the figures
 * are, for every region at once.
 *
 * THE DRAWING IS NOT THE DESIGN SOURCE'S. That file draws a thin ring; the game draws a fat
 * translucent disc with a small bite out of the middle and a thick round-capped arc inset from both
 * of its edges. The proportions below are measured off the game and are what `DISC` holds.
 *
 * The pointer is read on a timer rather than every frame: in 3D `screenToMacro` is a ray-march
 * against the visible surface, the pointer machine already runs one per move for its own hover, and
 * a readout does not need sixty answers a second.
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { getActiveView } from '../../../canvas/active-view';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { useUiPreview } from '../../primitives/ui-preview';
import { useT } from '../../../i18n/context';
import { getMapStats, subscribeMapStats } from '../../../state/map-stats';
import { useEditorStore } from '../../../state/store';
import { btnReset, cursors, pressable } from '../../design/styles';
import { topRightHeight, type FrameArt } from '../frame';
import {
  chunkAt, chunkLoad, CHUNK_LOAD_MAX, getPointerRegion, MAP_LOAD_SHOWN, setPointerRegion,
  subscribePointerRegion, type ChunkLoad,
} from './map-load';
import { INK, LOAD_FILL } from '../../design/tokens';

/**
 * The control in a 100-unit box, measured off the game's own: a disc half the box across, a hole a
 * fifth of that, and the arc a stroked circle whose width very nearly equals its radius, leaving it
 * clear of the rim by as much as it is clear of the hole.
 *
 * The cap is ROUND and the arc starts at twelve o'clock, so a reading bulges a little back past the
 * top. That is the game's drawing, not an oversight: the cap is what makes the filled part read as
 * a soft bean rather than as a slice of pie.
 */
export const DISC = { r: 50, hole: 10, arc: 30, band: 30 } as const;
export const CIRCUMFERENCE = 2 * Math.PI * DISC.arc;

/**
 * The track's opacity over whatever is behind it.
 *
 * The game's is translucent, not a flat fill: sampled over its blue sea the track comes out at
 * (47, 97, 111), which is this interface's own ink at a touch under a half over that sea, and a
 * flat colour that read correctly on water would go wrong on land. So the map shows through,
 * which is also why the hole is a hole.
 */
export const TRACK_ALPHA = 0.44;

/** Unique per document, and there is one of these. */
const HOLE_MASK = 'shell-load-hole';

/** How often the pointer is turned into a region. Fast enough that crossing a boundary reads as
 *  immediate, slow enough that a 3D surface pick is not run every frame. */
const SAMPLE_MS = 100;

export function LoadMeter({ art }: { art: FrameArt }) {
  const t = useT();
  // A pictured meter shows the reading and samples nothing (`ui-preview.tsx`): its global
  // pointermove would be a second surface pick per pointer step for a figure that cannot be hovered.
  const preview = useUiPreview();
  const eventBus = useEditorStore((s) => s.eventBus);
  // The grid is MUTATED in place, so this is not an edit signal — it is which map is loaded, and a
  // map that arrives after the frame is mounted has to be read once without waiting for an edit.
  const gridState = useEditorStore((s) => s.gridState);
  const setModal = useEditorStore((s) => s.setModal);
  /** The region under the pointer, held in `map-load.ts` because the window reads it too. Null
   *  until the pointer has been over the map at all. */
  const at = useSyncExternalStore(subscribePointerRegion, getPointerRegion, getPointerRegion);
  // The stats are a LIVE view, mutated in place, so their identity never changes when a placement
  // lands: what re-renders this is the shared subscription's own tick, rAF-coalesced there so a
  // stroke of dozens of commands costs one render.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!MAP_LOAD_SHOWN || !gridState) return undefined;
    setTick((n) => n + 1);
    return subscribeMapStats(eventBus, () => useEditorStore.getState().gridState, () => setTick((n) => n + 1));
  }, [eventBus, gridState]);

  useEffect(() => {
    if (!MAP_LOAD_SHOWN) return undefined;
    let last = 0;
    const onMove = (e: PointerEvent) => {
      // Over the CANVAS, which is the map: every panel and bar in this interface is DOM standing
      // over it, and the map continues behind them. A pointer on the item shelf is not pointing at
      // the region the shelf happens to cover.
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const now = performance.now();
      if (now - last < SAMPLE_MS) return;
      last = now;
      const cell = getActiveView()?.projection.screenToMacro(clientPoint(e).x, clientPoint(e).y);
      const grid = useEditorStore.getState().gridState;
      if (!cell || !grid) return;
      const { width, height } = grid.template;
      if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) return;
      const next = chunkAt(cell.x, cell.y);
      setPointerRegion(next.cx, next.cy);
    };
    if (preview) return undefined;
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  if (!MAP_LOAD_SHOWN || !gridState) return null;
  const { width, height } = gridState.template;
  const stats = getMapStats(gridState);
  const region = at ?? chunkAt(Math.floor(width / 2), Math.floor(height / 2));
  const load: ChunkLoad | null = chunkLoad(stats, region.cx, region.cy);
  if (!load) return null;

  // Its own height, the one that puts a disc filling its box at the size a rail button reads. The
  // three in the corner are one reading, not one box.
  const size = topRightHeight(art);
  const filled = Math.min(1, Math.max(0, load.value / CHUNK_LOAD_MAX));
  return (
    <motion.button
      type="button"
      {...helpTargetAttr('load')}
      {...pressable}
      data-testid="shell-load"
      // The reading is in the NAME, not only in the drawing: the disc is a proportion of a limit
      // and there is no text on it, so without this the control says nothing to anyone not
      // looking at it.
      aria-label={`${t(art.labelKey)}: ${load.name}, ${load.value} / ${CHUNK_LOAD_MAX}`}
      onClick={() => setModal('regionLoad', true)}
      style={{
        ...btnReset, width: size, height: size, flex: 'none',
        // The disc fills its box, so a round button is the shape a focus ring should follow.
        borderRadius: 999,
        display: 'block', cursor: cursors.clickable,
      }}
    >
      <LoadDiscSvg fill={filled} maskId={HOLE_MASK} animated style={{ display: 'block', width: '100%', height: '100%' }} />
    </motion.button>
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
        <rect x="0" y="0" width="100" height="100" fill="#fff" />
        <circle cx="50" cy="50" r={DISC.hole} fill="#000" />
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
          style={animated ? { transition: 'stroke-dasharray 0.25s ease' } : undefined}
        />
      ) : null}
    </svg>
  );
}
