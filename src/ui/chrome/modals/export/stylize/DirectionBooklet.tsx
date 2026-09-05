/* Style directions grouped into local and provider-backed rows. Each row shows its sample, name,
 * AI status and relative render cost; the list scrolls independently of `DirectionPane`. */
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { buttonMotion, cursors, radii } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import {
  CUSTOM_DIRECTION_ID, PROC_PACK_META, STYLE_PACKS,
  type DirectionId, type ProcPackMeta, type StylePack, type StylizeDirection,
} from '../../../../../io/stylize';
import { packSampleUrl } from './sample-assets';
import { useScrollFade } from '../../../../primitives/scroll-fade';
import { SampleTile, entering } from './atoms';
import { cssMotion } from './motion';
import type { SampleArt } from './sample-art';

export interface DirectionRow {
  id: StylizeDirection;
  nameKey: string;
  /** `model` rows use a connected provider; `proc` rows draw locally and may name a neural pack. */
  kind: 'model' | 'proc';
  /** Relative render cost from 1 to 5. */
  cost: 1 | 2 | 3 | 4 | 5;
  /** Provider preset, or null for a custom prompt and local packs. */
  pack: StylePack | null;
  /** Local pack metadata. */
  proc: ProcPackMeta | null;
  /** Placeholder art used when no sample image is available. */
  art: SampleArt;
  /** Accent used by version cards. */
  band: string;
}

/** Palette placeholder for the custom direction, which has no fixed sample. */
const CUSTOM_ART: SampleArt = {
  paper: '#F7F4E9',
  palette: STYLE_PACKS.map((p) => p.palette[0]!),
};

export const DIRECTIONS: readonly DirectionRow[] = [
  ...PROC_PACK_META.map((proc): DirectionRow => ({
    id: proc.id,
    nameKey: proc.nameKey,
    kind: 'proc',
    cost: proc.cost,
    pack: null,
    proc,
    art: { paper: proc.palette.paper, palette: [proc.palette.ground[0]!, proc.palette.water, proc.palette.road, proc.palette.dark] },
    band: proc.palette.dark,
  })),
  ...STYLE_PACKS.map((pack): DirectionRow => ({
    id: pack.id as DirectionId,
    nameKey: pack.nameKey,
    kind: 'model',
    cost: 5,
    pack,
    proc: null,
    art: { paper: pack.paper, palette: pack.palette },
    band: pack.palette[0]!,
  })),
  {
    id: CUSTOM_DIRECTION_ID,
    nameKey: 'stylize.dir_custom',
    kind: 'model',
    cost: 5,
    pack: null,
    proc: null,
    art: CUSTOM_ART,
    band: skin.muted,
  },
];

export function directionRow(id: StylizeDirection): DirectionRow {
  return DIRECTIONS.find((d) => d.id === id) ?? DIRECTIONS[0]!;
}

export function DirectionBooklet({ value, onPick, enterIndex = 0 }: {
  value: StylizeDirection;
  onPick: (id: StylizeDirection) => void;
  /** Where the booklet stands in its page's arrival order. */
  enterIndex?: number;
}) {
  const reduced = useReducedMotionConfig() === true;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(scrollRef, 'y');

  // Bring the persisted initial selection into view when the booklet opens.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-direction="${value}"]`);
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- use the opening selection only
  }, []);

  // This element must remain the animated flex child so `minHeight: 0` can constrain its scroller.
  return (
    <motion.div
      {...entering(enterIndex)}
      ref={scrollRef}
      data-testid="stylize-direction-scroll"
      style={{ ...scrollStyle, ...fade }}
    >
      <GroupLabel textKey="stylize.group_local" count={DIRECTIONS.filter((d) => d.kind === 'proc').length} />
      {DIRECTIONS.filter((d) => d.kind === 'proc').map((row) => (
        <DirectionRowButton key={row.id} row={row} picked={row.id === value} onPick={onPick} />
      ))}
      <GroupLabel textKey="stylize.group_model" count={DIRECTIONS.filter((d) => d.kind === 'model').length} />
      {DIRECTIONS.filter((d) => d.kind === 'model').map((row) => (
        <DirectionRowButton key={row.id} row={row} picked={row.id === value} onPick={onPick} />
      ))}
    </motion.div>
  );
}

