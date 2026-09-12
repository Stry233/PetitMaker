/*
 * AnnotationBar.tsx — the bottom bar the plan-notes layer gets, in the terrain bar's own grammar.
 *
 * The same row of tool cells at the same pitch, the same brush-size slider holding the line's
 * right end (live for the zone brush and the eraser, dimmed and refusing elsewhere), and per-tool
 * settings carried as chips inside the active cell's grown pill. Above the row stand the two
 * pickers a note is made of: the color swatches nearest the cells, where the road strip stands
 * on the terrain bar, and the TAG row above them. Picking either arms it for the next note and
 * applies it to the standing draft and selection.
 *
 * While a draft stands (a zone gathering strokes, a route mid-waypoints) the row ends in Done and
 * Discard, the scope screen's own pair: a zone is several strokes until the hand says it is one.
 *
 * Pressing the active cell puts it away — nothing armed is the select state, exactly as it is on
 * the map's own tools. There is no mode block for this bar: the layer panel's 标注 row and the
 * export modal's 编辑标注 door arm `mode: 'annotate'`, and Shell raises this bar off that one fact.
 */
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import {
  ANNOTATION_COLORS, ANNOTATION_TAGS, type AnnotationTool, type AnnotationZoneShape, type TagId,
} from '../../../core/model/annotations';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { SWATCH_ROW_BOTTOM, SWATCH_ROW_GAP, ToolRow } from './ToolRow';
import { useFrameLayout, useRailClearance } from '../frame-layout';
import { cssMotion, useMotion } from '../motion/use-motion';
import { MOTIONS } from '../motion/registry';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { endCurveSession } from '../../../tools/paint';
import { btnReset, cursors, pressable, UNAVAILABLE, z } from '../../design/styles';
import { ACTIVE, PLATE, PLATE_INK, plateShapeEdge } from '../../design/tokens';
import type { Glyph } from '../frame';
import { EDGE_RIGHT, QUAD, SCALE, TEXT } from '../units';
import { BarText } from './bar-atoms';
import { BrushSizeSlider } from './BrushSizeSlider';
import { SettingChip } from './SettingChip';
import { Action } from './ScopeScreen';
import { SLIDER_LIFT } from './TerrainBar';
import { ACTIVE_PLATE, ROAD_STYLE, TOOL_CELLS } from './terrain-cells';
import { useSwatchStripRow } from './RoadStyles';
import { CELL_BOX, ToolCell } from './ToolCell';

/** The glyph ink every drawn cell in this frame uses. */
const GLYPH_INK = '#574935';

/** A cell drawing of this bar's own, emitted as SVG in the row's ink: the terrain row's drawings
 *  each carry their SURFACE (its eraser stands on a mountain), so an annotation cell wearing one
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
  `<g stroke="${GLYPH_INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  + `<path d="M14 50l3-10L40.5 16.5a5.5 5.5 0 0 1 7.8 7.8L24.5 47.5 14 50z"/>`
  + `<path d="M19.5 39l6 6"/></g>`,
  { x: 11.2, y: 13.7, w: 42, h: 39, gx: 30.5, gy: 32.5, area: 575 },
);

/** A tag chip: a plate with a short bar of lettering. */
const CHIP_GLYPH = svgGlyph(
  `<g stroke="${GLYPH_INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  + `<rect x="9" y="19" width="46" height="26" rx="9"/><path d="M20 32h24"/></g>`,
  { x: 6.2, y: 16.2, w: 51.5, h: 31.5, gx: 32, gy: 32, area: 700 },
);

/** A route: a curve running into a filled head, drawn solid — dashes at glyph size read as breaks. */
const ROUTE_GLYPH = svgGlyph(
  `<path d="M10 50C24 50 21 25 35 25c4.6 0 8 2.4 11 5" fill="none" stroke="${GLYPH_INK}" stroke-width="6" stroke-linecap="round"/>`
  + `<path d="M55.5 35.5L43 35.2 49 24.8z" fill="${GLYPH_INK}" stroke="${GLYPH_INK}" stroke-width="2" stroke-linejoin="round"/>`,
  { x: 7, y: 22, w: 51.5, h: 31, gx: 30, gy: 38.5, area: 353 },
);

/** The eraser, drawn bare: the terrain row's eraser cell stands on its surface, which is exactly
 *  what this one must not claim. */
const ERASE_GLYPH = svgGlyph(
  `<g stroke="${GLYPH_INK}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  + `<path d="M50 53H24l-13-13a5.5 5.5 0 0 1 0-7.8L32.6 10.6a5.5 5.5 0 0 1 7.8 0l12.8 12.8a5.5 5.5 0 0 1 0 7.8L38 46"/>`
  + `<path d="M22.5 21.5 42 41"/></g>`,
  { x: 6.7, y: 7, w: 50.5, h: 49.5, gx: 31, gy: 32, area: 1100 },
);

/** A terrain figure cell's shared drawing (line/curve/rect/circle are one drawing for every
 *  surface, which is what makes them honest here). */
