/**
 * A blueprint card: the Generate card's face with the blueprint's picture of the view the map shows,
 * and its name on the card's line. The card's box takes the shape whose picture slot is the
 * thumbnails' own shape (`io/blueprint/facts.ts:THUMB_ASPECT`), so a picture fills it uncropped.
 */
import { useRef, type RefObject, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { seconds } from '../../../design/motion';
import { useT } from '../../../../i18n/context';
import { THUMB_ASPECT } from '../../../../io/blueprint/facts';
import type { BlueprintRecord } from '../../../../io/blueprint';
import { btnReset, cursors, interactionProfilesFor, radii, SPACE, z } from '../../../design/styles';
import { ACTIVE, DARK_PLATE, MUTED_INK, ON_DARK, PLATE, PLATE_INK, rgbaOf } from '../../../design/tokens';
import { CheckIcon } from '../../../primitives/line-glyphs';
import { ActionButton } from '../../../primitives/ActionButton';
import { BarText, CardCount } from '../bar-atoms';
import { usePanelTone } from '../bar-panel';
import { MORPH_FACE_ATTR } from '../../../primitives/morph';
import { CardFace, ChosenPlate, LINE, LinePillText, linePill } from '../generate/CandidateCard';
import { CARD, CHOSEN, cardHeight } from '../generate/generate-shelf';
import { ROW, UPRIGHT_GRID, uprightCardFit } from '../objects/object-shelf';
import { LANDSCAPE_BAR, type FrameLayout } from '../../frame-plan';
import { LIFT_SCALE } from '../objects/ItemCard';
import { hoverBleed } from '../swatch-strip';
import type { Bleed } from '../../../primitives/use-scroll-row';
import { BLUEPRINT_ID_ATTR } from './use-explorer-selection';
import { carriedAt, type CarriedCopy } from './use-blueprint-carry';
import { useTransition } from '../../../design/motion/use-motion';
import { useListCarry, type CarryHold } from '../use-list-carry';
import type { Carry } from '../../../../view/interaction/pointer/carry';

/** How a card or row of the library is carried off it: what lifts it, and the axis its list scrolls
 *  by under a finger, which a press moving before the hold scrolls instead. */
interface EntryCarry {
  lift: (id: string, hold: CarryHold) => Carry | null;
  pan: 'x' | 'y';
}

/** A library entry's carry: its handlers, the click it swallows after a carry or a scroll, and its
 *  touch action, none once lifted so every finger move is the carry's. */
export function useEntryCarry(id: string, carry: EntryCarry) {
  const ref = useRef<HTMLButtonElement>(null);
  const list = useListCarry(ref, { enabled: true, lift: (hold) => carry.lift(id, hold) });
  return {
    ref,
    handlers: list.handlers,
    click: (press: (e: ReactMouseEvent) => void) => (e: ReactMouseEvent) => { if (!list.takesClick()) press(e); },
    touchAction: list.lifted ? 'none' : carry.pan === 'x' ? 'pan-x' : 'pan-y',
    lifted: list.lifted,
  } as const;
}

/** The card's width over its height: the picture slot's shares of the Generate card at the thumbnails' shape. */
export const BLUEPRINT_CARD_ASPECT = THUMB_ASPECT * (CARD.pic.h / CARD.h) / (CARD.pic.w / CARD.w);

/** The share of an upright object column a strip card stands in: wider than an object card, so a
 *  little more than two show where three object cards would, and the row reads as one that scrolls. */
const UPRIGHT_SPAN = 1.25;

/** A strip card's size in frame px, the one size a carried card is drawn at: wide, as tall as the
 *  Generate cards under the names; upright, a share of the object grid's column at UI scale `scale`. */
export function stripCard(layout: FrameLayout | null, scale: number): { w: number; h: number } {
  if (layout?.shape === 'portrait') {
    const room = layout.width - layout.edgeLeft - layout.edgeRight;
    const { columns } = uprightCardFit(room, ROW.card * scale);
    const w = ((room - (columns - 1) * UPRIGHT_GRID.gap) / columns) * UPRIGHT_SPAN;
    return { w, h: w / BLUEPRINT_CARD_ASPECT };
  }
  const h = cardHeight((layout?.bar ?? LANDSCAPE_BAR).tabsTop);
  return { w: h * BLUEPRINT_CARD_ASPECT, h };
}

/** How far a hover grows a pressed action: a card, a pill, a folder entry. */
export const ACTION_GROWS = interactionProfilesFor('pc').action.whileHover.scale;

/** The room a scroller leaves past a card `w` by `h` css px, so its chosen ring and its hover's growth
 *  stand whole at the scroller's edges. */
export function cardBleed(w: number, h: number): Bleed {
  const x = hoverBleed(w / 2, w * CHOSEN.insetX, ACTION_GROWS), y = hoverBleed(h / 2, h * CHOSEN.insetY, ACTION_GROWS);
  return { top: y, right: x, bottom: y, left: x };
}

const BOX: CSSProperties = { position: 'relative', width: '100%', aspectRatio: String(BLUEPRINT_CARD_ASPECT) };

/** The attribute marking a card's name, which a mouse's double click renames. */
const NAME_ATTR = 'data-blueprint-name';

/** The name on the card's line, cut with an ellipsis where it outgrows the card, in the plate ink on
 *  a cream panel, where the card's plate is light (`CardFace`). */
export function CardLine({ text }: { text: string }) {
  const ink = usePanelTone() === 'cream' ? PLATE_INK : PLATE;
  return (
    <BarText role="small" color={ink} style={{ ...LINE, padding: '0 8%' }}>
      <span {...{ [NAME_ATTR]: '' }} style={{ display: 'block', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </BarText>
  );
}

/** The tick circle's side, in css px. */
const TICK = 24;

/** The circle a card wears while a finger picks several: filled and ticked once picked. */
function Tick({ on }: { on: boolean }) {
  return (
    <span data-testid="blueprint-tick" aria-hidden style={{
      position: 'absolute', left: '4%', top: '6%', zIndex: 1, width: TICK, height: TICK, boxSizing: 'border-box', borderRadius: radii.pill,
      border: `2px solid ${on ? ACTIVE : ON_DARK}`, background: on ? ACTIVE : rgbaOf(DARK_PLATE, 0.5), color: PLATE_INK,
      display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    }}>
      {on ? <CheckIcon size={TICK * 0.6} /> : null}
    </span>
  );
}

/** A library entry's right press: the carry's own first, then, unless a finger's hold made it (which
 *  lifts the entry instead), the entry's menu. */
export function entryMenu(hand: { handlers: { onContextMenu: (e: { preventDefault: () => void }) => void } }, onMenu?: (anchor: HTMLElement) => void) {
  return (e: ReactMouseEvent<HTMLElement>): void => {
    hand.handlers.onContextMenu(e);
    if (!onMenu || (e.nativeEvent as Partial<PointerEvent>).pointerType === 'touch') return;
    e.preventDefault();
    onMenu(e.currentTarget);
  };
}

/** Whether a click is a mouse's second on a card's name. */
const renamesByName = (e: ReactMouseEvent): boolean =>
  e.detail >= 2 && (e.nativeEvent as Partial<PointerEvent>).pointerType !== 'touch' && !!(e.target as Element).closest?.(`[${NAME_ATTR}]`);

/** A card's picture, which a details row's picture travels to and from, the card around it (`MORPH_FACE_ATTR`). */
const FACE = { [MORPH_FACE_ATTR]: '' };

export function BlueprintCard({ record, lifted, chosen, onPress, tick, carry, onRename, onMenu }: {
  record: BlueprintRecord;
  /** Whether the map shows its 3D view, whose picture the card then shows. */
  lifted: boolean;
  /** Armed on the strip, selected in the explorer: the card wears the chosen ring. */
  chosen: boolean;
  onPress: (e: ReactMouseEvent) => void;
  /** While a finger picks several, the card shows its tick circle. */
  tick?: boolean;
  carry: EntryCarry;
  /** A mouse's double click on the name renames, the card the anchor. */
  onRename?: (anchor: HTMLElement) => void;
  /** A right press opens the card's menu there. */
  onMenu?: (anchor: HTMLElement) => void;
}) {
  const hand = useEntryCarry(record.id, carry);
  const liftMotion = useTransition('item.carry.lift');
  return (
    <ActionButton
      ref={hand.ref}
      {...hand.handlers}
      interaction="action"
      aria-label={record.name}
      aria-pressed={chosen}
      title={record.name}
      {...{ [BLUEPRINT_ID_ATTR]: record.id }}
      {...(hand.lifted ? { 'data-lifted': '' } : {})}
      onClick={hand.click((e) => { if (onRename && renamesByName(e)) onRename(e.currentTarget as HTMLElement); else onPress(e); })}
      onContextMenu={entryMenu(hand, onMenu)}
      style={{ ...btnReset, ...BOX, cursor: cursors.clickable, pointerEvents: 'auto', touchAction: hand.touchAction }}
    >
      {/* Carried, the card rises off its row as an object card does, and settles back when it ends. */}
      <motion.span initial={false} animate={{ scale: hand.lifted ? LIFT_SCALE : 1 }} transition={liftMotion}
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}>
        <ChosenPlate chosen={chosen} />
        <CardFace shot={lifted ? record.thumbs.lifted : record.thumbs.flat} waited={false} face={FACE} />
        <CardLine text={record.name} />
        {tick ? <Tick on={chosen} /> : null}
      </motion.span>
    </ActionButton>
  );
}

/** What a carried copy draws in its `w` by `h` client px box, at the frame's `zoom`. */
function Zoomed({ w, h, zoom, children }: { w: number; h: number; zoom: number; children: ReactNode }) {
  return <span style={{ position: 'absolute', left: 0, top: 0, width: w / zoom, height: h / zoom, zoom, display: 'block' }}>{children}</span>;
}

/** A carried copy's face: the card's picture and name, or an empty face where there is no record. */
function CopyFace({ record, lifted, w, h, zoom }: { record: BlueprintRecord | null; lifted: boolean; w: number; h: number; zoom: number }) {
  return (
    <Zoomed w={w} h={h} zoom={zoom}>
      <CardFace shot={record ? (lifted ? record.thumbs.lifted : record.thumbs.flat) : null} waited={false} />
      {record ? <CardLine text={record.name} /> : null}
    </Zoomed>
  );
}

/** How far a carried copy shrinks about the pointer over a folder or the delete target, as the share
 *  of its size it stands at, saying a release drops it in there. */
const DROP_SCALE = 0.6;

/** The copy of a carried card standing under the pointer over the shelf, at a strip card's size,
 *  placed by the carry on every move (`use-blueprint-carry.ts`). It grows from the size its entry draws
 *  it at to its own about the point the pointer holds, as the entry rises. Several carried first gather:
 *  a copy of each card in view travels from its slot to the pointer, and only then does the stack
 *  form, plates stepping out behind the card and the badge counting them arriving. Over a folder or
 *  the delete target (`dropping`) it shrinks about the pointer, and grows back as it leaves. */
export function CarriedCard({ record, recordOf, lifted, copy, at, copyRef, zoom, dropping }: {
  record: BlueprintRecord; recordOf: (id: string) => BlueprintRecord | undefined; lifted: boolean;
  copy: CarriedCopy; at: { x: number; y: number };
  copyRef: RefObject<HTMLDivElement>;
  /** The frame's zoom, which the card's content is drawn at. */
  zoom: number;
  dropping: boolean;
}) {
  const reduced = useReducedMotionConfig() === true;
  const liftMotion = useTransition('item.carry.lift');
  const gatherMotion = useTransition('blueprint.carry.gather');
  const dropMotion = useTransition('control.drop');
  const moving = copy.fresh && !reduced;
  // The stack forms once the gathering has landed.
  const formMotion = moving ? { ...gatherMotion, delay: seconds('blueprint.carry.gather') } : gatherMotion;
  const origin = `${copy.grab.x}px ${copy.grab.y}px`;
  const layer: CSSProperties = { position: 'absolute', inset: 0, display: 'block' };
  return createPortal(
    <div ref={copyRef} data-testid="blueprint-carried" aria-hidden style={{
      position: 'fixed', left: 0, top: 0, width: copy.w, height: copy.h, transform: carriedAt(copy, at.x, at.y),
      pointerEvents: 'none', zIndex: z.popover,
    }}>
      <motion.span initial={false} animate={{ scale: dropping ? DROP_SCALE : 1 }} transition={dropMotion} style={{ ...layer, transformOrigin: origin }}>
        {copy.n > 1 ? [2, 1].map((k) => (
          <motion.span key={k} initial={moving ? { x: 0, y: 0 } : false} animate={{ x: k * STACK_STEP * zoom, y: -k * STACK_STEP * zoom }}
            transition={formMotion} style={{ ...layer, opacity: 1 - k * 0.25 }}>
            <CopyFace record={null} lifted={lifted} w={copy.w} h={copy.h} zoom={zoom} />
          </motion.span>
        )) : null}
        {moving ? copy.gather.map((g) => {
          const joining = recordOf(g.id);
          return joining ? (
            <motion.span key={g.id} initial={{ x: g.x, y: g.y, scale: g.scale }} animate={{ x: 0, y: 0, scale: 1 }} transition={gatherMotion}
              style={{ ...layer, transformOrigin: '0 0' }}>
              <CopyFace record={joining} lifted={lifted} w={copy.w} h={copy.h} zoom={zoom} />
            </motion.span>
          ) : null;
        }) : null}
        <motion.span initial={moving ? { scale: copy.from } : false} animate={{ scale: 1 }} transition={liftMotion}
          style={{ ...layer, transformOrigin: origin }}>
          <CopyFace record={record} lifted={lifted} w={copy.w} h={copy.h} zoom={zoom} />
        </motion.span>
        {copy.n > 1 ? (
          <motion.span initial={moving ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={formMotion} style={layer}>
            <Zoomed w={copy.w} h={copy.h} zoom={zoom}>
              <CardCount n={copy.n} height={BADGE} pad={SPACE[3]} right={-BADGE / 3} top={-BADGE / 3} testId="blueprint-stack-count" />
            </Zoomed>
          </motion.span>
        ) : null}
      </motion.span>
    </div>,
    document.body,
  );
}

/** How far each plate behind a carried stack stands off the card, in css px. */
const STACK_STEP = 6;

/** The depth of the count a stack wears on its corner, in css px. */
const BADGE = 26;

/** The card leading the row and the grid, drawn as Generate's import card: the empty face with its
 *  mark, and New blueprint on its line, starting the frame step. */
export function NewBlueprintCard({ onPress }: { onPress: () => void }) {
  const t = useT();
  const label = t('blueprint.new');
  return (
    <ActionButton
      interaction="action"
      aria-label={label}
      data-testid="shell-blueprint-new"
      onClick={onPress}
      style={{ ...btnReset, ...BOX, cursor: cursors.clickable, pointerEvents: 'auto' }}
    >
      <CardFace shot={null} waited={false} face={FACE} placeholder={<BarText role="lead" color={MUTED_INK} weight={900}>+</BarText>} />
      <span style={{ ...LINE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={linePill()}><LinePillText text={label} /></span>
      </span>
    </ActionButton>
  );
}
