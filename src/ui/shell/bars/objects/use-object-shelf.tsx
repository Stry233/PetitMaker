/**
 * What both shapes of the object shelf show: the category, the query, the items they leave, the
 * planting card and a card a reveal asked for, with the heading and the no-match line drawn from them.
 * Each shape keeps its own reach, carry and scroll state.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MutableRefObject } from 'react';
import { disarmOutsideCategory, showPlanting } from '../../../../editor/editing/object-shelf';
import type { ItemCategory } from '../../../../config/catalog/categories';
import type { CatalogItem } from '../../../../core/model/types';
import { useLocale, useT } from '../../../../i18n/context';
import { categorySearchTerms } from '../../../../i18n/terms/category-terms';
import { getObjectIndex } from '../../../../state/object-index';
import { objectShelfView, openingCategory, revealingCard, shelfItems, type ShelfView } from '../../../../state/object-shelf-view';
import { useEditorStore } from '../../../../state/store';
import { armedItemOf, armedMacroOf, armedPicksOf } from '../../../../state/editing/edit-mode';
import { macroForShelfCategory } from '../../../../tools/macros/facts';
import { useUiPreview } from '../../../design/preview';
import { btnReset, cursors, radii } from '../../../design/styles';
import { PLATE, PLATE_INK } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { useMapRevision } from '../../../session/use-map-revision';
import { BarText } from '../bar-atoms';
import { ShelfTabs } from '../ShelfTabs';
import { useRunCommand } from '../../use-shell-commands';

/**
 * `only` narrows the row to the items a caller can use; `pick` makes the shelf a chooser that reports an
 * item and arms nothing.
 */
export interface ObjectShelfProps {
  only?: (item: CatalogItem) => boolean;
  pick?: { current: string | null; onPick: (catalogId: string) => void };
  /** A query the pictured shelf shows as typed, standing in for the field's own state; the live
   *  shelf never passes this and keeps typing into its own. */
  posedQuery?: string;
  /** The whole row while a planet session is open, in place of the catalog's tabs and search. */
  source?: () => CatalogItem[];
  /** The tab the shelf was left on, kept by a caller that unmounts the shelf within one visit to the mode. */
  leftTab?: MutableRefObject<ItemCategory | null>;
}

export interface ObjectShelfModel {
  pick: ObjectShelfProps['pick'];
  category: ItemCategory;
  /** What the rows rank and show: the posed query, else the field's. */
  query: string;
  setQuery: (query: string) => void;
  /** A planet session's row, which has no categories and no search. */
  sourced: boolean;
  searching: boolean;
  items: readonly CatalogItem[];
  /** The categories that still hold something under `only`; a sourced row has none. */
  tabs: ShelfView['tabs'];
  selectTab: (category: ItemCategory) => void;
  counts: ReadonlyMap<string, number> | null;
  selectedItemId: string | null;
  armedMacro: string | null;
  /** Whether the brush button stands in the names' row: on the live shelf rather than a chooser's or a planet session's. */
  brushes: boolean;
  /** Whether some item the row shows can be painted (`placesOneAtATime`); where none can, the button is unavailable. */
  paints: boolean;
  /** The planting card, where this row offers one. */
  patch: { selected: boolean; onToggle: () => void } | null;
  isSelected: (catalogId: string) => boolean;
  /** A press on a card; `multi` (Ctrl or Cmd held) adds it to the armed items or takes it out. */
  toggleItem: (catalogId: string, multi?: boolean) => void;
  /** The card a reveal asked for, once the row it stands in is the one showing, and the call that it was. */
  revealing: string | null;
  revealed: () => void;
}