const terrainGlyph = (cellId: string): Glyph =>
  TOOL_CELLS.find((c) => c.id === cellId)!.glyph.mountain;

interface NoteCell {
  tool: AnnotationTool;
  /** Which figure this cell arms, for the zone family; absent on the other tools. */
  shape?: AnnotationZoneShape;
  labelKey: string;
  glyph: Glyph;
  /** The numbered tool command whose key arms this cell in this mode (`kit/commands.ts`). */
  commandId: string;
}

const NOTE_CELLS: NoteCell[] = [
  // THE TERRAIN ROW'S OWN LAYOUT: the same tool stands in the same slot wherever both modes carry
  // it, the chip takes the trim's slot and the route the smart cell's, so the badges read 1 to 8.
  { tool: 'zone', shape: 'free', labelKey: 'design.free_brush', glyph: PEN_GLYPH, commandId: 'tool.brush' },
  { tool: 'erase', labelKey: 'annot.erase', glyph: ERASE_GLYPH, commandId: 'tool.eraser' },
  { tool: 'chip', labelKey: 'annot.chip', glyph: CHIP_GLYPH, commandId: 'tool.edgecut' },
  { tool: 'zone', shape: 'line', labelKey: 'design.line_brush', glyph: terrainGlyph('line'), commandId: 'tool.line' },
  { tool: 'zone', shape: 'curve', labelKey: 'design.curve_brush', glyph: terrainGlyph('curve'), commandId: 'tool.curve' },
  { tool: 'zone', shape: 'rect', labelKey: 'design.rect_brush', glyph: terrainGlyph('rect'), commandId: 'tool.rect' },
  { tool: 'zone', shape: 'circle', labelKey: 'design.circle_brush', glyph: terrainGlyph('circle'), commandId: 'tool.circle' },
  { tool: 'route', labelKey: 'annot.route', glyph: ROUTE_GLYPH, commandId: 'tool.smart' },
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
/** Room between the last cell and the draft's Done pair, in css px: the scope screen's own gap. */
const ACTION_GAP = 22;

export function AnnotationBar() {
  const layout = useFrameLayout();
  const t = useT();
  const tool = useEditorStore((s) => s.annotationTool);
  const zoneShape = useEditorStore((s) => s.annotationZoneShape);
  const setTool = useEditorStore((s) => s.setAnnotationTool);
  const setZoneShape = useEditorStore((s) => s.setAnnotationZoneShape);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const draft = useEditorStore((s) => s.annotationDraft);
  const commitDraft = useEditorStore((s) => s.commitAnnotationDraft);
  const setDraft = useEditorStore((s) => s.setAnnotationDraft);
  // The slider sets the stamp and the band width; a rectangle and a circle are the size they are
  // dragged out to, so it dims there — the terrain bar's own rule, refusal included.
  const sized = tool === 'none' || tool === 'erase'
    || (tool === 'zone' && (zoneShape === 'free' || zoneShape === 'line' || zoneShape === 'curve'));
  // A draft with something in it can be finished; a route needs two points to be a route.
  const drafted = draft?.kind === 'zone' ? draft.cells.length > 0 : draft?.kind === 'route' ? draft.points.length >= 2 : false;
  const actionsArrive = useMotion('draft.actions.arrive');
  const colorClearance = useRailClearance(SWATCH_ROW_BOTTOM, TILE);
  const tagClearance = useRailClearance(SWATCH_ROW_BOTTOM + TILE + SWATCH_ROW_GAP, TAG_H);

  return (
    <div
      {...helpTargetAttr('notes')}
      style={{
        position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        transition: cssMotion('frame.layout.adapt', 'right'),
        display: 'flex', flexDirection: 'column', gap: SWATCH_ROW_GAP,
        pointerEvents: 'none',
      }}
    >
      <div style={{ marginRight: tagClearance, transition: cssMotion('frame.layout.adapt', 'margin-right') }}><TagRow /></div>
      <div style={{ marginRight: colorClearance, transition: cssMotion('frame.layout.adapt', 'margin-right') }}><SwatchRow /></div>
      <ToolRow>
        <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', gap: QUAD.gap, flex: '0 0 auto', minWidth: 0 }}>
          {NOTE_CELLS.map((cell, i) => {
            const active = tool === cell.tool && (cell.shape === undefined || zoneShape === cell.shape);
            return (
              <ToolCell
                key={cell.commandId}
                glyph={cell.glyph}
                label={t(cell.labelKey)}
                commandId={cell.commandId}
                active={active}
                centre={QUAD.left + i * (CELL_BOX.w + QUAD.gap) + CELL_BOX.w / 2}
                onSelect={() => {
                  if (active) { setTool('none'); return; }
                  if (cell.shape) setZoneShape(cell.shape);
                  setTool(cell.tool);
                }}
                {...(active ? carriedBy(cell.tool) : {})}
              />
            );
          })}
          <AnimatePresence>
            {drafted ? (
              <motion.span
                key="draft-actions"
                initial={{ opacity: 0, y: MOTIONS['draft.actions.arrive'].amplitude, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: MOTIONS['draft.actions.arrive'].amplitude, scale: 0.92 }}
                transition={actionsArrive}
                style={{ display: 'flex', alignItems: 'center', gap: QUAD.gap, marginLeft: ACTION_GAP - QUAD.gap }}
              >
                <Action label={t('annot.discard')} onPress={() => { endCurveSession(); setDraft(null); }} />
                <Action label={t('annot.done')} primary onPress={() => { commitDraft(); }} />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
        <div
          style={{
            flex: 'none', marginLeft: 'auto', marginTop: SLIDER_LIFT,
            display: 'flex', alignItems: 'center', gap: 14,
            opacity: sized ? 1 : UNAVAILABLE,
          }}
        >
          <BrushSizeSlider value={brushSize} onChange={setBrushSize} disabled={!sized} />
        </div>
      </ToolRow>
    </div>
  );
}

/** The setting the active cell's pill carries, per tool — the auto-trim idiom. */
function carriedBy(tool: AnnotationTool): { carries?: ReactNode } {
  if (tool === 'zone' || tool === 'chip') return { carries: <SizeChip /> };
  if (tool === 'route') return { carries: <RouteDashChip /> };
  return {};
}

const SIZE_NEXT = { s: 'm', m: 'l', l: 's' } as const;
const SIZE_KEY = { s: 'annot.size_s', m: 'annot.size_m', l: 'annot.size_l' } as const;
const SIZE_GLYPH = { s: 8, m: 11, l: 14 } as const;

function SizeChip() {
  const t = useT();
  const size = useEditorStore((s) => s.annotationSize);
  const set = useEditorStore((s) => s.setAnnotationSize);
  return (
    <SettingChip
      state={size}
      name={t(SIZE_KEY[size])}
      label={t('annot.size')}
      on
      glyph={(px, color) => (
        <svg width={px} height={px} viewBox="0 0 24 24">
          <text x="12" y="17" textAnchor="middle" fontSize={SIZE_GLYPH[size] + 6} fontWeight="800" fill={color} fontFamily="inherit">T</text>
        </svg>
      )}
      onCycle={() => set(SIZE_NEXT[size])}
    />
  );
}

function RouteDashChip() {
  const t = useT();
  const dashed = useEditorStore((s) => s.annotationRouteDashed);
  const set = useEditorStore((s) => s.setAnnotationRouteDashed);
  return (
    <SettingChip
      state={dashed ? 'dashed' : 'solid'}
      name={t(dashed ? 'annot.line_dashed' : 'annot.line_solid')}
      label={t('annot.line_style')}
      on
      glyph={(size, color) => (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M3 17C8 17 8 7 13 7c3.5 0 4.5 3 8 3.6" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={dashed ? '4 3.4' : undefined} />
        </svg>
      )}
      onCycle={() => set(!dashed)}
    />
  );
}

/** The tag pills: the label on a low plate, the armed one on the grown yellow plate. */
function TagRow() {
  const t = useT();
  const tag = useEditorStore((s) => s.annotationTag);
  const setTag = useEditorStore((s) => s.setAnnotationTag);
  const { rowRef, rowProps } = useSwatchStripRow();
  return (
    <div ref={rowRef} role="group" aria-label={t('annot.tag')} {...rowProps}>
      {ANNOTATION_TAGS.map((entry) => <TagPill key={entry.id} id={entry.id} label={t(entry.labelKey)} on={entry.id === tag} onPick={setTag} />)}
    </div>
  );
}

function TagPill({ id, label, on, onPick }: { id: TagId; label: string; on: boolean; onPick: (id: TagId) => void }) {
  return (
    <motion.button
      type="button"
      {...pressable}
      aria-label={label}
      aria-pressed={on}
      onClick={() => onPick(id)}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        pointerEvents: 'auto', cursor: cursors.clickable,
        height: TAG_H, padding: `0 ${TAG_H * 0.45}px`,
        display: 'flex', alignItems: 'center',
      }}
    >
      <span
        style={{
          position: 'absolute', background: on ? ACTIVE : PLATE, boxShadow: plateShapeEdge(),
          inset: on ? -TAG_GROW : 0, borderRadius: 999,
        }}
      />
      <span style={{ position: 'relative' }}><BarText size={TEXT.label} color={PLATE_INK}>{label}</BarText></span>
    </motion.button>
  );
}

/** The colour swatches, in the road strip's dress. */
function SwatchRow() {
  const t = useT();
  const color = useEditorStore((s) => s.annotationColor);
  const setColor = useEditorStore((s) => s.setAnnotationColor);
  const { rowRef, rowProps } = useSwatchStripRow();
  const tile = TILE;
  const inner = INNER;
  const grow = GROW;
  return (
    <div ref={rowRef} role="group" aria-label={t('annot.color')} {...rowProps}>
      {ANNOTATION_COLORS.map((c) => {
        const on = c === color;
        return (
          <motion.button
            key={c}
            type="button"
            {...pressable}
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
          </motion.button>
        );
      })}
    </div>
  );
}
