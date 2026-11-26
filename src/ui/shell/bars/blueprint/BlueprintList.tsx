/**
 * The explorer's details view: a row per blueprint with its picture and what it records. Wide, the
 * rows stand under a head naming each column, and a press on Name or Saved sorts by it; upright, each
 * row is one line, the name over its folder, size and save day.
 */
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { motion } from 'framer-motion';
import { joinList, shortDate } from '../../../../i18n/locale-info';
import { useLocale, useT } from '../../../../i18n/context';
import type { BlueprintRecord } from '../../../../io/blueprint';
import { btnReset, cursors, radii } from '../../../design/styles';
import { ACTIVE, MUTED_INK, ON_DARK, PLATE, rgbaOf } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { ChevronIcon, PlusIcon } from '../../../primitives/line-glyphs';
import { roleSize, type TextRole } from '../../../design/text-weight';
import { BarText } from '../bar-atoms';
import { BLUEPRINT_ID_ATTR } from './use-explorer-selection';
import { BLUEPRINT_SLOT_ATTR, CARRY_FACE_ATTR, cardPiece, withSlot } from './use-blueprint-carry';
import { NO_MOTION } from '../../../design/motion';
import { useTransition } from '../../../design/motion/use-motion';
import { LIFT_SCALE } from '../objects/ItemCard';
import { entryMenu, useEntryCarry } from './BlueprintCard';
import type { BlueprintShelfModel, Pieces } from './use-blueprint-shelf';
import { MENU_SIDE, MenuCorner, useAsks } from './blueprint-asks';
import { TOUCH_TARGET } from '../../../design/scale';

/** The picture's box in a row, in css px, at the thumbnails' shape or near it. */
const THUMB = { w: 64, h: 40 } as const;

/** A row's depth, wide and upright, in css px. */
const ROW_H = { wide: 56, upright: 60 } as const;

/** The trailing cell, as wide as the menu button a row wears in touch mode. */
const TRAIL = TOUCH_TARGET;

/** The columns: the picture, the name at twice a detail's share, four details, then the trailing cell. */
const COLUMNS = `${THUMB.w}px minmax(0, 2fr) repeat(4, minmax(0, 1fr)) ${TRAIL}px`;

/** The gap between a row's columns, in css px. */
const COLUMN_GAP = 16;

/** The bar marking a selected row at its start, in css px. */
const MARK_W = 4;

/** A row's plate: lightened while it is carried, tinted while it is selected. */
const LIFTED_PLATE = rgbaOf(ON_DARK, 0.1);
const CHOSEN_PLATE = rgbaOf(ACTIVE, 0.16);
/** What a hover lays over the plate: over a selected one, the tint that makes its selected hover. */
const HOVER_TINT = rgbaOf(ON_DARK, 0.05);
const CHOSEN_HOVER_TINT = rgbaOf(ACTIVE, 0.07);

/** The details' ink: the plate's words, a step down. */
const DETAIL_INK = rgbaOf(ON_DARK, 0.72);
const QUIET_INK = rgbaOf(ON_DARK, 0.5);

/** What a blueprint's frame measures, as the list writes it. */
function useSizeOf(): (r: BlueprintRecord) => string {
  const t = useT();
  return (r) => t('blueprint.size', { w: r.body.w, h: r.body.h });
}

/** The head over the wide list: each column's name, Name and Saved sorting by themselves. */
export function ListHead({ model, piece }: { model: BlueprintShelfModel; piece: Pieces }) {
  const t = useT();
  const sorter = (sort: BlueprintShelfModel['sort'], label: string) => {
    const on = model.sort === sort;
    return (
      <ActionButton interaction="tile" aria-label={label} aria-pressed={on} onClick={() => model.setSort(sort)}
        style={{ ...btnReset, pointerEvents: 'auto', cursor: cursors.clickable, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <BarText role="small" color={on ? ON_DARK : QUIET_INK} weight={on ? 800 : 500}>{label}</BarText>
        {on ? <span aria-hidden style={{ display: 'flex', color: ON_DARK }}><ChevronIcon size={roleSize('small')} /></span> : null}
      </ActionButton>
    );
  };
  const plain = (label: string) => <BarText role="small" color={QUIET_INK} weight={500} align="left">{label}</BarText>;
  return (
    <div {...piece('list-head')} style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: COLUMN_GAP, alignItems: 'center', padding: `0 ${COLUMN_GAP}px 0 ${MARK_W + COLUMN_GAP / 2}px`, minHeight: 30 }}>
      <span />
      <span style={{ display: 'flex' }}>{sorter('name', t('blueprint.col_name'))}</span>
      {plain(t('blueprint.col_folder'))}
      {plain(t('blueprint.col_author'))}
      {plain(t('blueprint.col_size'))}
      <span style={{ display: 'flex' }}>{sorter('date', t('blueprint.col_saved'))}</span>
      <span />
    </div>
  );
}