export function useObjectShelf({ only, pick, posedQuery, source, leftTab }: ObjectShelfProps): ObjectShelfModel {
  const locale = useLocale();
  const selectedItemId = useEditorStore(armedItemOf);
  const picks = useEditorStore(armedPicksOf);
  const armedMacro = useEditorStore(armedMacroOf);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const sourced = useEditorStore((s) => !!s.planetSession) && !!source;
  const run = useRunCommand();

  const [category, setCategory] = useState<ItemCategory>(
    () => openingCategory({ itemId: selectedItemId, macro: armedMacro }, macroForShelfCategory, leftTab?.current),
  );
  useEffect(() => { if (leftTab) leftTab.current = category; }, [leftTab, category]);
  const [innerQuery, setInnerQuery] = useState('');
  const [pendingReveal, setPendingReveal] = useState(() => pick ? null : selectedItemId);
  useEffect(() => {
    if (pick) return;
    const reveal = ({ catalogId }: { catalogId: string }) => {
      setCategory(openingCategory({ itemId: catalogId, macro: null }, macroForShelfCategory));
      setInnerQuery('');
      setPendingReveal(catalogId);
    };
    eventBus.on('catalog-reveal', reveal);
    return () => eventBus.off('catalog-reveal', reveal);
  }, [eventBus, pick]);
  // The one point `query` is read from: a posed figure overrides it for both ranking and display,
  // and the field itself keeps typing into `innerQuery` untouched, so the live shelf never sees it.
  const query = posedQuery ?? innerQuery;

  // Counts are patched in place, so a placement needs only the once-a-frame map revision.
  useMapRevision(true, 'frame');
  const counts = gridState ? getObjectIndex(gridState).countByCatalog : null;

  // The row re-renders per card hover and per scroll tick; the catalog ranking only owes the
  // renders where its own inputs moved.
  const all = useMemo(
    () => (sourced ? source!() : shelfItems(query, category, locale, categorySearchTerms(locale))),
    [sourced, source, query, category, locale],
  );
  const chooser = !!pick;
  const { items, tabs, searching, patchId, brushes, paints } = useMemo(
    () => objectShelfView({ query, category, all, ...(only ? { only } : {}), chooser, sourced, patchOf: macroForShelfCategory }),
    [query, category, all, only, chooser, sourced],
  );
  // The Smart Build key arms the planting card this row shows; a pictured shelf shows it none.
  const pictured = useUiPreview();
  useEffect(() => (patchId && !pictured ? showPlanting(patchId) : undefined), [patchId, pictured]);
  const revealing = revealingCard(pendingReveal, query, category);
  const revealed = useCallback(() => setPendingReveal(null), []);

  return {
    brushes, paints,
    pick, category, query, setQuery: setInnerQuery, sourced, searching, items, tabs, counts, selectedItemId, armedMacro,
    selectTab: (next) => {
      setInnerQuery('');
      setCategory(next);
      // Switching category puts down an armed item or planting card the new row does not hold; the armed
      // item's own category is how the shelf reopens on it.
      disarmOutsideCategory(next);
    },
    patch: patchId ? { selected: armedMacro === patchId, onToggle: () => run('objects.planting', { macro: patchId }) } : null,
    isSelected: (id) => (pick ? pick.current === id : picks.includes(id)),
    toggleItem: (id, multi = false) => {
      // A chooser reports. Arming here would put the map under a placement cursor and light the
      // object block, for a press that was answering a generator's question.
      if (pick) { pick.onPick(id); return; }
      run('objects.arm', multi ? { item: id, add: true } : { item: id });
    },
    revealing, revealed,
  };
}

/** The category names; a narrowed shelf shows only the categories it still has items in. */
export function ShelfCategoryTabs({ model }: { model: ObjectShelfModel }) {
  const t = useT();
  return (
    <ShelfTabs
      label={t('mode.object')}
      tabs={model.tabs.map((tab) => ({ id: tab.category, label: t(tab.labelKey) }))}
      active={model.searching ? null : model.category}
      onSelect={model.selectTab}
    />
  );
}

/** The line a search that matched nothing leaves, with the way to clear it. */
export function NoMatch({ model, style }: { model: ObjectShelfModel; style: CSSProperties }) {
  const t = useT();
  return (
    <div style={{ pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, ...style }}>
      <BarText role="note" onMap>
        {t('shelf.no_match', { q: model.query.trim() })}
      </BarText>
      <ActionButton
        interaction="tile"
        onClick={() => model.setQuery('')}
        style={{
          ...btnReset, cursor: cursors.clickable, pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', padding: '6px 20px',
          borderRadius: radii.pill, background: PLATE,
        }}
      >
        <BarText role="action" color={PLATE_INK}>{t('shelf.clear_search')}</BarText>
      </ActionButton>
    </div>
  );
}
