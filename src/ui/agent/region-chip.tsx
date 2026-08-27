/*
 * region-chip.tsx — the painted region as composer context (normative prototype `.rgbtn` /
 * `.rgchip` / `.vg` / `.tkreg`).
 *
 * THE CHIP IS A VIEW OF THE STORE'S ONE REGION FACT, never a copy of it. `state/slices/edit.ts`
 * holds `region: MacroCoord[]` — `[]` is the ONE representation of "nothing marked", and
 * `region.length` IS the count — and the agent's write tools are bound to exactly that list. So the
 * chip's numbers come off `state/region-bounds.ts:regionBounds`, which is the same derivation the
 * out-of-region refusal quotes back to the model: a chip and a refusal disagreeing about the box
 * would be two answers to one question. The cross clears THE PAINT ITSELF
 * (`core/runtime/region-brush.ts:clearRegionSelection`) rather than any panel-local flag, because
 * the lock reads the store: a panel-only detach leaves every write tool bound while the composer
 * claims otherwise.
 *
 * IT DOCKS INSIDE THE WELL as a leading token, which is a layout decision and not a placement one:
 * the composer is the panel's pinned bottom zone, and a chip standing above it would either move
 * the composer or cover the record. Inside the well it costs the field ~60px of its own width and
 * nothing else moves — which is what the shortened placeholders beside it are for.
 *
 * THE VIGNETTE IS A REAL PHOTOGRAPH. The artifact draws a little id-free island; the honest
 * equivalent in the running app is the map itself (`map-shot.tsx`, over `canvas/thumbnail.ts`) with
 * the marked bounds drawn on top. The rect is placed by the SAME sea-framing math the capture is
 * composed with (`thumbnail.ts:seaFrame`), so the mark lands on the cells it names rather than on an
 * eyeballed fraction of the picture.
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
import { edge, withAlpha } from './tokens';

/** The chip's own vignette, in px (artifact `.rgchip .vg`). */
export const CHIP_VIGNETTE = { width: 34, height: 25 } as const;
/** The ticket head's, one size down (artifact `.tkreg .vg`). */
export const TICKET_VIGNETTE = { width: 26, height: 18 } as const;

/** How far a queued chip starts short of its own size, per the steer chip's declaration: the region
 *  chip lands with the same entrance, since both are a token appearing where it now lives. */
const CHIP_GROWTH = amplitude('panel.steer.chip') ?? 0;

/** The count as the chip says it, with the one/many split English and Thai need and the other five
 *  locales spell as a single form. */
function cellsSaid(t: (key: string, params?: Record<string, string | number>) => string, n: number): string {
  return t(n === 1 ? 'agent3.region_in_one' : 'agent3.region_in', { n });
}

/**
 * The live map framed on the WHOLE island with the marked bounds drawn over it.
 *
 * WHOLE ISLAND, NOT THE REGION'S OWN BOX, and that is the whole point of the picture: a crop of the
 * marked cells fills the frame edge to edge and says nothing about WHERE the mark sits. What the
 * user needs at a glance is the corner of the island they pointed at.
 *
 * THE DRAWING ITSELF LIVES IN `map-shot.tsx`, beside the photograph it stands on: the gate
 * family's own thumbs are the same picture without the mark, and the two ways of saying "here" have
 * to be one.
 */
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

/**
 * The frame button in the send cluster: press it and the map takes the pencil.
 *
 * IT STANDS LIT WHILE A REGION DOES, which is the same fact the chip beside it draws — one control
 * reporting a state and one offering the verb that changes it would be two sources for one thing.
 * It is also lit while the marking itself is under way, since that is what a second press ends.
 */
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

/**
 * The docked chip: the vignette re-opens marking, the cross clears the paint.
 *
 * TWO BUTTONS, NOT ONE BUTTON WITH A CORNER: the body and the cross do unrelated things (one edits
 * the region, one destroys it), and a nested pressable inside a pressable is a hit area the pointer
 * cannot report honestly.
 */
export function RegionChip({ bounds, vignette, onMark, onClear }: {
  bounds: RegionBounds;
  /** The photograph, from the caller that owns a renderer. Absent, the body is the frame glyph: a
   *  chip with an empty bordered box in it reads as a picture that failed to load. */
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

