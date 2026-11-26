/**
 * The Blueprint strip unfolded on a wide window: the band standing window wide over the column and
 * the character's seat, the folders as a list down its left with their counts and Import under them,
 * and beside them the folder's title and the head's one family of round controls, New folder, Export,
 * the search, the view switch and the fold button, in touch mode a fingertip tall (`headFamily`) after
 * Select, the search folded into a round button, over the cards in four columns led by New blueprint,
 * or the details list. A card or folder is handled directly: a right press on a card, or in
 * touch mode the one selected card's menu button, opens the card's menu, a right press or a hold on a
 * folder opens its own menu, and a carried card or stack is dropped on a folder or on the fold button,
 * which stands as the delete target while it is carried.
 * The parts both the wide and the upright explorer show live here too.
 */
import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { SUPPORTS_JSON_FILES } from '../../../../platform/build/edition';
import { showToast } from '../../../../platform/channels/toast-bus';
import { JSON_ACCEPT } from '../../../../io/import/facts';
import { useTouchMode } from '../../../design/input-mode';
import { TOUCH_TARGET } from '../../../design/scale';
import { btnReset, cursors, interactionProfilesFor, radii, SPACE, zCards } from '../../../design/styles';
import { ACTIVE, ON_DARK, PLATE, PLATE_INK, rgbaOf } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { FolderIcon, GridIcon, ImportFileIcon, ListIcon, ShrinkIcon } from '../../../primitives/line-glyphs';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { useAway } from '../../../primitives/away';
import { SEAM_HANDLE } from '../../../primitives/SeamHandle';
import { useScrollFade } from '../../../primitives/scroll-fade';
import { CONTROL_CLEARANCE, scrollBleed } from '../../../primitives/use-scroll-row';
import { hoverBleed } from '../swatch-strip';
import { useImportFlow } from '../../../chrome/modals/import/use-import-flow';
import { useFilePick } from '../../../primitives/use-file-pick';
import { BarText } from '../bar-atoms';
import type { BarSurface } from '../bar-panel';
import { SEARCH } from '../objects/object-shelf';
import { ShelfSearchField } from '../objects/ShelfSearchField';
import { DROP_TARGET_FILL } from '../ShelfTabs';
import { ACTION_GROWS, BLUEPRINT_CARD_ASPECT, BlueprintCard, NewBlueprintCard } from './BlueprintCard';
import { ExportButton, MENU_SIDE, MenuCorner, NewFolderButton, useAsks, useFolderPress } from './blueprint-asks';
import { RoundPlateButton } from '../RoundPlateButton';
import { ICON_SHARE, ShelfSearchPill, underOpenSearch } from '../objects/ShelfSearchPill';
import { useNameReveal } from '../../../primitives/use-name-reveal';
import { BinSquare, SwapFace } from './BinSquare';
import { ListHead, ListRows } from './BlueprintList';
import { useExplorerSelection } from './use-explorer-selection';
import { folderPiece, folderRide, PiecesKept, SQUARE_RIDE, usePieces, type BlueprintShelfModel, type Pieces } from './use-blueprint-shelf';
import { BLUEPRINT_FOLDER_ATTR, BLUEPRINT_ORDER_ATTR, BLUEPRINT_SLOT_ATTR, CARRY_EDGE_ATTR, cardPiece, useReorderGlide, withSlot } from './use-blueprint-carry';
import { MorphOnChange } from '../../../primitives/MorphOnChange';
import type { MorphFirst } from '../../../primitives/morph';
import { tourTargetAttr } from '../../../chrome/tour/steps';

/** The wide explorer's measures, in css px: its inset from the band's edges, the folder list's width
 *  and an entry's depth, the gap between its regions and between cards, and the head row's depth. */
const WIDE = { inset: SPACE[12], top: SPACE[13], nav: 228, entry: 46, gap: SPACE[11], card: SPACE[8], head: 46 } as const;

/** The room the folder list leaves past its entries, so a hovered entry stands whole. */
const ENTRY_BLEED = scrollBleed({
  top: hoverBleed(WIDE.entry / 2, 0, ACTION_GROWS), bottom: hoverBleed(WIDE.entry / 2, 0, ACTION_GROWS),
  left: hoverBleed(WIDE.nav / 2, 0, ACTION_GROWS), right: hoverBleed(WIDE.nav / 2, 0, ACTION_GROWS),
});

