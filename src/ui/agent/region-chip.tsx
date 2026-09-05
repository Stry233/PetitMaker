/*
 * Composer controls for the store's active region. Counts and bounds use the same region derivation
 * as the agent tool lock, and clearing the chip clears the shared selection. The vignette frames the
 * whole map and overlays the marked bounds using the capture renderer's sea framing.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import type { RegionBounds } from '../../state/region-bounds';
import { ACTIVE, INK, PLATE } from '../design/tokens';
import { cursors } from '../design/styles';
import { Icon } from './icons';
import { MarkedShot } from './map-shot';
import { amplitude, framerMotion } from './motion';
import { edge } from './tokens';
import { withAlpha } from '../design/styles';

/** Composer-chip vignette size in CSS pixels. */
export const CHIP_VIGNETTE = { width: 34, height: 25 } as const;
/** Ticket-header vignette size in CSS pixels. */
export const TICKET_VIGNETTE = { width: 26, height: 18 } as const;

/** How far a queued chip starts short of its own size, per the steer chip's declaration: the region
 *  chip lands with the same entrance, since both are a token appearing where it now lives. */
const CHIP_GROWTH = amplitude('panel.steer.chip') ?? 0;

/** The count as the chip says it, with the one/many split English and Thai need and the other five
 *  locales spell as a single form. */
function cellsSaid(t: (key: string, params?: Record<string, string | number>) => string, n: number): string {
  return t(n === 1 ? 'agent3.region_in_one' : 'agent3.region_in', { n });
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
  borderRadius: 999,
  flex: '0 0 auto',
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: INK,
  cursor: cursors.clickable,
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
  const label = bounds ? cellsSaid(t, bounds.count) : t('agent3.region_mark');
  return (
    <button
      type="button"
      data-testid="composer-region-mark"
      data-lit={lit}
      title={label}
      aria-label={label}
      aria-pressed={marking}
      onClick={onPress}
      style={{ ...BUTTON_BASE, background: lit ? ACTIVE : 'transparent' }}
    >
      <Icon id="pw-region-frame" size={16} />
    </button>
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
        gap: 5,
        background: PLATE,
        border: edge,
        borderRadius: 999,
        padding: '3px 5px 3px 3px',
        flex: '0 0 auto',
      }}
    >
      <button
        type="button"
        data-testid="region-chip-body"
        title={t('agent3.region_remark')}
        aria-label={t('agent3.region_remark')}
        onClick={onMark}
        style={{
          display: 'inline-flex', border: 'none', background: 'none', padding: 0,
          borderRadius: 8, cursor: cursors.clickable, boxShadow: 'none',
        }}
      >
        {vignette ?? (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: CHIP_VIGNETTE.width, height: CHIP_VIGNETTE.height,
              border: edge, borderRadius: 8, color: INK,
            }}
          >
            <Icon id="pw-region-frame" size={14} />
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid="region-chip-clear"
        title={t('agent3.region_detach')}
        aria-label={t('agent3.region_detach')}
        onClick={onClear}
        style={{
          width: 18, height: 18, borderRadius: '50%', border: 'none', padding: 0,
          background: withAlpha(INK, 0.1), color: INK, flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: cursors.clickable, boxShadow: 'none',
        }}
      >
        <Icon id="pw-cross" size={10} />
      </button>
    </motion.span>
  );
}