/** One cell's words, cut with an ellipsis where they outgrow it, its full text on the title. */
function Cell({ text, role, color, weight, piece }: { text: string; role: TextRole; color: string; weight?: number; piece?: Record<string, string> }) {
  return (
    <BarText role={role} color={color} weight={weight ?? 500} align="left" style={{ minWidth: 0 }}>
      <span {...piece} title={text} style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </BarText>
  );
}

/** One row: its picture and what the blueprint records, carried off the list as a card is: carried, its
 *  picture rises as a card's face does and the row's plate lightens, while the card the picture fills
 *  follows the pointer. The picture is the piece the strip's card travels from and to, fitted inside the
 *  card's outline; the row's plate, words, rule and mark have no match on the strip, so they fade where
 *  they stand, and travel with the picture when the rows change order. The row's own fill is only a
 *  hover's tint, since the row's box moves at once when the rows change order and only pieces travel. */
function ListRow({ model, r, upright, onPress, piece }: {
  model: BlueprintShelfModel;
  r: BlueprintRecord;
  upright: boolean;
  onPress: (id: string, e: ReactMouseEvent) => void;
  piece: Pieces;
}) {
  const t = useT();
  const locale = useLocale();
  const sizeOf = useSizeOf();
  const hand = useEntryCarry(r.id, { lift: model.carry.lift, pan: 'y' });
  const liftMotion = useTransition('item.carry.lift');
  const asks = useAsks();
  const chosen = model.selected.includes(r.id);
  const folder = r.folder === null ? '' : model.folderName(r.folder);
  const date = shortDate(locale, r.savedAt);
  // Dropped among the rows, the picture travels from the carried card's, which stands at the card's
  // own size: the lift lets go at once, so the picture never shrinks inside the card fading round it.
  const landed = model.carry.landing()?.ids.includes(r.id) ?? false;
  // The lift scales inside the piece, so a move of the piece is never scaled by the lift settling; the
  // piece keeps its proportions, as a shape that re-flows would cross its old content over.
  const picture = (
    <span {...piece(cardPiece(r.id))} style={{ display: 'block', flex: 'none', width: THUMB.w, height: THUMB.h, pointerEvents: 'none' }}>
      <motion.span initial={false} animate={{ scale: hand.lifted ? LIFT_SCALE : 1 }} transition={landed ? NO_MOTION : liftMotion}
        style={{ display: 'block', width: '100%', height: '100%' }}>
        <img {...{ [CARRY_FACE_ATTR]: '' }} alt="" draggable={false} src={model.lifted ? r.thumbs.lifted : r.thumbs.flat}
          style={{ width: THUMB.w, height: THUMB.h, objectFit: 'cover', borderRadius: radii.chip, pointerEvents: 'none', display: 'block' }} />
      </motion.span>
    </span>
  );
  const row: CSSProperties = {
    // Isolated, so the plate standing behind the row's content stays over what stands behind the row.
    ...btnReset, position: 'relative', isolation: 'isolate', width: '100%', boxSizing: 'border-box', pointerEvents: 'auto', cursor: cursors.clickable,
    minHeight: upright ? ROW_H.upright : ROW_H.wide, padding: `0 ${COLUMN_GAP}px 0 ${MARK_W + COLUMN_GAP / 2}px`,
    textAlign: 'left', touchAction: hand.touchAction,
  };
  return (
    <ActionButton
      ref={hand.ref}
      {...hand.handlers}
      aria-label={r.name}
      aria-pressed={chosen}
      {...{ [BLUEPRINT_ID_ATTR]: r.id }}
      {...(hand.lifted ? { 'data-lifted': '' } : {})}
      interaction="row"
      fill={rgbaOf(ON_DARK, 0)}
      hoverFill={hand.lifted ? rgbaOf(ON_DARK, 0) : chosen ? CHOSEN_HOVER_TINT : HOVER_TINT}
      onClick={hand.click((e) => onPress(r.id, e))}
      onContextMenu={entryMenu(hand, (anchor) => asks.itemsMenu(chosen ? model.selectedNow() : [r.id], anchor))}
      style={upright
        ? { ...row, display: 'flex', alignItems: 'center', gap: COLUMN_GAP * 0.75 }
        : { ...row, display: 'grid', gridTemplateColumns: COLUMNS, columnGap: COLUMN_GAP, alignItems: 'center' }}
    >
      <motion.span aria-hidden {...piece(`row:${r.id}:plate`)} initial={false}
        animate={{ backgroundColor: hand.lifted ? LIFTED_PLATE : chosen ? CHOSEN_PLATE : rgbaOf(ON_DARK, 0) }} transition={liftMotion}
        style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }} />
      <Rule piece={piece(`row:${r.id}:rule`)} />
      {chosen ? <span aria-hidden {...piece(`row:${r.id}:mark`)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: MARK_W, background: ACTIVE }} /> : null}
      {picture}
      {upright ? (
        <span {...piece(`row:${r.id}`)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0, flex: '1 1 auto' }}>
          <Cell text={r.name} role="label" color={ON_DARK} weight={800} />
          <Cell text={joinList(locale, [folder, sizeOf(r), date].filter(Boolean), { conjunction: false })} role="chip" color={QUIET_INK} />
        </span>
      ) : (
        <>
          <Cell text={r.name} role="label" color={ON_DARK} weight={800} piece={piece(`row:${r.id}:name`)} />
          <Cell text={folder} role="chip" color={DETAIL_INK} piece={piece(`row:${r.id}:folder`)} />
          <Cell text={r.author ?? t('blueprint.anonymous')} role="chip" color={DETAIL_INK} piece={piece(`row:${r.id}:author`)} />
          <Cell text={sizeOf(r)} role="chip" color={DETAIL_INK} piece={piece(`row:${r.id}:size`)} />
          <Cell text={date} role="chip" color={DETAIL_INK} piece={piece(`row:${r.id}:date`)} />
        </>
      )}
      {/* The trailing cell the row's own button stands over, beside the row rather than in it. */}
      {upright ? <span aria-hidden style={{ width: TRAIL, flex: 'none' }} /> : <span aria-hidden />}
    </ActionButton>
  );
}

