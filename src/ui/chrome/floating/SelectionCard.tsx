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
 */
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { getCell } from '../../../core/model/grid-model';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { TerrainType, type GridState, type Rotation } from '../../../core/model/types';
import { groupSummary, narrowToCatalog, objectSummary, selectedObjectIds } from '../../../state/selection';
import { getActiveView } from '../../../view/active-view';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { formatLoad } from '../../../i18n/load';
import { localizedName, useLocale, useT } from '../../../i18n/context';
import { iconUrl } from '../../../assets/icon-urls';
import { pickSelection } from '../../../editor/editing/pick-selection';
import {
  deleteSelection, faceSelected, rotateSelection, selectionTarget, type SelectionTarget as Target,
} from '../../../editor/editing/group-edit';
import { touchFloorZoom, useChromeScale, useDenseScript, useDevicePixelRatio, useTouchPrimary } from '../../design/scale';
import { cursors, font, interactionProfiles, radii, z } from '../../design/styles';
import { INK, INSET, LINE, PLATE, PLATE_INK, ERROR } from '../../design/tokens';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { skin } from '../../design/window-skin';
import { roleFont, weightVars } from '../../design/text-weight';
import { amplitude, framerMotion } from '../../design/motion';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { Glyph, TrashIcon, ChevronIcon } from '../../primitives/line-glyphs';
import { MODE_ICONS } from '../../design/mode-icons';
import { layerName } from '../../session/layer-name';
import { helpTargetAttr } from '../../session/help-targets';
import { facingAngle, useSelectionCardPlace } from './use-selection-card-place';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useMapRevision } from '../../session/use-map-revision';

/** Header row height in css px; its ends are half-circles. */
const ROW = 48;
const BUTTON = 40;
const THUMB = 36;
/** Side of the rotated square whose outer half is the pointer, in css px. */
const TAIL = 14;
const FACINGS = ['0', '90', '180', '270'] as const;
type Facing = typeof FACINGS[number];

const btnReset: CSSProperties = { border: 'none', padding: 0, margin: 0, background: 'transparent', fontFamily: font.family, cursor: cursors.clickable, WebkitTapHighlightColor: 'transparent' };

const iconButton: CSSProperties = {
  ...btnReset, width: BUTTON, height: BUTTON, flex: 'none', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK,
};

/** A block with a quarter-turn arrow over it: this item turns 90 degrees clockwise. */
const RotateIcon = () => (
  <Glyph>
    <rect x="3.5" y="11" width="9" height="9" rx="2" />
    <path d="M7.5 6.6A9.5 9.5 0 0 1 19.4 15" />
    <path d="M16.4 13.2l3 2.3 2.2-3" />
  </Glyph>
);
const PickIcon = () => <Glyph><path d="m14 6 2.5-2.5a3 3 0 0 1 4 4L18 10" /><path d="m12 5 7 7M14 7l-9 9-1 4 4-1 9-9" /></Glyph>;
/** An arrow pointing where the item's front looks on screen for one facing (`data-facing`); the card
 *  turns it with the camera. */
