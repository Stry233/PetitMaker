/*
 * AnnotationBar.tsx — the bottom bar the plan-notes layer gets, in the terrain bar's own grammar.
 *
 * The same row of tool cells at the same pitch, the same brush-size slider holding the line's
 * right end (live for the zone brush, dimmed and refusing elsewhere), the color swatches above the
 * row where the road styles stand, and per-tool settings carried as chips inside the active cell's
 * grown pill. Pressing the active cell puts it away — nothing armed is the select state, exactly
 * as it is on the map's own tools.
 *
 * There is no mode block for this bar: the layer panel's 标注 row and the export modal's
 * 编辑标注 door arm `mode: 'annotate'`, and Shell raises this bar off that one fact.
 *
 * The zone cells offer the terrain row's own figure set — free brush, line, curve, rectangle,
 * circle — and the four figure cells wear the terrain row's own drawings, which are shared,
 * surface-free shapes. The free-zone, text, route and erase cells wear drawings of this bar's own
 * (inline SVG in the row's ink): the terrain row's OTHER drawings each carry their surface, so a
 * borrowed one would name the wrong thing here.
 */
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { ANNOTATION_COLORS, type AnnotationTool, type AnnotationZoneShape } from '../../../core/model/annotations';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { showToast } from '../../../core/runtime/toast-bus';
import { SWATCH_ROW_BOTTOM, SWATCH_ROW_GAP, ToolRow } from './ToolRow';
import { useFrameLayout, useRailClearance } from '../frame-layout';
import { cssMotion } from '../motion/use-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { btnReset, cursors, pressable, UNAVAILABLE, z } from '../../design/styles';
import { ACTIVE, PLATE, plateShapeEdge } from '../../design/tokens';
import type { Glyph } from '../frame';
import { EDGE_RIGHT, QUAD, SCALE } from '../units';
import { BrushSizeSlider } from './BrushSizeSlider';
import { SettingChip } from './SettingChip';
import { SLIDER_LIFT } from './TerrainBar';
import { ACTIVE_PLATE, ROAD_STYLE, TOOL_CELLS } from './terrain-cells';
import { useSwatchStripRow } from './RoadStyles';
import { CELL_BOX, ToolCell } from './ToolCell';

/** The glyph ink every drawn cell in this frame uses. */
const GLYPH_INK = '#574935';

/** A cell drawing of this bar's own, emitted as SVG in the row's ink: the terrain row's drawings
 *  each carry their SURFACE (its eraser stands on a mountain), so an annotation cell wearing one
 *  would name the wrong thing. Ink measurements by the same rules the extractor applies to the
 *  drawn set (bounding box, centre of mass, covered area), taken off the geometry. */
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

/** A text note: the lettering itself. */
const TEXT_GLYPH = svgGlyph(
  `<g stroke="${GLYPH_INK}" stroke-width="7.5" stroke-linecap="round" fill="none"><path d="M14 15h36M32 15v35"/></g>`,
  // Trimmed to the row's filled figures: two bare strokes are the row's sparsest ink, and the
  // formula's area discount grows them a tenth past the rect/circle/eraser band.
  { x: 10.2, y: 11.2, w: 43.5, h: 42.5, gx: 32, gy: 23.6, area: 533, trim: 0.9 },
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
  /** Unbound today, so the badge slot stays empty; a binding would light it with no change here. */
  commandId: string;
}