/** The room the details list leaves past a row's sides: half a hovered row's growth, as a share of the
 *  list's width, which the rows fill. */
const ROW_BLEED = `calc(${((interactionProfilesFor('pc').row.whileHover.scale - 1) / 2) * 100}% + ${CONTROL_CLEARANCE} + 1px)`;

/** How far a finger pulls the wide band up to unfold it, in visual px: a handle's depth, well past any
 *  drag threshold. */
export const PULL = SEAM_HANDLE.h;

/** The padding round the cards in the view, in css px: the chosen ring stands out past a card and
 *  stays inside the scroll. */
export const VIEW_BLEED = SPACE[4];

/** The grid's padding: the chosen ring's room, and past it, held off the layout, a hovered card's
 *  growth (a share of a column, which is a share of the view's width) with the focus envelope. */
function gridBleed(columns: number): CSSProperties {
  const grow = `calc(${((ACTION_GROWS - 1) / 2 / columns) * 100}% + ${CONTROL_CLEARANCE})`;
  return { padding: `calc(${VIEW_BLEED}px + ${grow})`, margin: `calc(0px - ${grow})` };
}

/** On the explorer's cards or details list with its head: what its view, folder or search re-arranges
 *  (`use-blueprint-shelf.ts:useShelfChange`), while the folders and the head's controls stand still. */
const EXPLORER_VIEW_ATTR = 'data-blueprint-view';

/** The explorer's cards or details list inside `root`, or null where it stands folded. */
export const explorerViewIn = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(`[${EXPLORER_VIEW_ATTR}]`);

/** The controls standing beside the search on the explorer's head, which ride it. */
const SEARCH_RIDE = { on: 'search' } as const;

/** The head family's control side and the air between its controls, in css px, for a head whose
 *  controls stand `base` px tall with a mouse: in touch mode the fingertip the touch bars' round buttons
 *  stand at, the air grown in the same proportion. */
export function headFamily(base: number, touch: boolean): { size: number; gap: number } {
  const size = touch ? Math.max(base, TOUCH_TARGET) : base;
  return { size, gap: Math.round((SPACE[6] * size) / base) };
}

/** The large-icons and details switch. */
export function ViewSwitch({ model, height, piece }: { model: BlueprintShelfModel; height: number; piece: Pieces }) {
  const t = useT();
  return (
    <span {...piece('view', undefined, SEARCH_RIDE)} style={{ display: 'flex', flex: 'none', pointerEvents: 'auto' }}>
      <SegmentedControl idPrefix="blueprint-view" track="plate" value={model.view} options={['grid', 'list'] as const} onChange={model.setView}
        label={(o) => t(o === 'grid' ? 'blueprint.view_grid' : 'blueprint.view_list')} stretch={false} height={height}
        render={(o) => <span style={{ display: 'flex', color: PLATE_INK }}>{o === 'grid' ? <GridIcon size={18} /> : <ListIcon size={18} />}</span>} />
    </span>
  );
}

/** Under touch, Select turns on the tick circles for picking several, and becomes Done: a word on the
 *  head family's plate at its `size`, in the search's type role, standing on the view switch's yellow
 *  plate while it is on. */
export function PickButton({ model, size, piece }: { model: BlueprintShelfModel; size: number; piece: Pieces }) {
  const t = useT();
  return (
    <span {...piece('pick', undefined, SEARCH_RIDE)} style={{ display: 'flex', flex: 'none' }}>
      <RoundPlateButton size={size} width="auto" aria-pressed={model.picking} fill={model.picking ? ACTIVE : PLATE}
        onClick={() => model.setPicking(!model.picking)} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <BarText role="lead" color={PLATE_INK}>{t(model.picking ? 'blueprint.pick_done' : 'blueprint.pick')}</BarText>
      </RoundPlateButton>
    </span>
  );
}

/**
 * The cards in `columns` columns, or the details list, scrolling down; a press picks as
 * `use-explorer-selection.ts` says, and a mouse dragged over the grid's empty space draws a box.
 */
