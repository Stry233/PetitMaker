/** One floor of the layer panel: its name, how full it is, and its eye and lock. */
import { tileOf, Row } from './layer-plate';
import { ActionButton } from '../../primitives/ActionButton';
import { type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { ELEVATION_COLORS } from '../../../core/model/palette';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { iconUrl } from '../../primitives/icons';
import { btnReset, cursors, radii } from '../../design/styles';
import { type LayerMode } from '../frame';
import { useTransition } from '../../design/motion/use-motion';
import { cssMotion } from '../../design/motion';
import { frameZoomAttr } from '../../design/motion/zoom-corrected-radius';
import { ACTIVE, ERROR, INK, INSET, PLATE_INK, TRACK } from '../../design/tokens';
import { TEXT } from '../units';
import { useFrameReadableWeight, useFrameZoom, useZoomedLayoutTransform } from '../use-frame-zoom';

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
        cursor: cursors.clickable, display: 'flex',
      }}
    >
      <img src={iconUrl(icon)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </ActionButton>
  );
}
/**
 * A floor: what stands on it, how much of the map that is, and its eye and lock. The plate behind the
 * content selects it, so the toggles sit inside a press target without nesting. It travels between the
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
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const setLayerVisibility = useEditorStore((s) => s.setLayerVisibility);
  const setLayerLocked = useEditorStore((s) => s.setLayerLocked);
  const band = ELEVATION_COLORS[row.elevation] ?? ELEVATION_COLORS[0]!;
  const ink = active ? INK : PLATE_INK;
  const tile = tileOf(mode);
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
      style={{ display: 'flex', alignItems: 'center', gap: tile.swatchGap, ...(stacked ? {} : { flex: 1 }) }}
    >
      <span
        style={{
          width: tile.swatch, height: tile.swatch, borderRadius: radii.sm, flex: 'none',
          background: band, opacity: visible ? 1 : 0.35,
        }}
      />
      <span style={{ fontSize: TEXT.tab, fontWeight: fw(800, TEXT.tab), color: ink }}>{row.name}</span>
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
        fontSize: TEXT.small, fontWeight: fw(800, TEXT.small), color: ink, fontVariantNumeric: 'tabular-nums',
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
        onPress={() => setLayerVisibility(row.elevation, !visible)}
      />
      <TileToggle
        icon={`${locked ? 'lock' : 'unlock'}-selected`}
        label={t('a11y.toggle_lock')}
        testId={`shell-layer-lock-${row.elevation}`}
        size={tile.icon}
        onPress={() => setLayerLocked(row.elevation, !locked)}
      />
    </motion.div>
  );
  const lineStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: tile.readingGap, lineHeight: 1, whiteSpace: 'nowrap',
  };

  return (
    <motion.div
      {...shape}
      style={{ position: 'relative', padding: `${tile.padY}px ${tile.padX}px` }}
    >
      <ActionButton
        {...shape}
        interaction="row"
        hoverFill={active ? undefined : INSET}
        aria-label={row.name}
        aria-pressed={active}
        data-testid={`shell-layer-row-${row.elevation}`}
        // Pressing the pinned floor again unpins it, so the water brush follows the ground again.
        // Choosing a floor stands annotate down, or the panel would show two selected rows at once.
        onClick={() => selectLayer(row.elevation)}
        style={{
          ...btnReset, ...behind, background: active ? ACTIVE : 'transparent', cursor: cursors.clickable,
          transition: cssMotion('layer.select.fade', ['background']),
        }}
      />
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
          // The plate behind takes the press; only the two toggles take it back.
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
