/*
 * Carrying blueprint cards out of the strip or the explorer. Each card or row is a list entry
 * (`bars/use-list-carry.ts`) whose lift starts the carry this shelf-wide hook builds, since a carry
 * reaches past its card: one card is armed for the carry (`editor/editing/blueprint/placing.ts:carryBlueprint`),
 * so over the map it is the blueprint tool's own ghost and a release there places it once; carried
 * above the unfolded explorer's top it folds the explorer until the release, which unfolds it again
 * unless the release placed it, whose placement is then the one live selection,
 * and the folded explorer stays mounted out of sight so the card holding the pointer and the finger's
 * touches stays too. A card carried from a selection of several carries them all, which only a folder
 * takes. Over a folder (a tab, or an entry of the wide folder list) the folder is the drop target, and
 * a release files what is carried there. While anything is carried the unfold square stands as the
 * delete target, and a release there deletes what is carried, with an Undo. Over the cards the others
 * stand aside to open the slot it would take, and a release there moves it into the library's one order
 * at that place, which the library's readers show at once while it is written (`shownBlueprints`), what
 * was carried travelling there from its copy (`useReorderGlide`). What a release does is the editor's
 * (`editor/editing/blueprint/filing.ts:dropBlueprints`); this hook finds what stands under the pointer.
 * While the pointer is over the shelf, where no map shows the blueprint's ghost, a copy of the card
 * follows it, written past React on every move.
 */