export function ExplorerView({ model, columns, gap, upright, piece, style }: {
  model: BlueprintShelfModel;
  columns: number;
  gap: number;
  upright: boolean;
  piece: Pieces;
  style?: CSSProperties;
}) {
  const touch = useTouchMode();
  const ref = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(ref, 'y');
  const { press, area, box } = useExplorerSelection(model, model.order, touch);
  const asks = useAsks();
  const list = model.view === 'list';
  const glide = useReorderGlide(model.carry, list ? 'list' : 'grid', model.sort, ref);
  return (
    <div {...{ [EXPLORER_VIEW_ATTR]: '' }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
      {list && !upright ? <ListHead model={model} piece={piece} /> : null}
      <div
        ref={ref}
        data-testid="blueprint-explorer-cards"
        className="pw-noscroll"
        {...{ [BLUEPRINT_ORDER_ATTR]: list ? 'list' : 'grid' }}
        {...(list ? {} : area)}
        style={{
          position: 'relative', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
          pointerEvents: 'auto', ...fade,
          // A hovered row grows by a share of its width, so the list leaves that share past its sides.
          ...(list ? { display: 'flex', flexDirection: 'column', ...scrollBleed({ top: CONTROL_CLEARANCE, bottom: CONTROL_CLEARANCE, left: ROW_BLEED, right: ROW_BLEED }) }
            : { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap, alignContent: 'start', ...gridBleed(columns) }),
        }}
      >
        <MorphOnChange<MorphFirst> {...glide}>
          {list ? <ListRows model={model} upright={upright} onPress={press} piece={piece} />
            : [<div key="new" {...piece('new-card')} style={{ minWidth: 0 }}><NewBlueprintCard onPress={model.newBlueprint} /></div>,
              ...withSlot(model.carry.slot, 'grid', model.records.map((r) => {
                const chosen = model.selected.includes(r.id);
                return (
                  <div key={r.id} {...piece(cardPiece(r.id))} {...{ [BLUEPRINT_SLOT_ATTR]: r.id }} style={{ position: 'relative', zIndex: chosen ? zCards.chosen : 0, minWidth: 0 }}>
                    <BlueprintCard record={r} lifted={model.lifted} chosen={chosen} tick={model.picking}
                      onPress={(e: ReactMouseEvent) => press(r.id, e)} carry={{ lift: model.carry.lift, pan: 'y' }}
                      onRename={(anchor) => { model.select([r.id]); asks.rename(r.id, anchor); }}
                      onMenu={(anchor) => asks.itemsMenu(chosen ? model.selectedNow() : [r.id], anchor)} />
                    {model.menuOn === r.id ? <MenuCorner id={r.id} size={MENU_SIDE} /> : null}
                  </div>
                );
              }), <div style={{ minWidth: 0, aspectRatio: String(BLUEPRINT_CARD_ASPECT) }} />)]}
        </MorphOnChange>
        {box ? (
          <span aria-hidden style={{
            position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, zIndex: zCards.over, pointerEvents: 'none',
            border: `2px solid ${ACTIVE}`, background: rgbaOf(ACTIVE, 0.14), borderRadius: radii.sm, boxSizing: 'border-box',
          }} />
        ) : null}
      </div>
    </div>
  );
}

/** The explorer folded but kept mounted (a carried card folded it, so the card holding the pointer
 *  stays; or it is warmed to unfold): drawn nowhere, clipped to nothing, away and wearing no piece ids,
 *  so no morph, hit test, focus or reading finds it until it unfolds again. */
export function ExplorerKept({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const away = useAway(hidden);
  return (
    <div {...away} style={hidden
      ? { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }
      : { display: 'contents' }}>
      <PiecesKept.Provider value={hidden}>{children}</PiecesKept.Provider>
    </div>
  );
}

/** One entry of the folder list: its glyph, its name and, for a folder, how many it holds. */
function FolderEntry({ label, icon, count, active, onPress, piece, role, folder, target }: {
  label: string; icon: ReactNode; count?: number; active?: boolean; onPress: () => void; piece: Record<string, string>;
  role?: 'tab';
  /** The folder a carried card dropped here is filed in, whose own menu a right press or a hold opens;
   *  `target` while a carried card is over it. */
  folder?: string; target?: boolean;
}) {
  const press = useFolderPress();
  const ink = active ? PLATE_INK : role ? rgbaOf(ON_DARK, 0.88) : rgbaOf(ON_DARK, 0.6);
  const rest = active ? ACTIVE : target ? DROP_TARGET_FILL : rgbaOf(ON_DARK, 0);
  return (
    <ActionButton
      {...piece}
      {...(folder === undefined ? {} : { [BLUEPRINT_FOLDER_ATTR]: folder, ...press(folder) })}
      interaction="action"
      {...(role ? { role, 'aria-selected': !!active } : {})}
      aria-label={label}
      fill={rest}
      hoverFill={active ? ACTIVE : target ? rest : rgbaOf(ON_DARK, 0.08)}
      onClick={onPress}
      style={{
        ...btnReset, position: 'relative', boxSizing: 'border-box', width: '100%', height: WIDE.entry, flex: 'none', pointerEvents: 'auto',
        cursor: cursors.clickable, borderRadius: radii.md, padding: `0 ${SPACE[8]}px`,
        display: 'flex', alignItems: 'center', gap: SPACE[6], color: ink,
      }}
    >
      <span aria-hidden style={{ display: 'flex', flex: 'none' }}>{icon}</span>
      <BarText role="head" color={ink} align="left" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </BarText>
      {count === undefined ? null : (
        <BarText role="small" weight={500} color={active ? rgbaOf(PLATE_INK, 0.6) : rgbaOf(ON_DARK, 0.45)}>{String(count)}</BarText>
      )}
    </ActionButton>
  );
}

/** Where a picked file goes: a blueprint file into the library, a file of another window's kind on to
 *  that window, anything else refused with the import's own reason. */
const ROUTING = { map: 'hand', planet: 'hand', video: 'hand', unknown: 'refuse' } as const;

/** The folders down the left from the band's top: All and each folder with their counts, then Import. */
function FolderList({ model, piece }: { model: BlueprintShelfModel; piece: Pieces }) {
  const t = useT();
  const flow = useImportFlow({ routing: ROUTING, onRefused: () => showToast(t('blueprint.import_failed'), 'error') });
  const file = useFilePick({ accept: JSON_ACCEPT, onFile: (f) => { void flow.take(f); } });
  const glyph = 20;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE[3], width: WIDE.nav, flex: 'none', minHeight: 0 }}>
      <div role="tablist" aria-orientation="vertical" aria-label={t('mode.blueprint')} className="pw-noscroll" {...tourTargetAttr('blueprint-folders')}
        style={{ display: 'flex', flexDirection: 'column', gap: SPACE[3], overflowY: 'auto', minHeight: 0, flex: '0 1 auto', pointerEvents: 'auto', ...ENTRY_BLEED }}>
        {[null, ...model.folders].map((f) => (
          <FolderEntry key={f ?? ''} role="tab" piece={piece(folderPiece(f), 'fit', folderRide(f))} label={f === null ? t('blueprint.all') : model.folderName(f)}
            icon={f === null ? <GridIcon size={glyph} /> : <FolderIcon size={glyph} />} count={model.countOf(f)}
            active={!model.searching && model.folder === f} onPress={() => model.setFolder(f)}
            {...(f === null ? {} : { folder: f, target: model.carry.dropFolder === f })} />
        ))}
      </div>
      {SUPPORTS_JSON_FILES ? (
        <>
          <FolderEntry piece={{ ...piece('import', undefined, { on: folderPiece(null) }), ...tourTargetAttr('blueprint-import') }} label={t('blueprint.import')} icon={<ImportFileIcon size={glyph} />}
            onPress={file.pick} />
          <input {...file.input} />
        </>
      ) : null}
    </div>
  );
}

