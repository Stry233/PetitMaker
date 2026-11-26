/** One floor of the layer panel: its name, how full it is, and its eye and lock. */
import { chipShift, tileOf, Row } from './layer-plate';
import { LayerRowFill } from './LayerRowPlate';
import { ActionButton } from '../../primitives/ActionButton';
import { type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { ELEVATION_COLORS } from '../../../core/model/palette';
import { useT } from '../../../i18n/context';
import { iconUrl } from '../../../assets/icon-urls';
import { btnReset, cursors, radii } from '../../design/styles';
import { type LayerMode } from '../frame';
import { useTransition } from '../../design/motion/use-motion';
import { cssMotion } from '../../design/motion';
import { frameZoomAttr } from '../../design/motion/zoom-corrected-radius';
import { ERROR, INK, PLATE_INK, TRACK } from '../../design/tokens';
import { roleSize } from '../../design/text-weight';
import { useTouchMode } from '../../design/input-mode';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameReadableWeight, useFrameZoom, useZoomedLayoutTransform } from '../use-frame-zoom';
import { useRunCommand } from '../use-shell-commands';
import { layerNumber } from '../../../core/game/profile';

/** How strongly a locked tile is tinted while its paints are being refused. */
const LOCK_TINT = 0.42;
/** The red a refusal tints with, the same one the error toasts carry. */
const LOCK_RED = ERROR;
/** The eye and the lock, in their brown variants: the plate is cream, so the white ones a smoked
 *  card would take are not readable here. */
