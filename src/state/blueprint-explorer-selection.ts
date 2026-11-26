/**
 * How presses pick blueprints in Blueprint's explorer, given the order its view shows the cards in. A
 * press selects one; with a mouse, Ctrl (or Cmd) toggles one and Shift reaches from the last card
 * pressed alone or toggled; while a finger picks several with tick circles, a press toggles one. A
 * second press on the same card in quick succession takes it to the map instead. A box drawn over the
 * view's empty space selects what it touches, added to the selection with Ctrl, and a press there
 * that draws none selects nothing. A card carried from a selection of several carries them all.
 */

/** A press on a card or row. */
export interface ExplorerPress {
  readonly id: string;
  /** Ctrl or Cmd was held. */
  readonly toggle: boolean;
  /** Shift was held. */
  readonly extend: boolean;
  /** A second press on the same card in quick succession, or a double click. */
  readonly repeat: boolean;
}

/** What a press is read against. */
export interface ExplorerPicks {
  /** The selection among the cards shown, as made. */
  readonly selected: readonly string[];
  /** The ids of the cards in the order the view shows them. */
  readonly order: readonly string[];
  /** The card Shift reaches from, or null. */
  readonly anchor: string | null;
  /** A finger picks several with tick circles. */
  readonly picking: boolean;
  /** Touch input, where Ctrl and Shift do nothing. */
  readonly touch: boolean;
}

/** What a press does: takes the card to the map, or selects `select` with `anchor` as Shift's next start. */
type PressPicks = { readonly take: string } | { readonly select: readonly string[]; readonly anchor: string | null };

const toggled = (ids: readonly string[], id: string): readonly string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

export function pressPicks(p: ExplorerPress, at: ExplorerPicks): PressPicks {
  if (!at.picking && !p.toggle && !p.extend && p.repeat) return { take: p.id };
  if (at.picking) return { select: toggled(at.selected, p.id), anchor: at.anchor };
  if (!at.touch && p.toggle) return { select: toggled(at.selected, p.id), anchor: p.id };
  const from = at.anchor === null ? -1 : at.order.indexOf(at.anchor);
  if (!at.touch && p.extend && from >= 0) {
    const to = at.order.indexOf(p.id);
    return { select: at.order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor: at.anchor };
  }
  return { select: [p.id], anchor: p.id };
}

/** The blueprints a carry of card `id` takes: the whole selection when it holds `id` among others, else `id` alone. */
export const carriedWith = (id: string, selected: readonly string[]): readonly string[] =>
  (selected.length > 1 && selected.includes(id) ? selected : [id]);

/** The selection a box starts from: the one standing when Ctrl or Cmd was held (`adding`), else none. */
export const boxBase = (adding: boolean, selected: readonly string[]): readonly string[] => (adding ? selected : []);

/** What a box selects: the selection it started from, then each card it touches not already in it. */
export const boxPicks = (base: readonly string[], touched: readonly string[]): readonly string[] =>
  [...base, ...touched.filter((id) => !base.includes(id))];