/** The fold control at the head's end, a round button as its neighbours are; the delete target while
 *  a card or stack is carried, the two crossfading where they stand at one size. */
function FoldButton({ model, size, piece }: { model: BlueprintShelfModel; size: number; piece: Pieces }) {
  const t = useT();
  const glyph = Math.round(size * ICON_SHARE);
  const binning = model.carry.carrying !== null;
  const unfoldPiece = piece('unfold', undefined, SQUARE_RIDE);
  const label = t('blueprint.unfold');
  const name = useNameReveal(label, 'below');
  return (
    <div style={{ position: 'relative', flex: 'none', width: size, height: size }}>
      <SwapFace shown={binning} style={{ position: 'absolute', inset: 0 }}>
        <BinSquare over={model.carry.overBin} width={size} height={size} radius={radii.pill} glyph={glyph} {...(binning ? { piece: unfoldPiece } : {})} />
      </SwapFace>
      <SwapFace shown={!binning} style={{ position: 'absolute', inset: 0 }}>
        <RoundPlateButton {...name.bind} {...(binning ? {} : unfoldPiece)} size={size} aria-label={label} aria-pressed data-testid="shell-blueprint-fold"
          onClick={() => model.unfold(false)} style={{ alignItems: 'center', justifyContent: 'center' }}>
          <ShrinkIcon size={glyph} />
          {name.bubble}
        </RoundPlateButton>
      </SwapFace>
    </div>
  );
}

