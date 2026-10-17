import { lazy, Suspense, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { ActionButton } from '../../../primitives/ActionButton';
import { useVersioned } from '../../../primitives/use-versioned';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { chipTextSize, type NoteTag, type ZoneTextSize } from '../../../../core/model/annotations';
import { CHIP_TEXT_SIZES, ZONE_TEXT_SIZES } from '../../../../tools/pointer/annotate/facts';
import { ANNOTATION_COLORS } from '../../../../config/annotation-palette';
import { SELECTABLE_ANNOTATION_TAGS } from '../../../../config/annotation-tags';
import { type AnnotationTool } from '../../../../state/editing/vocabulary';
import { approvedTexts, onTextVerdicts, textVerdictsVersion } from '../../../../state/text-verdicts';
import { RenderBoundary } from '../../../primitives/RenderBoundary';
import { ChunkNotice } from '../../../chrome/guards/FailureNotice';
import { useSurfaceScope } from '../../../primitives/surface-scope';
import { amplitude, presence, cssMotion } from '../../../design/motion';
import { helpTargetAttr } from '../../../session/help-targets';
import { SWATCH_ROW_BOTTOM, SWATCH_ROW_GAP } from '../ToolRow';
import { useRailClearance } from '../../frame-layout';
import { useTransition } from '../../../design/motion/use-motion';
import { MOTIONS } from '../../../design/motion/registry';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { discardDraft } from '../../../../editor/editing/annotation-edit';
import { btnReset, cursors, interactionProfiles, radii, UNAVAILABLE } from '../../../design/styles';
import { ACTIVE, DANGER_INK, DARK_PLATE, INK, ON_DARK, PLATE, PLATE_INK, plateShapeEdge } from '../../../design/tokens';
import type { Glyph } from '../../frame';
import { QUAD, SCALE, TEXT } from '../../units';
import { BarText, Action } from '../bar-atoms';
import { BrushSizeControl } from '../BrushSizeControl';
import { ToolPill, toolPillCentre } from '../ToolPill';
import { ShapeOptions } from '../ShapeOptions';
import { OptionPill } from '../OptionPill';
import { ACTIVE_PLATE, ROAD_STYLE } from '../terrain-cells';
import { hoverBleed, useSwatchStripRow } from '../swatch-strip';
import { DimensionsToggle } from '../DimensionsToggle';

const NewTagCard = lazy(loadNewTagCard);
import { type ToolbarSlot, type ToolbarSpec } from '../toolbar-morph';
import { loadNewTagCard } from '../../warm/loaders';
import type { I18nKey } from '../../../../i18n/keys';
import { brushSizeOf } from '../../../../state/editing/edit-mode';

/** A cell drawing of this bar's own, emitted as SVG in the row's ink: the terrain row's drawings
 *  each carry their surface (its eraser stands on a mountain), so an annotation cell wearing one
 *  would name the wrong thing. */
const svgGlyph = (body: string, ink: Glyph['ink']): Glyph => ({
  w: 64, h: 64, ink,
  parts: [{
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`,
    ),
    x: 0, y: 0, w: 64, h: 64,
  }],
});

/** The free zone brush: a pen, since what it lays is drawn ink. */
const PEN_GLYPH = svgGlyph(
  `<g stroke="${INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  + `<path d="M14 50l3-10L40.5 16.5a5.5 5.5 0 0 1 7.8 7.8L24.5 47.5 14 50z"/>`
  + `<path d="M19.5 39l6 6"/></g>`,
  { x: 11.2, y: 13.7, w: 42, h: 39, gx: 30.5, gy: 32.5, area: 575 },
);

/** A tag chip: a plate with a short bar of lettering. */
const CHIP_GLYPH = svgGlyph(
  `<g stroke="${INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  + `<rect x="9" y="19" width="46" height="26" rx="9"/><path d="M20 32h24"/></g>`,
  { x: 6.2, y: 16.2, w: 51.5, h: 31.5, gx: 32, gy: 32, area: 700 },
);

/** A route: a curve running into a filled head, drawn solid — dashes at glyph size read as breaks. */
const ROUTE_GLYPH = svgGlyph(
  `<path d="M10 50C24 50 21 25 35 25c4.6 0 8 2.4 11 5" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`
  + `<path d="M55.5 35.5L43 35.2 49 24.8z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
  { x: 7, y: 22, w: 51.5, h: 31, gx: 30, gy: 38.5, area: 353 },
);

/** The eraser, drawn bare: the terrain row's eraser cell stands on its surface, which is exactly
 *  what this one must not claim. */
const ERASE_GLYPH = svgGlyph(
  `<g stroke="${INK}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  + `<path d="M50 53H24l-13-13a5.5 5.5 0 0 1 0-7.8L32.6 10.6a5.5 5.5 0 0 1 7.8 0l12.8 12.8a5.5 5.5 0 0 1 0 7.8L38 46"/>`
  + `<path d="M22.5 21.5 42 41"/></g>`,
  { x: 6.7, y: 7, w: 50.5, h: 49.5, gx: 31, gy: 32, area: 1100 },
);

const MEASURE_GLYPH = svgGlyph(
  `<g stroke="${INK}" stroke-width="4.5" stroke-linecap="round" fill="none">`
  + '<rect x="8" y="21" width="48" height="22" rx="4"/><path d="M17 22v9m10-9v14m10-14v9m10-9v14"/></g>',
  { x: 5.5, y: 18.5, w: 53, h: 27, gx: 32, gy: 32, area: 650 },
);

/** `slot` is the pill's toolbar identity: the brush and eraser are the terrain bar's own two, so
 *  they stay in place when the bar changes. */
const NOTE_TOOLS: { tool: Exclude<AnnotationTool, 'none'>; slot: string; labelKey: I18nKey; glyph: Glyph; commandId: string }[] = [
  { tool: 'zone', slot: 'brush', labelKey: 'terrain.brush', glyph: PEN_GLYPH, commandId: 'tool.brush' },
  { tool: 'erase', slot: 'eraser', labelKey: 'annot.erase', glyph: ERASE_GLYPH, commandId: 'tool.erase' },
  { tool: 'chip', slot: 'chip', labelKey: 'annot.chip', glyph: CHIP_GLYPH, commandId: 'tool.trim' },
  { tool: 'route', slot: 'route', labelKey: 'annot.route', glyph: ROUTE_GLYPH, commandId: 'tool.smart' },
  { tool: 'measure', slot: 'measure', labelKey: 'annot.measure', glyph: MEASURE_GLYPH, commandId: 'tool.measure' },
];

/** The colour tiles wear the road-surface strip's own dress (`RoadStyles`): the same plate, the
 *  same inner square, the same grown active plate — one picker idiom above a tool row, not two. */
const TILE = ROAD_STYLE.size * SCALE;
const INNER = (ROAD_STYLE.size - 2 * ROAD_STYLE.inset) * SCALE;
const ROUND = ROAD_STYLE.radius / ROAD_STYLE.size;
const GROW = ACTIVE_PLATE.dy * SCALE;
/** A tag pill is a line of lettering, so it stands lower than a swatch tile. */
const TAG_H = TILE * 0.6;
const TAG_GROW = GROW * 0.6;
/** The removal badge: its side, and how far it stands past the pill's top and far edges. */
const BADGE_SIDE = TAG_H * 0.5;
const BADGE_OUT = BADGE_SIDE * 0.45;
/** Half the width of the pills that end the row, the first preset and the remove pill, at most:
 *  hover growth past the row's ends scales with it. */
const END_PILL_HALF = TAG_H * 2;
/** In removal the pill stands still and the badge grows about its own centre, reaching this far
 *  past the pill's top and far edges. */
const BADGE_HOVER = interactionProfiles.badge;
const BADGE_REACH = BADGE_OUT + (BADGE_SIDE / 2) * (BADGE_HOVER.whileHover.scale - 1);
const badgeBleed = (half: number) => `max(${hoverBleed(half, BADGE_OUT)}, ${Math.ceil(BADGE_REACH) + 1}px)`;
/** Room for hover growth, the grown plate, the removal badge and the focus ring at every edge. */
const TAG_ROW_BLEED = {
  top: badgeBleed(TAG_H / 2), bottom: hoverBleed(TAG_H / 2, TAG_GROW),
  left: hoverBleed(END_PILL_HALF, TAG_GROW), right: badgeBleed(END_PILL_HALF),
};
const SWATCH_SIDE = hoverBleed(TILE / 2, GROW);
const SWATCH_ROW_BLEED = { top: SWATCH_SIDE, right: SWATCH_SIDE, bottom: SWATCH_SIDE, left: SWATCH_SIDE };
/** Room between the last cell and the draft's Done pair, in css px: the scope screen's own gap. */
const ACTION_GAP = 22;

/** The live Notes toolbar, read from the store. */
export function useNotesToolbar(): ToolbarSpec {
  const t = useT();
  const tool = useEditorStore((s) => s.annotationTool);
  const zoneShape = useEditorStore((s) => s.annotationZoneShape);
  const setTool = useEditorStore((s) => s.toggleAnnotationTool);
  const setZoneShape = useEditorStore((s) => s.setAnnotationZoneShape);
  const eraserShape = useEditorStore((s) => s.eraserShape);
  const setEraserShape = useEditorStore((s) => s.setEraserShape);
  const brushSize = useEditorStore(brushSizeOf);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const draft = useEditorStore((s) => s.annotationDraft);
  const commitDraft = useEditorStore((s) => s.commitAnnotationDraft);
  // The eraser takes the road eraser's shapes and the brush the road brush's, so both size alike.
  const shape = tool === 'erase' ? eraserShape : zoneShape;
  const sized = (tool === 'erase' || tool === 'zone') && shape !== 'rect' && shape !== 'circle';
  const routeWidth = useEditorStore((s) => s.annotationRouteWidth);
  const setRouteWidth = useEditorStore((s) => s.setAnnotationRouteWidth);
  const activeIndex = NOTE_TOOLS.findIndex(cell => cell.tool === tool);
  // A draft with something in it can be finished; a route needs two points to be a route.
  const drafted = draft?.kind === 'zone' ? draft.cells.length > 0 : draft?.kind === 'route' ? draft.points.length >= 2 : false;
  const actionsArrive = presence('draft.actions.arrive', { opacity: 0, y: MOTIONS['draft.actions.arrive'].amplitude, scale: DRAFT_ACTIONS_FROM }, { reduced: useReducedMotionConfig() });
  const colorClearance = useRailClearance(SWATCH_ROW_BOTTOM, TILE);
  const tagClearance = useRailClearance(SWATCH_ROW_BOTTOM + TILE + SWATCH_ROW_GAP, TAG_H);

  const options: ToolbarSlot[] = [
    // One picker for both: brush and eraser offer the same shapes, so it stays and its plate slides.
    ...(tool === 'zone' || tool === 'erase' ? [{ id: 'shape', node: <ShapeOptions value={shape}
      onChange={tool === 'erase' ? next => setEraserShape(next) : setZoneShape}/> }] : []),
    ...(tool === 'zone' || tool === 'chip' ? [{ id: 'font-size', node: <SizeOptions/> }] : []),
    ...(tool === 'zone' ? [{ id: 'dimensions', node: <ZoneDimensions/> }] : []),
    ...(tool === 'route' ? [{ id: 'route-style', node: <RouteOptions/> }] : []),
  ];
  const trailing: ToolbarSlot[] = [
    ...(drafted ? [{ id: 'draft-actions', ownMotion: true, node: <motion.span
      {...actionsArrive}
      style={{ display: 'flex', alignItems: 'center', gap: QUAD.gap, marginLeft: ACTION_GAP - QUAD.gap }}
    >
      <Action label={t('annot.discard')} onPress={discardDraft} />
      <Action label={t('annot.done')} primary onPress={() => { commitDraft(); }} />
    </motion.span> }] : []),
    // The route's line width rides the same slider, from its own value, so the slider stays across the switch.
    ...(sized || tool === 'route' ? [{ id: 'size', end: true, node: <BrushSizeControl value={tool === 'route' ? routeWidth : brushSize}
      onChange={tool === 'route' ? setRouteWidth : setBrushSize}/> }] : []),
  ];
  return {
    frameAttrs: helpTargetAttr('notes'),
    rows: [
      { id: 'notes-tags', node: <div style={{ marginRight: tagClearance, transition: cssMotion('frame.layout.adapt', ['margin-right']) }}><TagRow /></div> },
      { id: 'notes-colors', node: <div style={{ marginRight: colorClearance, transition: cssMotion('frame.layout.adapt', ['margin-right']) }}><SwatchRow /></div> },
    ],
    pills: NOTE_TOOLS.map((cell, i) => ({ id: cell.slot, node: <ToolPill glyph={cell.glyph} label={t(cell.labelKey)}
      helpTarget={{ page: 'notes', anchor: `notes-${cell.tool === 'erase' ? 'edit' : cell.tool}` }} commandId={cell.commandId}
      active={tool === cell.tool} centre={toolPillCentre(i, activeIndex)} onSelect={() => setTool(cell.tool)} /> })),
    activePill: NOTE_TOOLS[activeIndex]?.slot ?? null,
    options, trailing,
  };
}

const SIZE_KEY = { s: 'annot.size_s', m: 'annot.size_m', l: 'annot.size_l', none: 'annot.size_none' } as const;
const SIZE_GLYPH = { s: 8, m: 11, l: 14, none: 11 } as const;

/** How far under its size the Done and Discard pair starts as it arrives. */
const DRAFT_ACTIONS_FROM = 0.92;

/** The font size control: a zone may also carry no text; a chip is its lettering. */
function SizeOptions() {
  const t = useT();
  const size = useEditorStore(s => s.annotationSize);
  const zone = useEditorStore(s => s.annotationTool === 'zone');
  const set = useEditorStore(s => s.setAnnotationSize);
  const sizes: readonly ZoneTextSize[] = zone ? ZONE_TEXT_SIZES : CHIP_TEXT_SIZES;
  return <OptionPill value={zone ? size : chipTextSize(size)} label={t('annot.size')} commandId="tool.option_cycle" onChange={set} options={sizes.map(value => ({
    value, label: t(SIZE_KEY[value]), glyph: <svg width={51 * SCALE} height={51 * SCALE} viewBox="0 0 24 24" aria-hidden>
      <text x="12" y="17" textAnchor="middle" fontSize={SIZE_GLYPH[value] + 6} fontWeight="800" fill="currentColor" fontFamily="inherit"
        opacity={value === 'none' ? 0.45 : 1}>T</text>
      {value === 'none' && <path d="M5 19 19 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>}
    </svg>,
  }))}/>;
}

/** The region selection's own Dimensions picker, for a zone's width and height. */
function ZoneDimensions() {
  const shown = useEditorStore(s => s.annotationDimensions);
  const set = useEditorStore(s => s.setAnnotationDimensions);
  return <DimensionsToggle value={shown} onChange={set} commandId={null}/>;
}

function RouteOptions() {
  const t = useT();
  const dashed = useEditorStore(s => s.annotationRouteDashed);
  const set = useEditorStore(s => s.setAnnotationRouteDashed);
  return <OptionPill value={dashed ? 'dashed' : 'solid'} label={t('annot.line_style')} commandId="tool.option_cycle"
    onChange={value => set(value === 'dashed')} options={(['solid', 'dashed'] as const).map(value => ({
      value, label: t(value === 'dashed' ? 'annot.line_dashed' : 'annot.line_solid'),
      glyph: <svg width={51 * SCALE} height={51 * SCALE} viewBox="0 0 24 24" aria-hidden>
        <path d="M3 17C8 17 8 7 13 7c3.5 0 4.5 3 8 3.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={value === 'dashed' ? '4 3.4' : undefined}/>
      </svg>,
    }))}/>;
}

/** The tag pills: the presets, then the map's own custom tags whose text the check approved, then
 *  the pill that adds one and the pill that removes them. The armed tag stands on the grown yellow
 *  plate; picking it again clears a zone's text tag, while a chip keeps a tag. */
function TagRow() {
  const t = useT();
  const tag = useEditorStore((s) => s.annotationTag);
  const tool = useEditorStore((s) => s.annotationTool);
  const setTag = useEditorStore((s) => s.setAnnotationTag);
  const removeCustomTag = useEditorStore((s) => s.removeCustomTag);
  // The tag list is edited in place on the map's notes; the epoch says it moved.
  const epoch = useEditorStore((s) => s.annotationsEpoch);
  const map = useEditorStore((s) => s.gridState);
  const verdicts = useSyncExternalStore(onTextVerdicts, textVerdictsVersion);
  const allCustom = useVersioned(() => [...(map?.annotations?.customTags ?? [])], [map, epoch]);
  // The verdicts version stands in for the store the approval reads.
  const custom = useVersioned(() => approvedTexts(allCustom), [allCustom, verdicts]);
  const [adding, setAdding] = useState(false);
  const [removeAsked, setRemoving] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const { rowRef, rowProps } = useSwatchStripRow('none', TAG_ROW_BLEED);
  const pick = (id: NoteTag) => setTag(id === tag && tool !== 'chip' ? null : id);
  const canRemove = custom.length > 0;
  // Removal ends with the last custom tag; pressing the remove pill again, Escape or a press outside the row puts it away.
  const removing = removeAsked && canRemove;
  useSurfaceScope({ open: removing, root: rowRef, trigger: removeRef, onClose: () => setRemoving(false), outside: true });
  const pill = presence('tag.pill.arrive', { opacity: 0, scale: 1 - amplitude('tag.pill.arrive') }, { leave: 'tag.pill.leave', reduced: useReducedMotionConfig() });
  return (
    <div ref={rowRef} role="group" aria-label={t('annot.tag')} title={removing ? t('annot.tag_remove_hint') : undefined} {...rowProps}>
      {/* Presets cannot be removed, so in removal they stand dimmed and offer nothing. */}
      {SELECTABLE_ANNOTATION_TAGS.map(
        (entry) => <TagPill key={entry.id} label={t(entry.labelKey)} on={entry.id === tag} quiet={removing} onPress={() => pick(entry.id)} />,
      )}
      <AnimatePresence initial={false}>
        {custom.map((entry) => (
          <motion.span key={entry.id} style={{ display: 'flex', flex: 'none' }}
            {...pill}>
            <TagPill label={entry.text} on={entry.id === tag} removing={removing}
              aria={removing ? t('annot.tag_remove', { name: entry.text }) : entry.text}
              onPress={() => {
                if (!removing) { pick(entry.id); return; }
                if (custom.length === 1) setRemoving(false);
                removeCustomTag(entry.id);
              }} />
          </motion.span>
        ))}
      </AnimatePresence>
      <TagPill buttonRef={addRef} label={<SignGlyph plus />} aria={t('annot.tag_add')} on={false}
        onPress={() => { setRemoving(false); setAdding((open) => !open); }} />
      <TagPill buttonRef={removeRef} label={<SignGlyph />} aria={t('annot.tag_remove_mode')} on={removing} disabled={!canRemove}
        onPress={() => setRemoving((on) => !on)} />
      {/* The card and its text check load when the add pill is first pressed. */}
      <RenderBoundary resetKey={adding} fallback={<ChunkNotice />}>
        <Suspense fallback={null}>
          <AnimatePresence>
            {adding && <NewTagCard key="new-tag" anchor={addRef} custom={allCustom} onClose={() => setAdding(false)} />}
          </AnimatePresence>
        </Suspense>
      </RenderBoundary>
    </div>
  );
}

/** The plus and minus the add and remove pills wear, drawn in the pill's ink at its lettering size. */
function SignGlyph({ plus = false }: { plus?: boolean }) {
  const side = TEXT.label;
  return <svg width={side} height={side} viewBox="0 0 12 12" aria-hidden style={{ display: 'block' }}>
    <path d={plus ? 'M2 6h8M6 2v8' : 'M2 6h8'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

function TagPill({ label, aria, on, onPress, removing = false, quiet = false, disabled: unavailable = false, buttonRef }: {
  label: ReactNode;
  /** The accessible name; a text label is its own. */
  aria?: string;
  on: boolean;
  onPress: () => void;
  /** Wears the removal badge: pressing removes the tag. */
  removing?: boolean;
  /** Stands aside while the row removes tags: no action and no hover, dimmed as unavailable. */
  quiet?: boolean;
  disabled?: boolean;
  buttonRef?: RefObject<HTMLButtonElement>;
}) {
  const disabled = unavailable || quiet;
  const paint = useTransition('control.paint');
  const reduced = useReducedMotionConfig();
  const badgeSide = BADGE_SIDE;
  // In removal the whole pill is the target but the badge carries the action, so pointing anywhere
  // on the pill lights the badge and the pill itself stays still.
  const [pointedAt, setPointed] = useState<'hover' | 'press' | null>(null);
  const pointed = removing ? pointedAt : null;
  const feedback = removing ? {
    onHoverStart: () => setPointed('hover'), onHoverEnd: () => setPointed(null),
    onTapStart: () => setPointed('press'), onTap: () => setPointed('hover'), onTapCancel: () => setPointed(null),
  } : {};
  return (
    <ActionButton
      ref={buttonRef}
      interaction={removing ? 'still' : 'tile'}
      {...feedback}
      aria-label={aria ?? (typeof label === 'string' ? label : undefined)}
      aria-pressed={on}
      disabled={disabled}
      onClick={onPress}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        pointerEvents: 'auto', cursor: disabled ? cursors.default : cursors.clickable,
        height: TAG_H, padding: `0 ${TAG_H * 0.45}px`,
        display: 'flex', alignItems: 'center', color: PLATE_INK,
        opacity: disabled ? UNAVAILABLE : 1, transition: cssMotion('control.fade', ['opacity']),
      }}
    >
      <span
        style={{
          position: 'absolute', background: on ? ACTIVE : PLATE, boxShadow: plateShapeEdge(),
          inset: on ? -TAG_GROW : 0, borderRadius: radii.pill,
        }}
      />
      <span style={{ position: 'relative', display: 'flex' }}>{typeof label === 'string' ? <BarText size={TEXT.label} color={PLATE_INK}>{label}</BarText> : label}</span>
      <AnimatePresence initial={false}>
        {removing && (
          <motion.span key="badge" aria-hidden
            {...presence('tag.remove.badge', { opacity: 0, scale: 1 - amplitude('tag.remove.badge') }, { reduced })}
            style={{ position: 'absolute', top: -BADGE_OUT, right: -BADGE_OUT, width: badgeSide, height: badgeSide }}>
            <motion.span
              initial={false}
              animate={{
                scale: pointed === 'press' ? BADGE_HOVER.whileTap.scale : pointed === 'hover' ? BADGE_HOVER.whileHover.scale : 1,
                backgroundColor: pointed ? DANGER_INK : DARK_PLATE,
              }}
              transition={{ ...BADGE_HOVER.transition, backgroundColor: paint }}
              style={{
                position: 'absolute', inset: 0, borderRadius: '50%', color: ON_DARK, boxShadow: plateShapeEdge(),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <svg width={badgeSide * 0.5} height={badgeSide * 0.5} viewBox="0 0 10 10" style={{ display: 'block' }}>
                <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </ActionButton>
  );
}

/** The colour swatches, in the road strip's dress. */
function SwatchRow() {
  const t = useT();
  const color = useEditorStore((s) => s.annotationColor);
  const setColor = useEditorStore((s) => s.setAnnotationColor);
  const { rowRef, rowProps } = useSwatchStripRow('none', SWATCH_ROW_BLEED);
  const tile = TILE;
  const inner = INNER;
  const grow = GROW;
  return (
    <div ref={rowRef} role="group" aria-label={t('annot.color')} {...rowProps}>
      {ANNOTATION_COLORS.map((c) => {
        const on = c === color;
        return (
          <ActionButton
            key={c}
            interaction="tile"
            aria-label={t('annot.color')}
            aria-pressed={on}
            onClick={() => setColor(c)}
            style={{
              ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
              pointerEvents: 'auto', cursor: cursors.clickable,
              width: tile, height: tile,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span
              style={{
                position: 'absolute', background: on ? ACTIVE : PLATE,
                ...(on
                  ? { inset: -grow, borderRadius: (tile + 2 * grow) * ROUND }
                  : { inset: 0, borderRadius: tile * ROUND }),
              }}
            />
            <span
              style={{
                position: 'relative',
                width: inner, height: inner, borderRadius: inner * ROUND,
                background: c,
                // The cream tint on the cream plate needs the hairline; every swatch takes it so
                // the row is one treatment (plateShapeEdge, the drawn set's own edge).
                boxShadow: plateShapeEdge(),
              }}
            />
          </ActionButton>
        );
      })}
    </div>
  );
}
