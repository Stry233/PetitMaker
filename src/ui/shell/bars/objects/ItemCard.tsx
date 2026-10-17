/*
 * One item in the object shelf's row: a picture and a count, as the game's cards are. Footprint and turning
 * are the ghost's to show; the name comes up on hover, drawn by the shelf outside the clipping row; the
 * count comes from the map. A click arms the item and a click on the armed one puts it away; a held
 * press, or a mouse press that moves, carries it onto the map instead (`use-card-carry.ts`).
 */
import { ActionButton } from '../../../primitives/ActionButton';
import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { iconUrl } from '../../../../assets/icon-urls';
import type { CatalogItem } from '../../../../core/model/types';
import { offerSmartBuild } from '../../../../editor/commands/smart-build';
import { localizedName, useLocale, useT } from '../../../../i18n/context';
import { usePx } from '../../../design/scale';
import { btnReset, cursors } from '../../../design/styles';
import { ACTIVE, ON_DARK, PLATE } from '../../../design/tokens';
import { GlyphIcon } from '../../GlyphIcon';
import { TEXT } from '../../units';
import { BarText, Plate } from '../bar-atoms';
import { CARD, ROW } from './object-shelf';
import { SMART } from '../smart-menu';

import cardPlate from '../../../../assets/shell/shelf-object/roundrect-1.svg';
import badgePlate from '../../../../assets/shell/shelf-mountain/tools/roundrect-3.svg';
import { useTransition } from '../../../design/motion/use-motion';
import { MOTIONS } from '../../../design/motion/registry';
import { useCardCarry } from './use-card-carry';

/** How much a carried card grows as it rises off the row: the registry's own amplitude. */
const LIFT_SCALE = 1 + MOTIONS['item.carry.lift'].amplitude;

interface Props {
  item: CatalogItem;
  placed: number;
  selected: boolean;
  onToggle: () => void;
  /** The card the pointer or keyboard is on and its centre in the row's scroll coordinates, or `null` on leave. */
  onReach: (at: { name: string; centre: number } | null) => void;
  /** Whether a press can carry the item onto the map; a chooser's cards only answer clicks. */
  carries: boolean;
}

export function ItemCard({ item, placed, selected, onToggle, onReach, carries }: Props) {
  const armedMotion = useTransition('item.armed');
  const liftMotion = useTransition('item.carry.lift');
  const { px } = usePx();
  const t = useT();
  const locale = useLocale();
  const ref = useRef<HTMLButtonElement>(null);
  const name = localizedName(item.name, locale);
  const icon = item.icon ? iconUrl(item.icon) : undefined;

  // The name above the card stays behind on the row while the card is carried off it.
  const carry = useCardCarry(item.id, ref, { enabled: carries, onLift: () => onReach(null) });

  const reach = () => {
    const el = ref.current;
    if (el) onReach({ name, centre: el.offsetLeft + el.offsetWidth / 2 });
  };

  return (
    <ActionButton
      ref={ref}
      data-catalog-id={item.id}
      interaction="action"
      aria-label={name}
      aria-pressed={selected}
      onClick={() => { if (!carry.takesClick()) onToggle(); }}
      {...carry.handlers}
      onPointerEnter={reach}
      onPointerLeave={() => onReach(null)}
      onFocus={reach}
      onBlur={() => onReach(null)}
      style={{
        ...btnReset, position: 'relative', flex: 'none',
        width: px(ROW.card), height: px(ROW.card),
        cursor: cursors.clickable, pointerEvents: 'auto',
        // The row scrolls sideways under a finger; a held finger carries the card instead.
        touchAction: 'pan-x',
      }}
    >
      <motion.span
        initial={false}
        animate={{ scale: carry.lifted ? LIFT_SCALE : 1 }}
        transition={liftMotion}
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      >
        <Plate src={cardPlate} style={{ inset: 0, width: '100%', height: '100%' }} />

        {icon ? (
          <img
            src={icon}
            alt=""
            draggable={false}
            style={{
              position: 'absolute', left: px(CARD.icon.x), top: px(CARD.icon.y),
              width: px(CARD.icon.w), height: px(CARD.icon.h), objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />
        ) : item.color ? (
          <span
            style={{
              position: 'absolute', left: px(CARD.icon.x + CARD.icon.w / 2 - 60), top: px(CARD.icon.y + 24),
              width: px(120), height: px(120), borderRadius: px(20), background: item.color,
            }}
          />
        ) : null}

        {placed > 0 ? (
          <span
            aria-label={t('shelf.placed', { n: placed })}
            style={{
              position: 'absolute', right: px(CARD.badge.right), top: px(CARD.badge.y),
              minWidth: px(CARD.badge.h), height: px(CARD.badge.h), padding: `0 ${px(12)}px`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
            }}
          >
            <Plate src={badgePlate} style={{ inset: 0, width: '100%', height: '100%' }} />
            <BarText size={TEXT.small} color={ON_DARK} weight={900} style={{ position: 'relative' }}>
              {String(placed)}
            </BarText>
          </span>
        ) : null}

        {selected ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={armedMotion}
            style={{
              position: 'absolute', inset: 0, borderRadius: px(CARD.radius),
              border: `${px(CARD.ring)}px solid ${ACTIVE}`, pointerEvents: 'none',
            }}
          />
        ) : null}
      </motion.span>
    </ActionButton>
  );
}

/** The planting card: armed and aimed like an item, wearing the item card's plate and ring with the smart-build star. */
export function SmartCard({ selected, onToggle, onReach }: {
  selected: boolean;
  onToggle: () => void;
  onReach: (at: { name: string; centre: number } | null) => void;
}) {
  const armedMotion = useTransition('item.armed');
  const { px } = usePx();
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const name = t('smart.patch');

  // The smart-build key arms this card while the shelf is up, the same press the terrain pills
  // answer on their surfaces.
  useEffect(() => offerSmartBuild(onToggle), [onToggle]);

  const reach = () => {
    const el = ref.current;
    if (el) onReach({ name, centre: el.offsetLeft + el.offsetWidth / 2 });
  };

  return (
    <ActionButton
      ref={ref}
      interaction="action"
      aria-label={name}
      aria-pressed={selected}
      data-testid="shell-smart-card"
      onClick={onToggle}
      onPointerEnter={reach}
      onPointerLeave={() => onReach(null)}
      onFocus={reach}
      onBlur={() => onReach(null)}
      style={{
        ...btnReset, position: 'relative', flex: 'none',
        width: px(ROW.card), height: px(ROW.card),
        cursor: cursors.clickable, pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Plate src={cardPlate} style={{ inset: 0, width: '100%', height: '100%' }} />
      {/* The star is dark ink, so it stands on the cream thumb where an item's sprite stands —
          on the card's own dark plate it would read as an empty tile. */}
      <span
        style={{
          position: 'absolute', left: px(CARD.icon.x), top: px(CARD.icon.y),
          width: px(CARD.icon.w), height: px(CARD.icon.h),
          borderRadius: px(CARD.radius), background: PLATE,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <GlyphIcon glyph={SMART.cellGlyph} size={px(CARD.icon.w) * 0.52} />
      </span>
      {selected ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={armedMotion}
          style={{
            position: 'absolute', inset: 0, borderRadius: px(CARD.radius),
            border: `${px(CARD.ring)}px solid ${ACTIVE}`, pointerEvents: 'none',
          }}
        />
      ) : null}
    </ActionButton>
  );
}