export function TileToggle({ icon, label, testId, size, onPress }: {
  icon: string;
  label: string;
  testId: string;
  size: number;
  onPress: () => void;
}) {
  const zoom = useFrameZoom();
  return (
    <ActionButton
      interaction="tile"
      aria-label={label}
      data-testid={testId}
      onClick={onPress}
      style={{
        ...btnReset,
        width: size, height: size, flex: 'none',
        // A soft square around a small drawing. The frame's own `FOCUS_SHAPE_RADIUS` clamps to half
        // a box this size, which would ring an eye and a lock as discs.
        borderRadius: radii.chip,
        // The tile's own press target is the plate underneath, which the content lets through; a
        // toggle is the exception that takes its own press back.
        pointerEvents: 'auto',
        cursor: cursors.clickable, display: 'flex', position: 'relative',
      }}
    >
      <img src={iconUrl(icon)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}
/**
 * A floor: what stands on it, how much of the map that is, and its eye and lock, filled while a stroke
 * works on it; only the toggles take a press. It travels between the
 * two sizes (`layout`, re-measured on the size alone); boxes whose shape changes take `layout` and the
 * words and toggles in them `layout="position"`, so nothing stretches.
 */
export function LayerTile({ row, mode, active, visible, locked, refused }: {
  row: Row;
  mode: LayerMode;
  active: boolean;
  visible: boolean;
  locked: boolean;
  refused: boolean;
}) {
  const t = useT();
  const resize = useTransition('layer.mode.resize');
  const zoomed = useZoomedLayoutTransform();
  const zoom = useFrameZoom();
  const fw = useFrameReadableWeight();
  const run = useRunCommand();
  const band = ELEVATION_COLORS[row.elevation] ?? ELEVATION_COLORS[0]!;
  const ink = active ? INK : PLATE_INK;
  const tile = tileOf(mode, useTouchMode());
  const stacked = mode === 'grid';
  const behind: CSSProperties = { position: 'absolute', inset: 0, borderRadius: tile.radius };
  /** The props of every box on the tile whose shape changes with the size, the frame zoom included. */
  const shape = {
    layout: true as const, layoutDependency: mode, transition: resize, transformTemplate: zoomed,
    ...frameZoomAttr(zoom),
  };
  /** And of every piece of content standing in one, which travels at its own size. */
  const carried = { ...shape, layout: 'position' as const };

  const nameGroup = (
    <motion.div
      {...carried}
      style={{ display: 'flex', alignItems: 'center', gap: tile.swatchGap, minWidth: 0, ...(stacked ? {} : { flex: 1 }) }}
    >
      <span
        style={{
          // On the leading column with the notes row's "?"; the opposite margin keeps the name where it was.
          width: tile.swatch, height: tile.swatch, borderRadius: radii.sm, flex: 'none',
          marginLeft: chipShift(mode), marginRight: -chipShift(mode),
          background: band, opacity: visible ? 1 : 0.35,
        }}
      />
      {/* The one part of a tile that gives way where its column is narrow (`layer-plate.ts:tileLeastWidth`). */}
      <span
        title={row.name}
        style={{ fontSize: roleSize('label'), fontWeight: fw(800, roleSize('label')), color: ink, minWidth: 0, textOverflow: 'ellipsis',
          // Clipped across only: the line is one em tall, and marks above or below it stay drawn.
          overflowX: 'clip', overflowY: 'visible' }}
      >
        {row.name}
      </span>
    </motion.div>
  );
  const countFigure = (
    <motion.span
      {...carried}
      data-testid={`shell-layer-count-${row.elevation}`}
      style={{
        minWidth: tile.count,
        // The square gives the name the slack; the file reads the figure off its right edge against the toggles.
        ...(stacked ? { flex: 1 } : { textAlign: 'right' as const }),
        fontSize: roleSize('small'), fontWeight: fw(800, roleSize('small')), color: ink, fontVariantNumeric: 'tabular-nums',
      }}
    >
      {row.count}
    </motion.span>
  );
  // The eye and the lock are a pair and sit closer to each other than either does to the figure,
  // which is a different kind of thing standing on the same line.
  const toggles = (
    <motion.div {...carried} style={{ display: 'flex', alignItems: 'center', gap: tile.toggleGap }}>
      <TileToggle
        icon={`${visible ? 'eye-open' : 'eye-closed'}-selected`}
        label={t('a11y.toggle_visibility')}
        testId={`shell-layer-eye-${row.elevation}`}
        size={tile.icon}
        onPress={() => run('view.layer_visible', { layer: layerNumber(row.elevation), visible: !visible })}
      />
      <TileToggle
        icon={`${locked ? 'lock' : 'unlock'}-selected`}
        label={t('a11y.toggle_lock')}
        testId={`shell-layer-lock-${row.elevation}`}
        size={tile.icon}
        onPress={() => run('view.layer_locked', { layer: layerNumber(row.elevation), locked: !locked })}
      />
    </motion.div>
  );
  const lineStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: tile.readingGap, lineHeight: 1, whiteSpace: 'nowrap',
  };

  return (
    <motion.div
      {...shape}
      aria-label={row.name}
      aria-current={active ? 'true' : undefined}
      data-testid={`shell-layer-row-${row.elevation}`}
      style={{ position: 'relative', padding: `${tile.padY}px ${tile.padX}px` }}
    >
      <LayerRowFill {...shape} selected={active} style={{ borderRadius: tile.radius }} />
      {locked ? (
        <motion.span
          {...shape}
          aria-hidden
          data-testid={`shell-layer-refused-${row.elevation}`}
          style={{
            ...behind, background: LOCK_RED, pointerEvents: 'none',
            opacity: refused ? LOCK_TINT : 0,
            transition: cssMotion(refused ? 'layer.lock.refuse' : 'layer.lock.release', ['opacity']),
          }}
        />
      ) : null}
      <motion.div
        {...shape}
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column', gap: tile.line,
          // Only the two toggles take a press.
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        {stacked ? (
          <>
            {/* The square stacks the name, then the figure with the toggles. */}
            <motion.div {...shape} data-testid={`shell-layer-line-${row.elevation}`} style={lineStyle}>
              {nameGroup}
            </motion.div>
            <motion.div {...shape} style={lineStyle}>
              {countFigure}
              {toggles}
            </motion.div>
          </>
        ) : (
          /* The file puts it all on one line in three groups: chip and name, the count, eye and lock. */
          <motion.div {...shape} data-testid={`shell-layer-line-${row.elevation}`} style={lineStyle}>
            {nameGroup}
            {countFigure}
            {toggles}
          </motion.div>
        )}
        <motion.span
          {...shape}
          style={{ height: tile.bar, borderRadius: tile.bar / 2, background: TRACK, overflow: 'hidden' }}
        >
          <span
            data-testid={`shell-layer-bar-${row.elevation}`}
            style={{
              display: 'block', height: '100%', borderRadius: tile.bar / 2, background: band,
              // A floor with a few cells keeps a visible sliver; an empty floor keeps an empty track.
              width: row.count > 0 ? `max(4px, ${row.share * 100}%)` : 0,
            }}
          />
        </motion.span>
      </motion.div>
    </motion.div>
  );
}
