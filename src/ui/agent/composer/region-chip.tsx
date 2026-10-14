/*
 * Composer controls for the store's active region. Counts and bounds use the same region derivation
 * as the agent tool lock, and clearing the chip clears the shared selection. The vignette frames the
 * whole map and overlays the marked bounds using the capture renderer's sea framing.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import type { RegionBounds } from '../../../core/grid/rect';
import { ACTIVE, INK, PLATE, rgbaOf } from '../../design/tokens';
import { radii } from '../../design/styles';
import { ActionButton } from '../../primitives/ActionButton';
import { Icon } from '../parts/sprite';
import { MarkedShot } from '../parts/map-shot';
import { amplitude, framerMotion } from '../../design/motion';
import { edge } from '../panel-skin';
import type { Translate } from '../../../i18n/keys';

/** Composer-chip vignette size in CSS pixels. */
export const CHIP_VIGNETTE = { width: 34, height: 25 } as const;
/** Ticket-header vignette size in CSS pixels. */
export const TICKET_VIGNETTE = { width: 26, height: 18 } as const;

/** How far a queued chip starts short of its own size, per the steer chip's declaration: the region
 *  chip lands with the same entrance, since both are a token appearing where it now lives. */
const CHIP_GROWTH = amplitude('panel.steer.chip') ?? 0;

/** The count as the chip says it, with the one/many split English and Thai need and the other five
 *  locales spell as a single form. */
function cellsSaid(t: Translate, n: number): string {
  return t('agent.region_in', { n });
}

/** The whole-map capture with the selected bounds drawn in their map position. */
export function RegionVignette({ bounds, width, height }: {
  bounds: RegionBounds;
  width: number;
  height: number;
}) {
  return (
    <MarkedShot
      box={{
        origin: { x: bounds.x1, y: bounds.y1 },
        width: bounds.x2 - bounds.x1 + 1,
        height: bounds.y2 - bounds.y1 + 1,
      }}
      width={width}
      height={height}
      testId="region-vignette"
    />
  );
}

const BUTTON_BASE: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: radii.pill,
  flex: '0 0 auto',
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: INK,
  padding: 0,
  boxShadow: 'none',
};

/** Starts or stops region marking and remains highlighted while a region or marking session exists. */
export function RegionButton({ bounds, marking, onPress }: {
  bounds: RegionBounds | null;
  marking: boolean;
  onPress(): void;
}) {
  const t = useT();
  const lit = bounds !== null || marking;
  const label = bounds ? cellsSaid(t, bounds.count) : t('agent.region_mark');
  return (
    <ActionButton
      data-testid="composer-region-mark"
      data-lit={lit}
      title={label}
      aria-label={label}
      aria-pressed={marking}
      onClick={onPress}
      hoverFill={ACTIVE}
      style={{ ...BUTTON_BASE, background: lit ? ACTIVE : 'transparent' }}
    >
      <Icon id="pw-region-frame" size={16} />
    </ActionButton>
  );
}

/** A two-button chip: the vignette edits the region and the separate cross clears it. */
export function RegionChip({ bounds, vignette, onMark, onClear }: {
  bounds: RegionBounds;
  /** Caller-supplied map capture. The region glyph is the fallback. */
  vignette?: ReactNode;
  onMark(): void;
  onClear(): void;
}) {
  const t = useT();
  return (
    <motion.span
      data-testid="composer-region-chip"
      initial={{ opacity: 0, scale: 1 - CHIP_GROWTH }}
      animate={{ opacity: 1, scale: 1 }}
      transition={framerMotion('panel.steer.chip')}
      title={cellsSaid(t, bounds.count)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: PLATE,
        border: edge,
        borderRadius: radii.pill,
        padding: '2px 4px 2px 2px',
        flex: '0 0 auto',
      }}
    >
      <ActionButton
        data-testid="region-chip-body"
        interaction="tile"
        title={t('agent.region_remark')}
        aria-label={t('agent.region_remark')}
        onClick={onMark}
        style={{ display: 'inline-flex', border: 'none', background: 'none', padding: 0, borderRadius: radii.chip, boxShadow: 'none' }}
      >
        {vignette ?? (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: CHIP_VIGNETTE.width, height: CHIP_VIGNETTE.height,
              border: edge, borderRadius: radii.chip, color: INK,
            }}
          >
            <Icon id="pw-region-frame" size={14} />
          </span>
        )}
      </ActionButton>
      <ActionButton
        data-testid="region-chip-clear"
        interaction="badge"
        title={t('agent.region_detach')}
        aria-label={t('agent.region_detach')}
        onClick={onClear}
        style={{
          width: 18, height: 18, borderRadius: '50%', border: 'none', padding: 0,
          background: rgbaOf(INK, 0.1), color: INK, flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'none',
        }}
      >
        <Icon id="pw-cross" size={10} />
      </ActionButton>
    </motion.span>
  );
}