const FacingArrow = ({ facing, deg }: { facing: string; deg: number }) => (
  <svg data-facing={facing} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', transform: `rotate(${deg}deg)` }}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

function Thumb({ src, color, count }: { src?: string; color?: string; count?: number }) {
  return (
    <span style={{ position: 'relative', width: THUMB, height: THUMB, flex: 'none', borderRadius: '50%', background: INSET, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? <img src={src} alt="" draggable={false} style={{ width: '80%', height: '80%', objectFit: 'contain', pointerEvents: 'none' }} />
        : color ? <span style={{ width: '56%', height: '56%', borderRadius: radii.sm, background: color }} /> : null}
      {count !== undefined && (
        <span style={{ position: 'absolute', right: -3, bottom: -3, minWidth: 18, height: 18, padding: '0 4px', borderRadius: radii.pill, background: INK, color: PLATE, ...roleFont('small'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>
      )}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: INSET, borderRadius: radii.md, padding: '8px 12px', minWidth: 0 }}>
      <div style={{ ...roleFont('head'), color: PLATE_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ ...roleFont('note'), color: skin.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  );
}

export function SelectionCard() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const gridState = useEditorStore((s) => s.gridState);
  const locale = useLocale();
  useMapRevision(selection.length > 0, 'frame');
  const inSession = useEditorStore((s) => !!s.planetSession);
  const target = selectionTarget(selection, gridState, inSession);
  const chrome = useChromeScale();
  const touch = useTouchPrimary();
  const zoom = touchFloorZoom(chrome, touch, BUTTON);
  // Weights resolve for the size the card is drawn at, which the touch floor can raise above the chrome's.
  const weights = weightVars(zoom, useDevicePixelRatio(), useDenseScript());

  return (
    <AnimatePresence>
      {target && gridState && (
        <CardBody key={target.key} target={target} gs={gridState} zoom={zoom} weights={weights} t={t} locale={locale} />
      )}
    </AnimatePresence>
  );
}

function CardBody({ target, gs, zoom, weights, t, locale }: {
  target: Target;
  gs: GridState;
  zoom: number;
  weights: CSSProperties;
  t: ReturnType<typeof useT>;
  locale: ReturnType<typeof useEditorStore.getState>['locale'];
}) {
  const { refs, growUp } = useSelectionCardPlace(zoom, locale, ROW, TAIL);
  const [open, setOpen] = useState(false);
  // The unfold animates to the body's layout height. A height of 'auto' is measured on screen, so under
  // a chrome zoom below 1 it stops short and then snaps to the real height.
  const [bodyHeight, setBodyHeight] = useState(0);
  const reduced = useReducedMotionConfig() === true;
  useObservedSize(() => refs.body.current, ([body]) => setBodyHeight(body!.offsetHeight), []);

  const exec = () => useEditorStore.getState();
  const rotate = () => rotateSelection(90);
  const face = (angle: Facing) => faceSelected(Number(angle) as Rotation);
  const remove = () => {
    const s = exec();
    if (target.plural) {
      // A group has no confirm step, matching the delete shortcut; one undo restores it.
      const ids = selectedObjectIds(s.selection);
      if (ids.length > 1) deleteSelection(t, ids);
      return;
    }
    // The confirmation the Delete shortcut opens, unrolled from this button.
    if (target.block) s.setDeletePopover(s.deletePopover ? null : target.block);
  };
  const narrow = (catalogId: string) => {
    const s = exec();
    const refs = s.gridState ? narrowToCatalog(s.selection, s.gridState, catalogId) : [];
    if (refs.length) s.setSelection(refs);
  };

  // What the card says about its selection.
  let title = '';
  let thumb: ReactNode = null;
  const facts: [string, string][] = [];
  let kinds: { catalogId: string; name: string; icon?: string; n: number }[] = [];
  if (target.plural) {
    const group = groupSummary(gs, selectedObjectIds(useEditorStore.getState().selection));
    kinds = group.kinds.map(({ catalogId, n }) => {
      const item = getCatalogItem(catalogId);
      return { catalogId, n, name: item ? localizedName(item.name, locale) : catalogId, icon: item?.icon ? iconUrl(item.icon) : undefined };
    });
    title = t('units.objects', { n: group.count });
    thumb = <Thumb src={kinds[0]?.icon} count={group.count} />;
    facts.push([t('selection.kinds'), String(kinds.length)]);
    facts.push([t('selection.load'), formatLoad(locale, group.load, group.loadUnknown)]);
    facts.push([t('selection.count'), String(group.count)]);
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
  const facing = target.object && target.rotatable && !target.sessionLandmark ? String(target.object.rotation) as Facing : null;
  const proj = getActiveView()?.projection;

  const arrive = 1 - amplitude('selection.card.arrive');
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={framerMotion('selection.fade')}
    >
      <div
        ref={refs.box}
        {...helpTargetAttr('select')}
        data-testid="selection-card"
        style={{
          position: 'fixed', zIndex: z.canvasControls, zoom, ...weights,
          visibility: 'hidden', pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ scale: arrive, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: arrive, opacity: 0, transition: framerMotion('surface.leave') }}
          transition={framerMotion('selection.card.arrive')}
          style={{
            display: 'flex', flexDirection: growUp ? 'column-reverse' : 'column', width: 'max-content',
            position: 'relative', color: INK, fontFamily: font.family, pointerEvents: 'auto',
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
              {...interactionProfiles.pill}
              aria-expanded={open}
              aria-label={t('selection.details_for', { name: title })}
              onClick={() => setOpen((v) => !v)}
              style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: 4, height: BUTTON, padding: '0 8px 0 6px', borderRadius: radii.pill, color: PLATE_INK }}
            >
              <span style={{ ...roleFont('head'), maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
              <motion.span aria-hidden animate={{ rotate: open !== growUp ? 180 : 0 }} transition={framerMotion('surface.arrive')} style={{ display: 'flex', color: skin.muted, flex: 'none' }}>
                <ChevronIcon size={13} />
              </motion.span>
            </motion.button>
            <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '12px 4px', background: LINE, flex: 'none' }} />
            {target.rotatable && (
              <motion.button type="button" data-testid="handle-rotate" {...interactionProfiles.tile} style={iconButton} onClick={rotate} aria-label={t('a11y.rotate')} title={t('a11y.rotate')}>
                <RotateIcon />
              </motion.button>
            )}
            {target.pickable && (
              <motion.button type="button" data-testid="handle-pick" {...interactionProfiles.tile} style={iconButton} onClick={pickSelection} aria-label={t('a11y.pick_material')} title={t('a11y.pick_material')}>
                <PickIcon />
              </motion.button>
            )}
            {target.deletable && (
              <motion.button type="button" data-testid="handle-delete" data-selection-delete {...interactionProfiles.tile} style={{ ...iconButton, color: ERROR }} onClick={remove} aria-label={t('a11y.delete')} title={t('a11y.delete')}>
                <TrashIcon />
              </motion.button>
            )}
          </div>
          {/* The body keeps its natural height laid out while closed, so the row is placed where the
              opened card will fit. It takes the header's width rather than widening the card. */}
          <div ref={refs.scroll} style={{ position: 'relative', width: 0, minWidth: '100%', maxHeight: 'var(--details-max)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
            <motion.div
              initial={false}
              animate={{ height: open ? bodyHeight : 0, opacity: open ? 1 : 0 }}
              transition={framerMotion('panel.detail.unfold', reduced)}
              aria-hidden={!open || undefined}
              {...(open ? {} : { inert: '' })}
              style={{ overflow: 'hidden', pointerEvents: open ? undefined : 'none' }}
            >
              <div ref={refs.body} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: growUp ? '12px 12px 4px' : '4px 12px 12px' }}>
                <div aria-hidden style={{ height: 1, background: LINE, margin: '0 4px', order: growUp ? 9 : 0 }} />
                {facts.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${facts.length > 1 ? 2 : 1}, minmax(0, 1fr))`, gap: 8 }}>
                    {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
                  </div>
                )}
                {kinds.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {kinds.slice(0, 5).map((k) => (
                      <motion.button key={k.catalogId} type="button" {...interactionProfiles.row} onClick={() => narrow(k.catalogId)}
                        aria-label={t('selection.only_kind', { name: k.name })}
                        style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px 0 4px', borderRadius: radii.md, background: INSET, color: PLATE_INK, ...roleFont('label') }}>
                        <Thumb src={k.icon} />
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</span>
                        <span style={{ color: skin.muted }}>×{k.n}</span>
                      </motion.button>
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
                      render={(o) => <FacingArrow facing={o} deg={facingAngle(o, target.object, proj)} />}
                      label={(o) => t('selection.facing_value', { angle: t(`context.rotate_${o}`) })}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