export function BlueprintExplorer({ model, surface, height }: { model: BlueprintShelfModel; surface: BarSurface; height: number }) {
  const t = useT();
  const touch = useTouchMode();
  const piece = usePieces();
  const reduced = useReducedMotionConfig();
  const { size, gap } = headFamily(SEARCH.h, touch);
  // In touch mode the search is a round button that opens into the field over the controls before it;
  // a query typed before stays in sight.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchShown = touch && (searchOpen || model.query !== '');
  const under = underOpenSearch(searchShown, reduced);
  const title = model.folder === null ? t('blueprint.all') : model.folderName(model.folder);
  return (
    <div
      {...surface.content.start}
      {...{ [CARRY_EDGE_ATTR]: '' }}
      data-testid="blueprint-explorer"
      style={{
        position: 'relative', width: '100%', height, boxSizing: 'border-box', pointerEvents: 'none',
        padding: `${WIDE.top}px ${WIDE.inset}px ${WIDE.inset}px`, display: 'flex', alignItems: 'stretch', gap: WIDE.gap,
      }}
    >
      <FolderList model={model} piece={piece} />
      {/* The strip has no rule beside its folders, so this one fades where it stands. */}
      <span aria-hidden {...piece('folders-rule')} style={{ width: 1, flex: 'none', background: rgbaOf(ON_DARK, 0.1) }} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE[8] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap, height: WIDE.head, flex: 'none', minWidth: 0 }}>
          <span {...piece('title')} style={{ display: 'flex', alignItems: 'baseline', gap: SPACE[6], minWidth: 0, flex: '0 1 auto' }}>
            <BarText role="title" color={ON_DARK} align="left" style={{ minWidth: 0 }}>
              <span style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            </BarText>
            <BarText role="small" weight={500} color={rgbaOf(ON_DARK, 0.5)}>{t('blueprint.count', { n: model.records.length })}</BarText>
          </span>
          <span style={{ flex: '1 1 0', minWidth: SPACE[8] }} />
          {touch ? (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap, flex: 'none', height: size }}>
              <span {...under.attrs} style={{ display: 'flex', alignItems: 'center', gap, ...under.style }}>
                <PickButton model={model} size={size} piece={piece} />
                <NewFolderButton model={model} size={size} piece={piece('new-folder')} />
                <ExportButton model={model} size={size} piece={piece('export', undefined, SEARCH_RIDE)} />
              </span>
              <span aria-hidden style={{ width: size, flex: 'none' }} />
              {/* The round button is the search piece the head's neighbours ride, as the field is with a mouse. */}
              <ShelfSearchPill size={size} open={searchShown} onOpenChange={setSearchOpen} query={model.query} setQuery={model.setQuery}
                reduced={reduced} style={{ top: 0 }} attrs={piece('search')} />
            </div>
          ) : (
            <>
              <NewFolderButton model={model} size={size} piece={piece('new-folder')} />
              <ExportButton model={model} size={size} piece={piece('export', undefined, SEARCH_RIDE)} />
              <ShelfSearchField value={model.query} onChange={model.setQuery} ariaLabel={t('shelf.search')} placeholder={t('shelf.search_ph')}
                wrapAttrs={piece('search')} wrapStyle={{ flex: '0 1 auto', width: SEARCH.w, minWidth: SEARCH.h * 3, pointerEvents: 'auto' }} />
            </>
          )}
          <ViewSwitch model={model} height={size} piece={piece} />
          <FoldButton model={model} size={size} piece={piece} />
        </div>
        <ExplorerView model={model} columns={4} gap={WIDE.card} upright={false} piece={piece} style={{ flex: '1 1 auto' }} />
      </div>
    </div>
  );
}