/** The line over a row, drawn as a piece of its own so it fades with the row's words. */
function Rule({ piece }: { piece: Record<string, string> }) {
  return <span aria-hidden {...piece} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: rgbaOf(ON_DARK, 0.08), pointerEvents: 'none' }} />;
}

/** The row leading the list, as the New blueprint card leads the grid: a plus where a picture stands,
 *  starting the frame step, the plus being the piece the strip's New blueprint card travels from and to. */
function NewRow({ model, upright, piece }: { model: BlueprintShelfModel; upright: boolean; piece: Pieces }) {
  const t = useT();
  const label = t('blueprint.new');
  return (
    <ActionButton
      interaction="row"
      aria-label={label}
      fill={rgbaOf(ON_DARK, 0)}
      hoverFill={rgbaOf(ON_DARK, 0.05)}
      onClick={model.newBlueprint}
      style={{
        ...btnReset, position: 'relative', width: '100%', boxSizing: 'border-box', pointerEvents: 'auto', cursor: cursors.clickable,
        minHeight: upright ? ROW_H.upright : ROW_H.wide, padding: `0 ${COLUMN_GAP}px 0 ${MARK_W + COLUMN_GAP / 2}px`,
        display: 'flex', alignItems: 'center', gap: upright ? COLUMN_GAP * 0.75 : COLUMN_GAP, textAlign: 'left',
      }}
    >
      <span aria-hidden {...piece('new-card', 'fit')} style={{
        width: THUMB.w, height: THUMB.h, flex: 'none', borderRadius: radii.chip, background: PLATE, color: MUTED_INK,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><PlusIcon size={THUMB.h / 2} /></span>
      <Cell text={label} role="label" color={ON_DARK} weight={800} piece={piece('row:new')} />
    </ActionButton>
  );
}

/** The rows of the list, after the New blueprint row, in the model's sorted order, opening a row's
 *  room where a carried card would land among them. */
export function ListRows({ model, upright, onPress, piece }: {
  model: BlueprintShelfModel;
  upright: boolean;
  onPress: (id: string, e: ReactMouseEvent) => void;
  piece: Pieces;
}) {
  return (
    <>
      <NewRow model={model} upright={upright} piece={piece} />
      {withSlot(model.carry.slot, 'list', model.listed.map((r) => (
        // The row wearing the menu button wears it at its end, beside the row rather than in it.
        <div key={r.id} {...{ [BLUEPRINT_SLOT_ATTR]: r.id }} style={{ position: 'relative' }}>
          <ListRow model={model} r={r} upright={upright} onPress={onPress} piece={piece} />
          {model.menuOn === r.id ? (
            <span {...piece(`row:${r.id}:menu`)} style={{ position: 'absolute', right: COLUMN_GAP, top: '50%', width: TRAIL, height: TRAIL, marginTop: -TRAIL / 2 }}>
              <MenuCorner id={r.id} size={MENU_SIDE} inline />
            </span>
          ) : null}
        </div>
      )), <div style={{ flex: 'none', height: upright ? ROW_H.upright : ROW_H.wide }} />)}
    </>
  );
}