const NOTE_CELLS: NoteCell[] = [
  // THE TERRAIN ROW'S OWN LAYOUT: the same tool stands in the same slot wherever both modes carry
  // it, the text takes the trim's slot and the route the smart cell's, so the badges read 1 to 8
  // across the row. Each cell names the NUMBERED TOOL COMMAND whose key arms it in this mode
  // (`kit/commands.ts`'s annotate reroute), so the badge is the live binding and a rebind
  // re-badges the cell.
  { tool: 'zone', shape: 'free', labelKey: 'design.free_brush', glyph: PEN_GLYPH, commandId: 'tool.brush' },
  { tool: 'erase', labelKey: 'annot.erase', glyph: ERASE_GLYPH, commandId: 'tool.eraser' },
  { tool: 'text', labelKey: 'annot.text', glyph: TEXT_GLYPH, commandId: 'tool.edgecut' },
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

export function AnnotationBar() {
  const layout = useFrameLayout();
  const clearance = useRailClearance(SWATCH_ROW_BOTTOM, TILE);
  const t = useT();
  const tool = useEditorStore((s) => s.annotationTool);
  const zoneShape = useEditorStore((s) => s.annotationZoneShape);
  const setTool = useEditorStore((s) => s.setAnnotationTool);
  const setZoneShape = useEditorStore((s) => s.setAnnotationZoneShape);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  // The slider sets the stamp and the band width; a rectangle and a circle are the size they are
  // dragged out to, so it dims there — the terrain bar's own rule, refusal included.
  const sized = tool === 'none'
    || (tool === 'zone' && (zoneShape === 'free' || zoneShape === 'line' || zoneShape === 'curve'));

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
      <div style={{ marginRight: clearance, transition: cssMotion('frame.layout.adapt', 'margin-right') }}><SwatchRow /></div>
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
  // The zone's caption is text too, so the zone tool carries the same size chip the text tool does.
  if (tool === 'zone') return { carries: <TextSizeChip /> };
  if (tool === 'text') {
    return {
      carries: (
        <span style={{ display: 'flex', gap: 6 }}>
          <TextStyleChip />
          <TextSizeChip />
        </span>
      ),
    };
  }
  if (tool === 'route') return { carries: <RouteDashChip /> };
  return {};
}

function TextStyleChip() {
  const t = useT();
  const style = useEditorStore((s) => s.annotationTextStyle);
  const set = useEditorStore((s) => s.setAnnotationTextStyle);
  const plate = style === 'chip';
  return (
    <SettingChip
      state={style}
      name={t(plate ? 'annot.text_plate' : 'annot.text_plain')}
      label={t('annot.text_style')}
      on={plate}
      glyph={(size, color) => (
        <svg width={size} height={size} viewBox="0 0 24 24">
          {plate ? <rect x="2.5" y="5" width="19" height="14" rx="4" fill="none" stroke={color} strokeWidth="2.2" /> : null}
          <path d="M8.5 9.5h7M12 9.5v6" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      )}
      onCycle={() => set(plate ? 'label' : 'chip')}
    />
  );
}

const SIZE_NEXT = { s: 'm', m: 'l', l: 's' } as const;
const SIZE_KEY = { s: 'annot.size_s', m: 'annot.size_m', l: 'annot.size_l' } as const;
const SIZE_GLYPH = { s: 8, m: 11, l: 14 } as const;

function TextSizeChip() {
  const t = useT();
  const size = useEditorStore((s) => s.annotationTextSize);
  const set = useEditorStore((s) => s.setAnnotationTextSize);
  return (
    <SettingChip
      state={size}
      name={t(SIZE_KEY[size])}
      label={t('annot.text_size')}
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

function SwatchRow() {
  const t = useT();
  const color = useEditorStore((s) => s.annotationColor);
  const setColor = useEditorStore((s) => s.setAnnotationColor);
  // The road strip's own scrolling shell: more colours than the bar has width scroll rather than
  // spilling, with the same glide, fades and solid pointer surface.
  const { rowRef, rowProps } = useSwatchStripRow();

  const pick = (c: string): void => {
    setColor(c);
    // A pick while a note is selected recolors it too — the one edit the swatches themselves make,
    // so the layer's own lock and eye must answer here as they do at the tool.
    const s = useEditorStore.getState();
    const data = s.gridState?.annotations;
    const sel = s.annotationSelection;
    if (sel.length === 0 || !data) return;
    if (!data.visible) { showToast(t('annot.hidden'), 'warning'); return; }
    if (data.locked) { showToast(t('annot.locked'), 'warning'); return; }
    // The whole selection recolours as ONE lane entry, however many notes ride it.
    s.beginAnnotationStroke();
    s.applyAnnotationEdit((d) => {
      for (const id of sel) {
        const i = d.items.findIndex((n) => n.id === id);
        if (i >= 0) d.items[i] = { ...d.items[i]!, color: c } as typeof d.items[number];
      }
    });
  };

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
            onClick={() => pick(c)}
            style={{
              ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
              pointerEvents: 'auto', cursor: cursors.clickable,
              width: TILE, height: TILE,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span
              style={{
                position: 'absolute', background: on ? ACTIVE : PLATE,
                ...(on
                  ? { inset: -GROW, borderRadius: (TILE + 2 * GROW) * ROUND }
                  : { inset: 0, borderRadius: TILE * ROUND }),
              }}
            />
            <span
              style={{
                position: 'relative',
                width: INNER, height: INNER, borderRadius: INNER * ROUND,
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
