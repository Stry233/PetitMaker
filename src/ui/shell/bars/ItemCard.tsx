/*
 * ItemCard.tsx — one item in the object shelf's row.
 *
 * A CARD IS A PICTURE AND A COUNT, and that is the whole of it — the game's own cards carry a
 * sprite and a number and nothing else. Everything a card could say about an item it does not: the
 * footprint and whether the item turns are facts about a placement, answered by the ghost the
 * moment the item is armed and over the cell it would land on, where they can be acted on; printed
 * on the tile they are eighty small badges the eye has to sort through to find a picture.
 *
 * The NAME goes the same way, with one difference: it is how you tell two cabins apart, so it comes
 * up on hover (`onReach`) rather than not at all. The shelf draws it, not the card — the card row
 * is a scroll container and clips on both axes, so a label above a tile would be cut off inside it.
 *
 * The one fact that comes from the map is how many are standing on it, which the shelf hands in:
 * the count is a map question, and a card is not the place to ask it 83 times.
 *
 * Selecting is a toggle: a click arms the item, and a click on the armed one puts it away. The
 * shelf owns both, since only it knows what is armed.
 */
import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { iconUrl } from '../../../assets/icon-urls';
import type { CatalogItem } from '../../../core/model/types';
import { offerSmartBuild } from '../../../core/runtime/smart-build';
import { localizedName, useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { usePx } from '../../design/scale';
import { btnReset, buttonMotion, cursors } from '../../design/styles';
import { ACTIVE, ON_DARK, PLATE } from '../../design/tokens';
import { GlyphIcon } from '../GlyphIcon';
import { TEXT } from '../units';
import { BarText, Plate } from './bar-atoms';
import { CARD, ROW } from './object-shelf';
import { SMART } from './smart-menu';

import cardPlate from '../../../assets/shell/shelf-object/roundrect-1.svg';
import badgePlate from '../../../assets/shell/shelf-mountain/tools/roundrect-3.svg';
import { useMotion } from '../motion/use-motion';

interface Props {
  item: CatalogItem;
  placed: number;
  selected: boolean;
  onToggle: () => void;
  /** The card the pointer or the keyboard is on, and where it stands in the row so the shelf can
   *  put its name over it: `null` on leave. `centre` is the tile's middle in the row's own scroll
   *  coordinates, which is what survives the row being scrolled under it. */
  onReach: (at: { name: string; centre: number } | null) => void;
}

export function ItemCard({ item, placed, selected, onToggle, onReach }: Props) {
  const armedMotion = useMotion('item.armed');
  const { px } = usePx();
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const ref = useRef<HTMLButtonElement>(null);
  const name = localizedName(item.name, locale);
  const icon = item.icon ? iconUrl(item.icon) : undefined;

  const reach = () => {
    const el = ref.current;
    if (el) onReach({ name, centre: el.offsetLeft + el.offsetWidth / 2 });
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      data-catalog-id={item.id}
      {...buttonMotion}
      aria-label={name}
      aria-pressed={selected}
      onClick={onToggle}
      onPointerEnter={reach}
      onPointerLeave={() => onReach(null)}
      onFocus={reach}
      onBlur={() => onReach(null)}
      style={{
        ...btnReset, position: 'relative', flex: 'none',
        width: px(ROW.card), height: px(ROW.card),
        cursor: cursors.clickable, pointerEvents: 'auto',
      }}
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
    </motion.button>
  );
}

/**
 * The planting, as a card in the same row: the shelf's other way of placing things, offered the
 * way everything else on this row is offered — a picture you arm, then aim. It wears the item
 * card's own plate and ring so arming it reads exactly like arming a tree; what stands in the
 * picture's place is the smart-build star, which is the mark this interface already uses for "a
 * design, not a single piece".
 */
export function SmartCard({ selected, onToggle, onReach }: {
  selected: boolean;
  onToggle: () => void;
  onReach: (at: { name: string; centre: number } | null) => void;
}) {
  const armedMotion = useMotion('item.armed');
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
    <motion.button
      ref={ref}
      type="button"
      {...buttonMotion}
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
    </motion.button>
  );
}
