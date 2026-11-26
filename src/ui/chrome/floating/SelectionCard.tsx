/**
 * The card a map selection wears: the item's name and its actions on one row, with its details grown
 * from that row on request. Tracks the selection through the active view's projection, imperatively,
 * on viewport, object, cell, resize, chrome-scale and active-view changes (`viewMode` flips before the
 * replacement projection registers).
 *
 * The row is placed where the opened card also fits, and then holds still through the selection's
 * own edits (a rotation, a new facing, opening the details): only a camera change, a member moving,
 * a membership change or a new size re-reads its place. A group rotation removes every member before
 * placing any back, so the card keeps its place for the whole operation. While the camera moves the
 * card follows and keeps its side of the selection.
 *
 * A Help figure pictures the same card over its own world (`SelectionCardSource`): it stands in the
 * figure's box, takes no input, and its actions do nothing.
 */
import { AnimatePresence, PresenceContext, motion } from 'framer-motion';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from 'react';
import { onTextVerdicts, textVerdictsVersion } from '../../../state/text-verdicts';
import { getCell } from '../../../core/model/grid-model';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { ROTATIONS, TerrainType, type GridState, type Rotation } from '../../../core/model/types';
import { ELEVATION_COLORS, WATER_COLOR } from '../../../core/model/palette';
import type { PlacedGroup } from '../../../core/model/placed-group';
import { groupSummary, objectSummary, placedTerrainCounts, selectedObjectIds, type BlockRef } from '../../../state/selection';
import { getActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { formatLoad } from '../../../i18n/load';
import { localizedName, useLocale, useT } from '../../../i18n/context';
import { iconUrl } from '../../../assets/icon-urls';
import { pressCommand } from '../../../editor/commands/run';
import { selectedGroup } from '../../../state/placed-groups';
import { selectedGroupName } from '../../../editor/editing/blueprint';
import { flipSelection, rotateSelection } from '../../../editor/editing/group-edit';
import { pressSelectionDelete, selectionTarget, type SelectionTarget as Target } from '../../../editor/editing/object-menu';
import { useGlidingChromeLift } from '../../primitives/chrome-layer';
import { useInteractionProfiles, useTouchMode } from '../../design/input-mode';
import { useSurfaceZoom } from '../../design/scale';
import { cursors, font, radii, z } from '../../design/styles';
import { INK, INSET, LINE, PLATE, PLATE_INK, ERROR } from '../../design/tokens';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { skin } from '../../design/window-skin';
import { roleFont } from '../../design/text-weight';
import { amplitude, framerMotion } from '../../design/motion';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { ActionButton } from '../../primitives/ActionButton';
import { Disclosure } from '../../primitives/Disclosure';
import { ChevronIcon, DuplicateIcon, FlipIcon, PickIcon, RegionIcon, RotateIcon, SaveBlueprintIcon, TrashIcon } from '../../primitives/line-glyphs';
import { copySelection } from '../../../editor/editing/clipboard';
import { MODE_ICONS } from '../../design/mode-icons';
import { layerName } from '../../../i18n/terms/layer-name';
import { helpTargetAttr } from '../../session/help-targets';
import { facingAngle, TITLE_MAX, TITLE_MIN, useSelectionCardPlace, type CardPlaceSource } from './use-selection-card-place';
import { useScrollFade } from '../../primitives/scroll-fade';
import { DirectionArrow } from './map-direction';
import type { Area, ViewportSize } from './selection-card-layout';
import { useNameReveal } from '../../primitives/use-name-reveal';
import { useMapRevision } from '../../session/use-map-revision';
import { tourTargetAttr } from '../tour/steps';
import { registerCardAnchor } from './selection-card-anchor';

/** Header row height in css px; its ends are half-circles. */
const ROW = 48;
/** The name on one line, cut with an ellipsis (its full text then rides a hover title). */
const NAME: CSSProperties = { whiteSpace: 'nowrap', textOverflow: 'ellipsis' };
/** In touch mode, where nothing is read by hovering, a long name wraps onto a second line inside the
 *  button's height before it is cut. */
const TOUCH_NAME: CSSProperties = {
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, lineHeight: 1.15, overflowWrap: 'break-word', textAlign: 'left',
};
const BUTTON = 40;
const THUMB = 36;
/** A line glyph's size on the thumb's plate. */
const THUMB_GLYPH = 24;
/** Side of the rotated square whose outer half is the pointer, in css px. */
const TAIL = 14;
type Facing = `${Rotation}`;
const FACINGS: readonly Facing[] = ROTATIONS.map((r) => `${r}` as const);

const noop = () => {};

const btnReset: CSSProperties = { border: 'none', padding: 0, margin: 0, background: 'transparent', fontFamily: font.family, cursor: cursors.clickable, WebkitTapHighlightColor: 'transparent' };

const iconButton: CSSProperties = {
  ...btnReset, position: 'relative', width: BUTTON, height: BUTTON, flex: 'none', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK,
};

/** One of the header's glyph tools: its name hangs from it on hover, toward the card's body. */
function CardTool({ name, side, onPress, danger = false, attrs, toolRef, children }: {
  name: string; side: 'above' | 'below'; onPress: () => void; danger?: boolean; attrs?: Record<string, string>;
  toolRef?: Ref<HTMLButtonElement>; children: ReactNode;
}) {
  const reveal = useNameReveal(name, side);
  return (
    <ActionButton ref={toolRef} interaction="tile" {...attrs} {...reveal.bind} aria-label={name} onClick={onPress}
      style={{ ...iconButton, ...(danger ? { color: ERROR } : null) }}>
      {children}
      {reveal.bubble}
    </ActionButton>
  );
}

/** The round picture a selection is named by: its item's icon or colour, a count for a group. */
export function Thumb({ src, color, count, glyph }: { src?: string; color?: string; count?: number; glyph?: ReactNode }) {
  return (
    <span data-testid="selection-thumb" style={{ position: 'relative', width: THUMB, height: THUMB, flex: 'none', borderRadius: '50%', background: INSET, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {glyph ?? (src ? <img src={src} alt="" draggable={false} style={{ width: '80%', height: '80%', objectFit: 'contain', pointerEvents: 'none' }} />
        : color ? <span style={{ width: '56%', height: '56%', borderRadius: radii.sm, background: color }} /> : null)}
      {count !== undefined && (
        <span style={{ position: 'absolute', right: -3, bottom: -3, minWidth: 18, height: 18, padding: '0 4px', borderRadius: radii.pill, background: INK, color: PLATE, ...roleFont('small'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>
      )}
    </span>
  );
}

/** A row of the details' list: a kind of object, or a placed blueprint's terrain of one kind. */
const KIND_ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px 0 4px', borderRadius: radii.md, background: INSET, color: PLATE_INK, ...roleFont('label'),
};
const ROW_NAME: CSSProperties = { flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: INSET, borderRadius: radii.md, padding: '8px 12px', minWidth: 0 }}>
      <div style={{ ...roleFont('head'), color: PLATE_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ ...roleFont('note'), color: skin.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  );
}

/** A map the card stands on other than the live one: a Help figure's world and view. The card stands
 *  absolute in the box `frame` measures, inert, at the live card's size or the share of it `share`
 *  asks. */
export interface SelectionCardSource {
  /** The selection, its map and touch multi-select's latch, read live when the card places itself;
   *  `groups` where the figure stands in Blueprint mode, which selects a placed blueprint whole, and
   *  `details` where it holds the card's details open or closed. */
  read: () => { selection: readonly BlockRef[]; gridState: GridState | null; latched: boolean; groups?: boolean; details?: boolean };
  /** The view whose projection places the card, answering in the box's px. */
  view: () => Pick<ActiveView, 'projection'> | null;
  /** The box's size and the part of it the map stands clear in, in the box's px. */
  frame: () => { viewport: ViewportSize; area: Area };
  /** Calls `tell` whenever the card may have to be placed again; returns the unsubscribe. */
  watch: (tell: (cause?: string) => void) => () => void;
  /** Bumps when the selection or the map under it changed, so the card says it again. */
  revision: string | number;
  /** The share of the live size the card draws at whose header, its name cut shortest, is
   *  `least` px wide at the live size: a figure narrower than the live card shrinks it to fit. */
  share: (least: number) => number;
}

/** The placed blueprint a pictured selection is, whole, where its figure stands in Blueprint mode. */
function picturedGroup(read: ReturnType<SelectionCardSource['read']> | undefined): PlacedGroup | null {
  if (!read?.groups || !read.gridState) return null;
  return selectedGroup({ gridState: read.gridState, selection: read.selection, editMode: { mode: 'blueprint' } });
}

export function SelectionCard({ source }: { source?: SelectionCardSource } = {}) {
  const t = useT();
  const liveSelection = useEditorStore((s) => s.selection);
  const liveGrid = useEditorStore((s) => s.gridState);
  const locale = useLocale();
  useMapRevision(!source && liveSelection.length > 0, 'frame');
  const livePlanet = useEditorStore((s) => s.planetSession);
  const liveGroup = useEditorStore(selectedGroup);
  const liveRepairing = useEditorStore((s) => s.repairSession?.phase === 'hand');
  // Multi-select carries its actions on its own bar (`shell/bars/selection/MultiSelectBar.tsx`).
  const liveLatched = useEditorStore((s) => s.multiSelectLatched);
  const pictured = source?.read();
  const selection = pictured ? pictured.selection : liveSelection;
  const gridState = pictured ? pictured.gridState : liveGrid;
  const latched = pictured ? pictured.latched : liveLatched;
  // A figure's world stands in no planet session.
  const target = latched ? null
    : pictured ? selectionTarget(selection, gridState, false, { planet: null, repairing: false, group: picturedGroup(pictured) })
      : selectionTarget(selection, gridState, !!livePlanet, { planet: livePlanet, repairing: liveRepairing, group: liveGroup });

  return (
    <AnimatePresence>
      {target && gridState && (
        <CardBody key={target.key} target={target} selection={selection} gs={gridState} t={t} locale={locale} source={source} />
      )}
    </AnimatePresence>
  );
}

/** The placement source for a pictured card: `source`'s world, read through its latest props. */
function usePicturedPlace(source: SelectionCardSource | undefined): CardPlaceSource | undefined {
  const latest = useRef(source);
  latest.current = source;
  const { watch } = source ?? {};
  return useMemo<CardPlaceSource | undefined>(() => (watch ? {
    read: () => latest.current!.read(),
    projection: () => latest.current!.view()?.projection,
    frame: () => {
      const { viewport, area } = latest.current!.frame();
      return { viewport, areaAt: () => area };
    },
    watch,
    wheel: false,
  } : undefined), [watch]);
}

function CardBody({ target, selection, gs, t, locale, source }: {
  target: Target;
  /** The selection the card stands for; a card leaving keeps the one it last had. */
  selection: readonly BlockRef[];
  gs: GridState;
  t: ReturnType<typeof useT>;
  locale: ReturnType<typeof useEditorStore.getState>['locale'];
  source?: SelectionCardSource;
}) {
  const pictured = !!source;
  const lift = useGlidingChromeLift(BUTTON);
  // A pictured card stands under the Help window's zoom, so it divides that back out to draw the
  // size the live card draws, shrunk as far as its figure asks.
  const surface = useSurfaceZoom();
  const [share, setShare] = useState(1);
  const live = pictured ? lift.zoom / surface : lift.zoom;
  const zoom = live * share;
  const { weights } = lift;
  const place = usePicturedPlace(source);
  const { refs, growUp, nameCut } = useSelectionCardPlace(zoom, locale, { row: ROW, tail: TAIL }, selection, place);
  // Details that scroll fade at an edge with more beyond it, as every scrolling list does.
  const detailsFade = useScrollFade(refs.scroll, 'y');
  const fit = source?.share;
  useLayoutEffect(() => {
    const header = refs.header.current;
    const title = header?.querySelector<HTMLElement>('[data-card-title]');
    if (!fit || !header || !title) return;
    // Css px inside the card, which its zoom leaves as they are.
    setShare(fit((header.offsetWidth - title.offsetWidth + TITLE_MIN) * live));
  }, [fit, live, refs]);
  const profiles = useInteractionProfiles();
  const touch = useTouchMode();
  // A placed blueprint selected as a group goes by its blueprint's name, its terrain and objects together.
  useSyncExternalStore(onTextVerdicts, textVerdictsVersion);
  const livePlacementName = useEditorStore((s) => (pictured ? null : selectedGroupName(s)));
  const livePlaced = useEditorStore((s) => (pictured ? null : selectedGroup(s)));
  const shown = source?.read();
  // A figure's placement goes by the name its scene laid it under, which is the app's own copy.
  const placed = pictured ? picturedGroup(shown) : livePlaced;
  const placementName = pictured ? placed?.name ?? null : livePlacementName;
  const [openNow, setOpen] = useState(false);
  const open = shown?.details ?? openNow;
  // The glyph buttons' names hang toward the card's body, away from the selection.
  const nameSide = growUp ? 'above' : 'below';
  // The live card is where the delete question grows from (`DeletePopover.tsx`).
  const plateRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(
    () => (pictured ? undefined : registerCardAnchor({ box: refs.box, plate: plateRef, control: deleteRef, growUp })),
    [pictured, refs.box, growUp],
  );

  const acts = <A extends unknown[]>(act: (...args: A) => void): ((...args: A) => void) => (pictured ? noop : act);
  // Rotate, Flip, Copy and Delete run the card's own verbs: each one's key command has another body
  // (the armed ghost's turn and flip, selected text's copy, whatever stands in front for Delete).
  const rotate = acts(() => rotateSelection(90));
  const flip = acts(flipSelection);
  const copy = acts(() => { copySelection(); });
  const remove = acts(pressSelectionDelete);
  const face = acts((angle: Facing) => pressCommand('selection.face', { angle }));
  const pick = acts(() => pressCommand('selection.pick'));
  const saveBlueprint = acts(() => pressCommand('selection.save_blueprint'));
  const narrow = acts((catalogId: string) => pressCommand('selection.narrow', { item: catalogId }));

  // What the card says about its selection.
  let title = '';
  let thumb: ReactNode = null;
  const facts: [string, string][] = [];
  let kinds: { catalogId: string; name: string; icon?: string; n: number }[] = [];
  /** A placed blueprint's terrain by kind, each with its swatch, only where it laid some. */
  const terrains: { id: 'mountain' | 'water'; label: string; color: string }[] = [];
  if (target.plural) {
    const group = groupSummary(gs, selectedObjectIds(source ? source.read().selection : useEditorStore.getState().selection));
    kinds = group.kinds.map(({ catalogId, n }) => {
      const item = getCatalogItem(catalogId);
      return { catalogId, n, name: item ? localizedName(item.name, locale) : catalogId, icon: item?.icon ? iconUrl(item.icon) : undefined };
    });
    if (placed) {
      // A placed blueprint is one thing, named by the map: its frame, its load and the layer it stands
      // on, then what it holds, its objects by kind and its terrain cells by kind.
      title = placementName ?? '';
      thumb = <Thumb glyph={<RegionIcon size={THUMB_GLYPH} />} />;
      const { mountain, water } = placedTerrainCounts(gs, placed);
      const cellsOf = (key: 'mode.mountain' | 'mode.water', n: number) => t('selection.terrain_cells', { terrain: t(key), cells: t('units.cells', { n }) });
      if (mountain > 0) terrains.push({ id: 'mountain', label: cellsOf('mode.mountain', mountain), color: ELEVATION_COLORS[1]! });
      if (water > 0) terrains.push({ id: 'water', label: cellsOf('mode.water', water), color: WATER_COLOR });
      facts.push([t('selection.size'), `${placed.frame.w}×${placed.frame.h}`]);
      facts.push([t('selection.load'), formatLoad(locale, group.load, group.loadUnknown)]);
      facts.push([t('selection.layer'), layerName(t, placed.base)]);
    } else {
      title = t('units.objects', { n: group.count });
      thumb = <Thumb src={kinds[0]?.icon} count={group.count} />;
      facts.push([t('selection.kinds'), String(kinds.length)]);
      facts.push([t('selection.load'), formatLoad(locale, group.load, group.loadUnknown)]);
      facts.push([t('selection.count'), String(group.count)]);
    }
  } else if (target.object) {
    const obj = target.object;
    const item = getCatalogItem(obj.catalogId);
    const one = objectSummary(gs, obj);
    title = item ? localizedName(item.name, locale) : obj.catalogId;
    thumb = <Thumb src={item?.icon ? iconUrl(item.icon) : undefined} color={item?.color} />;
    facts.push([t('selection.size'), `${one.size.w}×${one.size.h}`]);
    facts.push([t('selection.load'), formatLoad(locale, one.load, one.loadUnknown)]);
    facts.push([t('selection.placed'), one.maxCount ? `${one.placed}/${one.maxCount}` : String(one.placed)]);
    facts.push([t('selection.layer'), layerName(t, obj.elevation)]);
  } else if (target.block?.kind === 'terrain') {
    const terrain = getCell(gs.cells, target.block.x, target.block.y)?.terrain;
    const mountain = terrain?.type === TerrainType.Mountain;
    title = t(mountain ? 'mode.mountain' : 'mode.water');
    thumb = <Thumb src={MODE_ICONS[mountain ? 'mountain' : 'water'].rest} />;
    if (terrain) facts.push([t('selection.layer'), layerName(t, mountain ? surfaceElevation(terrain) : terrain.elevation)]);
  }
  const facing = target.object && target.faceable ? String(target.object.rotation) as Facing : null;
  const proj = source ? source.view()?.projection : getActiveView()?.projection;

  const arrive = 1 - amplitude('selection.card.arrive');
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={framerMotion('selection.fade')}
    >
      <div
        ref={refs.box}
        {...(pictured ? { inert: '' } : helpTargetAttr('select'))}
        data-testid="selection-card"
        style={{
          position: pictured ? 'absolute' : 'fixed', zIndex: pictured ? undefined : z.canvasControls, zoom, ...weights,
          visibility: 'hidden', pointerEvents: 'none',
        }}
      >
        <motion.div
          ref={plateRef}
          initial={{ scale: arrive, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: arrive, opacity: 0, transition: framerMotion('surface.leave') }}
          transition={framerMotion('selection.card.arrive')}
          style={{
            display: 'flex', flexDirection: growUp ? 'column-reverse' : 'column', width: 'max-content',
            position: 'relative', color: INK, fontFamily: font.family, pointerEvents: pictured ? 'none' : 'auto',
          }}
        >
          {/* The plate and its pointer are one silhouette under the map's hairline, so the outline
              runs on around the pointer without a seam wherever the pointer stands. */}
          <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
            <span style={{ position: 'absolute', inset: 0, background: PLATE, borderRadius: (ROW / 2) * (isWebKitEngine() ? 2 : 1) }} />
            <span ref={refs.tail} style={{ position: 'absolute', background: PLATE, borderRadius: radii.sm * (isWebKitEngine() ? 2 : 1), transform: 'rotate(45deg)' }} />
          </ShapeEdge>
          <div ref={refs.header} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: ROW, padding: '0 6px 0 6px', gap: 4, width: 'max-content' }}>
            {thumb}
            <motion.button
              type="button"
              data-testid="selection-details"
              {...profiles.pill}
              aria-expanded={open}
              aria-label={t('selection.details_for', { name: title })}
              onClick={() => setOpen((v) => !v)}
              style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: 4, height: BUTTON, padding: '0 8px 0 6px', borderRadius: radii.pill, color: PLATE_INK }}
            >
              <span data-card-title style={{ ...roleFont('head'), maxWidth: `var(--title-max, ${TITLE_MAX}px)`, overflow: 'hidden', ...(touch ? TOUCH_NAME : NAME) }}>{title}</span>
              <motion.span aria-hidden animate={{ rotate: open !== growUp ? 180 : 0 }} transition={framerMotion('surface.arrive')} style={{ display: 'flex', color: skin.muted, flex: 'none' }}>
                <ChevronIcon size={13} />
              </motion.span>
            </motion.button>
            <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '12px 4px', background: LINE, flex: 'none' }} />
            {target.rotatable && (
              <CardTool name={t('a11y.rotate')} side={nameSide} onPress={rotate} attrs={{ 'data-testid': 'handle-rotate', ...tourTargetAttr('selection-rotate') }}>
                <RotateIcon />
              </CardTool>
            )}
            {target.flippable && (
              <CardTool name={t('shortcut.flip')} side={nameSide} onPress={flip} attrs={{ 'data-testid': 'handle-flip' }}>
                <FlipIcon />
              </CardTool>
            )}
            {target.pickable && (
              <CardTool name={t('a11y.pick_material')} side={nameSide} onPress={pick} attrs={{ 'data-testid': 'handle-pick' }}>
                <PickIcon />
              </CardTool>
            )}
            {target.copyable && (
              <CardTool name={t('context.copy')} side={nameSide} onPress={copy} attrs={{ 'data-testid': 'handle-copy' }}>
                <DuplicateIcon />
              </CardTool>
            )}
            {target.blueprintable && (
              <CardTool name={t('blueprint.save_as')} side={nameSide} onPress={saveBlueprint}
                attrs={{ 'data-testid': 'handle-save-blueprint', ...(pictured ? {} : helpTargetAttr('blueprint-save', 'bpsave-selection')) }}>
                <SaveBlueprintIcon />
              </CardTool>
            )}
            {target.deletable && (
              <CardTool name={t('a11y.delete')} side={nameSide} onPress={remove} danger toolRef={deleteRef} attrs={{ 'data-testid': 'handle-delete' }}>
                <TrashIcon />
              </CardTool>
            )}
          </div>
          {/* The body keeps its natural height laid out while closed, so the row is placed where the
              opened card will fit. It takes the header's width rather than widening the card. */}
          {/* The plate's far corners are the details' own, so what scrolls stays inside its rounding. */}
          <div ref={refs.scroll} data-testid="selection-details-scroll" style={{
            position: 'relative', width: 0, minWidth: '100%', maxHeight: 'var(--details-max)', overflowY: 'auto', overscrollBehavior: 'contain',
            ...(growUp
              ? { borderTopLeftRadius: ROW / 2, borderTopRightRadius: ROW / 2 }
              : { borderBottomLeftRadius: ROW / 2, borderBottomRightRadius: ROW / 2 }),
            ...detailsFade,
          }}>
            {/* The details stand as they are while the card leaves: the card's own exit carries them. */}
            <PresenceContext.Provider value={null}>
            <Disclosure open={open} bodyRef={refs.body}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: growUp ? '12px 12px 4px' : '4px 12px 12px' }}>
                <div aria-hidden style={{ height: 1, background: LINE, margin: '0 4px', order: growUp ? 9 : 0 }} />
                {/* Touch has no hover title, so a name the header cuts short reads in full here. */}
                {touch && nameCut && (
                  <div data-testid="selection-full-name" style={{ ...roleFont('head'), color: PLATE_INK, padding: '0 4px', overflowWrap: 'break-word' }}>{title}</div>
                )}
                {facts.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${facts.length > 1 ? 2 : 1}, minmax(0, 1fr))`, gap: 8 }}>
                    {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
                  </div>
                )}
                {(kinds.length > 1 || (placed && kinds.length + terrains.length > 0)) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(placed ? kinds : kinds.slice(0, 5)).map((k) => (
                      <motion.button key={k.catalogId} type="button" data-testid="selection-kind" {...profiles.row} onClick={() => narrow(k.catalogId)}
                        aria-label={t('selection.only_kind', { name: k.name })}
                        style={{ ...btnReset, ...KIND_ROW }}>
                        <Thumb src={k.icon} />
                        <span style={ROW_NAME}>{k.name}</span>
                        <span style={{ color: skin.muted }}>×{k.n}</span>
                      </motion.button>
                    ))}
                    {terrains.map((k) => (
                      <div key={k.id} data-testid="selection-terrain" style={KIND_ROW}>
                        <Thumb color={k.color} />
                        <span style={ROW_NAME}>{k.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {facing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ ...roleFont('head'), color: skin.muted, marginRight: 'auto' }}>{t('selection.facing')}</span>
                    <SegmentedControl<Facing>
                      value={facing}
                      options={FACINGS}
                      onChange={face}
                      idPrefix="selection-facing"
                      stretch={false}
                      render={(o) => <DirectionArrow facing={o} deg={facingAngle(Number(o) as Rotation, target.object, proj)} />}
                      label={(o) => t('selection.facing_value', { angle: t(`context.rotate_${o}`) })}
                    />
                  </div>
                )}
              </div>
            </Disclosure>
            </PresenceContext.Provider>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