function GroupLabel({ textKey, count }: { textKey: string; count: number }) {
  const t = useT();
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 2px 1px', flex: 'none' }}>
      <b style={{ ...roleFont('caption'), color: skin.muted, whiteSpace: 'nowrap' }}>{t(textKey)}</b>
      <i style={{ flex: 1, height: 1, background: skin.line }} />
      <em style={{ ...roleFont('caption'), fontStyle: 'normal', color: skin.muted, opacity: 0.55 }}>{count}</em>
    </div>
  );
}

/** Disclosure shown on provider-backed and on-device neural rows. */
function AiChip({ picked }: { picked: boolean }) {
  const t = useT();
  return (
    <span style={{ ...roleFont('caption'), flex: 'none', padding: '0 5px', borderRadius: radii.sm, color: picked ? skin.ink : skin.muted, boxShadow: `inset 0 0 0 1px ${picked ? skin.ink : skin.muted}`, opacity: 0.85 }}>
      {t('stylize.tag_ai')}
    </span>
  );
}

/** Relative work meter; pips avoid presenting render time as a quality rating. */
function CostPips({ cost, picked }: { cost: number; picked: boolean }) {
  const t = useT();
  return (
    <span
      role="img"
      aria-label={t('stylize.cost_label', { n: cost })}
      style={{ display: 'inline-flex', gap: 2, flex: 'none' }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <i
          key={i}
          style={{
            width: 5, height: 5, borderRadius: 1.5, display: 'block',
            background: i <= cost ? (picked ? skin.ink : skin.muted) : skin.track,
            opacity: i <= cost ? 0.9 : 0.55,
          }}
        />
      ))}
    </span>
  );
}

function DirectionRowButton({ row, picked, onPick }: {
  row: DirectionRow;
  picked: boolean;
  onPick: (id: StylizeDirection) => void;
}) {
  const t = useT();
  return (
    <motion.button
      type="button"
      data-direction={row.id}
      onClick={() => onPick(row.id)}
      {...buttonMotion}
      style={{
        ...rowStyle,
        background: picked ? PICKED_PAPER : skin.inset,
        boxShadow: picked ? `0 0 0 2.5px ${skin.active}` : `0 0 0 0 ${TRANSPARENT_ACTIVE}`,
      }}
    >
      <SampleTile
        url={packSampleUrl(row.id)}
        art={row.art}
        style={{ width: 60, flex: 'none' }}
      />
      <b style={{ ...roleFont('chip'), color: picked ? skin.ink : skin.plateInk, whiteSpace: 'nowrap', flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {t(row.nameKey)}
      </b>
      {(row.kind === 'model' || row.proc?.neural) && <AiChip picked={picked} />}
      <CostPips cost={row.cost} picked={picked} />
    </motion.button>
  );
}

const PICKED_PAPER = '#FFF7DD';

/** Transparent shadow keeps the selection-ring transition interpolable. */
const TRANSPARENT_ACTIVE = 'rgba(255,218,126,0)';

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '4px 9px 4px 4px',
  border: 'none',
  borderRadius: radii.md,
  cursor: cursors.clickable,
  flex: 'none',
  transition: cssMotion('stylize.select.ring', ['box-shadow', 'background-color']),
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  overflowY: 'auto',
  overflowX: 'hidden',
  scrollbarGutter: 'stable',
  /* Clip room for hover scaling and the selection ring. */
  padding: '6px 8px 6px 8px',
  margin: '-6px -2px -6px -8px',
};