import { cloneElement, useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { listMove } from '../../../../core/base/list-move';
import {
  blueprintOrderShifts, carryBlueprint, dropBlueprints, watchBlueprintLibrary, type BlueprintDrop,
} from '../../../../editor/editing/blueprint';
import { carriedWith } from '../../../../state/blueprint-explorer-selection';
import { morphFrom, morphScope, type MorphFirst } from '../../../primitives/morph';
import { useUiPreview } from '../../../design/preview';
import type { Carry, CarrySample } from '../../../../view/interaction/pointer/carry';
import { visualRect, type VisualRect } from '../../../design/visual-rect';
import type { CarryHold } from '../use-list-carry';
import { CARD } from '../generate/generate-shelf';
import { BLUEPRINT_ID_ATTR } from './use-explorer-selection';

/** The attribute naming the folder a tab or a folder-list entry stands for, which takes dropped cards. */
export const BLUEPRINT_FOLDER_ATTR = 'data-blueprint-folder';

/** The attribute marking the delete target a carried card or stack is dropped on to delete it. */
export const BLUEPRINT_BIN_ATTR = 'data-blueprint-bin';

/** The attribute marking the picture of an entry that is no card (a row of the details list): the
 *  carried copy is the card that picture fills, lifted, held by its middle. */
export const CARRY_FACE_ATTR = 'data-blueprint-carry-face';

/** The copy of the card `id` carried from `entry` with the rest of `ids`, held by the pointer at `at`
 *  client px: a card of `card`'s size held at the share of it the pointer holds the entry at (a row by
 *  its picture's middle), starting from the size the entry draws it at (for a row, the card its picture
 *  fills), and where the other cards carried with it are drawn. */
function copyOf(ids: readonly string[], id: string, entry: HTMLElement | null, at: { x: number; y: number }, card: { w: number; h: number }): CarriedCopy {
  const { w, h } = card;
  const row = !!entry?.querySelector(`[${CARRY_FACE_ATTR}]`);
  const box = entry ? drawnCard(entry) : null;
  const share = (p: number, start: number, size: number): number => (size > 0 ? (p - start) / size : 0.5);
  const grab = row ? { x: w / 2, y: h / 2 }
    : { x: share(at.x, box?.left ?? 0, box?.width ?? 0) * w, y: share(at.y, box?.top ?? 0, box?.height ?? 0) * h };
  const gather = ids.length > 1 ? gatherOf(ids, id, entry, { x: at.x - grab.x, y: at.y - grab.y }, w) : [];
  return { id, n: ids.length, w, h, grab, from: startScale(box?.width ?? 0, w), gather, fresh: true };
}

/** The card an entry draws, in client px: a card's own box, or for a row the card its picture fills,
 *  about the picture's middle. */
function drawnCard(entry: HTMLElement): VisualRect {
  const face = entry.querySelector<HTMLElement>(`[${CARRY_FACE_ATTR}]`);
  if (!face) return visualRect(entry);
  const pic = visualRect(face);
  const w = (pic.width * CARD.w) / CARD.pic.w, h = (pic.height * CARD.h) / CARD.pic.h;
  const left = pic.left + pic.width / 2 - w / 2, top = pic.top + pic.height / 2 - h / 2;
  return { x: left, y: top, left, top, width: w, height: h, right: left + w, bottom: top + h };
}

/** Where each card of `ids` but the one held, `id`, is drawn in the scroller `entry` stands in: the
 *  offset of its box from the copy's top left at `origin` and its width over the copy's `w`, all in
 *  client px. One scrolled out of view joins at the pointer, so it has none. */
function gatherOf(ids: readonly string[], id: string, entry: HTMLElement | null, origin: { x: number; y: number }, w: number): CarriedCopy['gather'] {
  const scroller = entry?.closest<HTMLElement>(`[${BLUEPRINT_ORDER_ATTR}]`);
  if (!scroller || w <= 0) return [];
  const view = visualRect(scroller);
  const entries = [...scroller.querySelectorAll<HTMLElement>(`[${BLUEPRINT_ID_ATTR}]`)];
  return ids.flatMap((other) => {
    const el = other === id ? undefined : entries.find((e) => e.getAttribute(BLUEPRINT_ID_ATTR) === other);
    if (!el) return [];
    const box = drawnCard(el);
    const seen = box.width > 0 && box.right > view.left && box.left < view.right && box.bottom > view.top && box.top < view.bottom;
    return seen ? [{ id: other, x: box.left - origin.x, y: box.top - origin.y, scale: box.width / w }] : [];
  });
}

/** The picture of a card drawn in `card`, in client px. */
function cardPicture(card: VisualRect): VisualRect {
  const sx = card.width / CARD.w, sy = card.height / CARD.h;
  const left = card.left + CARD.pic.x * sx, top = card.top + CARD.pic.y * sy, w = CARD.pic.w * sx, h = CARD.pic.h * sy;
  return { x: left, y: top, left, top, width: w, height: h, right: left + w, bottom: top + h };
}

/** The id of the piece a blueprint's card or row picture is in a scroller of cards. */
export const cardPiece = (id: string): string => `card:${id}`;

/** The scale a copy `w` px wide starts at to stand `drawn` px wide, 1 where either is unknown. */
const startScale = (drawn: number, w: number): number => (drawn > 0 && w > 0 ? drawn / w : 1);

/** The attribute a scroller of cards wears naming how it lays them out (`CardsLayout`): a carried card
 *  or stack released over it moves among them. */
export const BLUEPRINT_ORDER_ATTR = 'data-blueprint-order';

/** The attribute naming the blueprint whose card or row a slot of such a scroller holds. */
export const BLUEPRINT_SLOT_ATTR = 'data-blueprint-slot';

/** How a scroller lays its cards out: one sideways row, a grid read row by row, or the details list. */
type CardsLayout = 'row' | 'grid' | 'list';

/** The slot a carried card would take in a scroller: before the `at`th card it shows. */
export interface CarrySlot { layout: CardsLayout; at: number }

/** `items`, a scroller's cards, with `gap` standing empty in the slot the carry opened, when it opened
 *  one in a scroller laid out as `layout`. The gap is keyed by its place, so a slot moving swaps one
 *  gap for another and never moves a card: a gap kept across moves would make React move each card it
 *  passes back over, and the carried entry, moved, loses the pointer it holds captured. */
export function withSlot(slot: CarrySlot | null, layout: CardsLayout, items: ReactElement[], gap: ReactElement): ReactElement[] {
  if (slot?.layout !== layout) return items;
  const at = Math.min(slot.at, items.length);
  return [...items.slice(0, at), cloneElement(gap, { key: `slot:${at}`, 'aria-hidden': true, 'data-blueprint-gap': '' }), ...items.slice(at)];
}

/** The cards of the scroller under the native point and the slot a card released there takes, from
 *  where they are drawn: on a card, the side of its middle the point is on (across a row and a grid,
 *  down the list); elsewhere among them, before the first card the point stands ahead of. */
function slotAt(x: number, y: number): { layout: CardsLayout; ids: string[]; at: number } | null {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  const box = hit?.closest<HTMLElement>(`[${BLUEPRINT_ORDER_ATTR}]`);
  if (!hit || !box) return null;
  const layout = box.getAttribute(BLUEPRINT_ORDER_ATTR) as CardsLayout;
  const slots = [...box.querySelectorAll<HTMLElement>(`[${BLUEPRINT_SLOT_ATTR}]`)];
  const ids = slots.map((el) => el.getAttribute(BLUEPRINT_SLOT_ATTR) ?? '');
  const ahead = (el: HTMLElement): boolean => {
    const r = visualRect(el);
    if (layout === 'list') return y < r.top + r.height / 2;
    return layout === 'grid' && y < r.top ? true : x < r.left + r.width / 2 && (layout === 'row' || y < r.bottom);
  };
  const on = hit.closest<HTMLElement>(`[${BLUEPRINT_SLOT_ATTR}]`);
  const at = on && slots.includes(on) ? slots.indexOf(on) + (ahead(on) ? 0 : 1) : slots.findIndex(ahead);
  return { layout, ids, at: at < 0 ? slots.length : at };
}

/** The attribute marking the shelf's root, over which a copy of the carried card follows the pointer. */
export const BLUEPRINT_SHELF_ATTR = 'data-blueprint-shelf';

/** The copy of a carried card under the pointer: the card's id, how many are carried, its size and
 *  where the pointer holds it, in client px, the scale it grows from, about that hold, as it lifts, and
 *  where each other card carried with it set off from (`gatherOf`); `fresh` until it first leaves the
 *  shelf, after which it shows again as it stood, with nothing to grow or gather. */
export interface CarriedCopy {
  id: string; n: number; w: number; h: number; grab: { x: number; y: number }; from: number;
  gather: { id: string; x: number; y: number; scale: number }[];
  fresh: boolean;
}

/** The copy's transform with the pointer at `x`, `y` client px. */
export const carriedAt = (copy: CarriedCopy, x: number, y: number): string =>
  `translate(${x}px, ${y}px) translate(${-copy.grab.x}px, ${-copy.grab.y}px)`;

/** The attribute marking the top edge a single carried card folds the explorer past: the wide explorer,
 *  or the upright panel. */
export const CARRY_EDGE_ATTR = 'data-blueprint-carry-edge';

export interface BlueprintCarry {
  /** One card on its way to the map or a folder, several on their way to a folder; null when nothing is carried. */
  carrying: 'one' | 'many' | null;
  /** The folder under what is carried, which a release files it in; null elsewhere. */
  dropFolder: string | null;
  /** What is carried stands over the delete target. */
  overBin: boolean;
  /** The carry began in the unfolded explorer, which stays mounted while it lasts, out of sight once
   *  the carry folds it, so the card holding the pointer and the finger's touches stays too. */
  keepsExplorer: boolean;
  /** Starts carrying blueprint `id` from the card holding `hold`; null when it cannot be carried. */
  lift: (id: string, hold: CarryHold) => Carry | null;
  /** The copy following the pointer over the shelf, and where it stands now; null off the shelf. */
  copy: { of: CarriedCopy; at: { x: number; y: number } } | null;
  /** The copy's element, which each move places. */
  copyRef: RefObject<HTMLDivElement>;
  /** The slot opened among the cards for what is carried, where a release would move it; null elsewhere,
   *  or where it would not move. */
  slot: CarrySlot | null;
  /** What the latest release among the cards moved, until the frame after it; null otherwise. */
  landing: () => Landing | null;
}

/** What a release among the cards moved (`BlueprintCarry.landing`): the cards, the one held, the copy
 *  and where it stood drawn as it let go, in client px, and the layout it was dropped in. */
export interface Landing { ids: readonly string[]; held: string; copy: HTMLElement; box: VisualRect; layout: CardsLayout }

/** The folder whose tab or entry the native point hits, or null. */
function folderAt(x: number, y: number): string | null {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  return hit?.closest(`[${BLUEPRINT_FOLDER_ATTR}]`)?.getAttribute(BLUEPRINT_FOLDER_ATTR) ?? null;
}

/** Whether the native point stands over the delete target. */
function binAt(x: number, y: number): boolean {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  return !!hit?.closest(`[${BLUEPRINT_BIN_ATTR}]`);
}

/** Whether the native point stands over the shelf rather than the map. */
function overShelf(x: number, y: number): boolean {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  return !!hit?.closest(`[${BLUEPRINT_SHELF_ATTR}]`);
}

/** The top of the edge a card in `card`'s surface folds the explorer past, in client px, or null
 *  where the card stands in no explorer. */
function edgeTop(card: HTMLElement | null): number | null {
  const edge = card?.closest<HTMLElement>(`[${CARRY_EDGE_ATTR}]`);
  return edge ? visualRect(edge).top : null;
}

/** `unfolded` says whether the explorer stands unfolded now; `foldAside` folds it aside for the carry,
 *  keeping its selection, and names the explorer it folded (null for none), which `unfoldAgain`
 *  unfolds again only while that explorer still stands aside; `card` is a strip card's size in client
 *  px, which every carried copy is drawn at; `listSorted` says whether the details list is sorted by a
 *  column, which `unsort` drops. */
export function useBlueprintCarry({ unfolded, selectedNow, foldAside, unfoldAgain, card, listSorted, unsort }: {
  unfolded: () => boolean;
  selectedNow: () => readonly string[];
  foldAside: () => number | null;
  unfoldAgain: (explorer: number) => void;
  card: () => { w: number; h: number };
  listSorted: () => boolean;
  unsort: () => void;
}): BlueprintCarry {
  const [carrying, setCarrying] = useState<BlueprintCarry['carrying']>(null);
  const [slot, setSlot] = useState<CarrySlot | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [overBin, setOverBin] = useState(false);
  const [keepsExplorer, setKeepsExplorer] = useState(false);
  const [copy, setCopy] = useState<BlueprintCarry['copy']>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const landing = useRef<Landing | null>(null);

  const lift = (id: string, hold: CarryHold): Carry | null => {
    const ids = carriedWith(id, selectedNow());
    /** The explorer the carry folded aside, which its end unfolds again. */
    let aside: number | null = null;
    let over = false;
    /** The copy, measured at the first move, when the pointer's hold on the card is known. */
    let held: CarriedCopy | null = null;
    let shown = false;
    /** The cards under `at` and the slot it points at among them; a sorted list first drops its sort,
     *  so the slot is found in the order it moves in. */
    const cardsAt = (at: CarrySample): ReturnType<typeof slotAt> => {
      const found = slotAt(at.clientX, at.clientY);
      if (!found) return null;
      if (found.layout === 'list' && listSorted()) { unsort(); return null; }
      return found;
    };
    const follow = (at: CarrySample): void => {
      held ??= copyOf(ids, id, hold.surface, { x: at.clientX, y: at.clientY }, card());
      const on = overShelf(at.clientX, at.clientY);
      if (on !== shown) {
        shown = on;
        setCopy(on ? { of: held, at: { x: at.clientX, y: at.clientY } } : null);
        // Only the lift grows and gathers the copy; back over the shelf it stands as it last stood.
        if (on) held = { ...held, fresh: false };
      }
      if (on && copyRef.current) copyRef.current.style.transform = carriedAt(held, at.clientX, at.clientY);
    };
    /** The carry is over, however it ended (the map carry can be ended from outside): the explorer it
     *  folded unfolds again, where it still stands aside. */
    const finish = (): void => {
      if (over) return;
      over = true;
      if (aside !== null) unfoldAgain(aside);
      setKeepsExplorer(false);
      setCarrying(null);
      setDropFolder(null);
      setOverBin(false);
      setSlot(null);
      setCopy(null);
      hold.onEnd();
    };
    const inner = ids.length === 1 ? carryBlueprint(id, { pointerId: hold.pointerId, surface: hold.surface, onEnd: finish }) : null;
    if (ids.length === 1 && !inner) return null;
    setCarrying(ids.length === 1 ? 'one' : 'many');
    setKeepsExplorer(unfolded());
    return {
      move(at: CarrySample) {
        if (over) return;
        const folder = folderAt(at.clientX, at.clientY), bin = binAt(at.clientX, at.clientY);
        setDropFolder(folder);
        setOverBin(bin);
        const cards = folder === null && !bin ? cardsAt(at) : null;
        // The slot opens only where a release would move what is carried.
        const open = cards && listMove(cards.ids, ids, cards.at) ? { layout: cards.layout, at: cards.at } : null;
        setSlot((was) => (was?.layout === open?.layout && was?.at === open?.at ? was : open));
        follow(at);
        if (inner && aside === null && unfolded()) {
          const top = edgeTop(hold.surface);
          if (top !== null && at.clientY < top) aside = foldAside();
        }
        inner?.move(at);
      },
      release(at: CarrySample) {
        if (over) return;
        const folder = folderAt(at.clientX, at.clientY);
        try {
          const bin = folder === null && binAt(at.clientX, at.clientY);
          const cards = folder === null && !bin ? cardsAt(at) : null;
          const drop: BlueprintDrop = folder !== null ? { on: 'folder', folder } : bin ? { on: 'bin' }
            : cards ? { on: 'cards', ids: cards.ids, at: cards.at } : { on: 'elsewhere' };
          // The cards set off from where the copy stands, which the commit the drop's move makes measures:
          // held before the drop, whose move the library's readers show at once.
          const copy = cards ? copyRef.current : null;
          const landed: Landing | null = cards && copy ? { ids, held: id, copy, box: visualRect(copy), layout: cards.layout } : null;
          const forget = (): void => { if (landing.current === landed) landing.current = null; };
          if (landed) {
            landing.current = landed;
            requestAnimationFrame(forget);
          }
          if (!dropBlueprints(ids, drop, inner && { cancel: () => inner.cancel(), release: () => inner.release(at) })) forget();
        } finally {
          finish();
        }
      },
      cancel() {
        if (over) return;
        inner?.cancel();
        finish();
      },
    };
  };

  return { carrying, dropFolder, overBin, keepsExplorer, lift, copy, copyRef, slot, landing: () => landing.current };
}

/** What a scroller of cards laid out as `layout` hands `MorphOnChange` (`primitives/MorphOnChange.tsx`)
 *  around its cards, so they travel aside as a slot opens for a carried card and close it again, and to
 *  their new places once it lands there; `sort` is the list's sort, whose change mid-carry they travel
 *  through too. */
export function useReorderGlide(carry: BlueprintCarry, layout: CardsLayout, sort: unknown, root: RefObject<HTMLElement>): {
  change: string; measure: () => MorphFirst | null; play: (first: MorphFirst) => void;
} {
  const reduced = useReducedMotionConfig() === true;
  const preview = useUiPreview();
  const still = reduced || preview;
  const [glide] = useState(() => morphScope());
  useEffect(() => () => glide.stop(), [glide]);
  const at = carry.slot?.layout === layout ? carry.slot.at : '';
  // Read with the library's own change, so the commit that shows a move's order is the one measured.
  const moves = useSyncExternalStore(watchBlueprintLibrary, blueprintOrderShifts);
  return {
    change: `${at}|${moves}|${carry.carrying ? String(sort) : ''}`,
    measure: () => {
      if (still || !root.current) return null;
      const first = glide.measure(root.current);
      // What a release dropped here sets off from its copy, a card's picture or a row's from the picture
      // of the card the copy draws. Where the copy shows more than the card it held takes on (a row's
      // picture, a stack), it travels around that one as it fades.
      const landed = carry.landing();
      if (landed?.layout === layout) {
        const trails = layout === 'list' || landed.ids.length > 1;
        for (const id of landed.ids) morphFrom(first, cardPiece(id), cardPicture(landed.box), { drew: trails && id === landed.held ? landed.copy : null });
      }
      return first;
    },
    play: (first) => { glide.play(first, 'blueprint.library.reorder'); },
  };
}
