/*
 * TerrainBar.tsx — the bottom bar the three terrain surfaces share.
 *
 * One component, parameterised by surface, because the three bars are one shape: the same row of
 * tool cells, the same smart-build cell at the end, the same brush-size slider on the right. Only
 * the first two glyphs and the smart-build actions differ, and both of those are data.
 *
 * The row FLOWS from the bottom-left corner at a fixed pitch, so it is the same row at every window
 * size; each cell is the design's own drawing, scaled to the size the row READS at rather than to
 * the size the artist drew it (`terrain-cells.ts:GLYPH`). The active cell's name stands under it on
 * the map rather than in a slot of its own — a name is as wide as the word, and the words differ by
 * a factor of three across the seven languages.
 *
 * THE SLIDER IS A MEMBER OF THE TOOL ROW, not a control parked in the corner. It is one flex line
 * with the cells, so the two keep their relation when the row wraps and cannot run into each other
 * at a narrow window; held apart by a `bottom` of its own the slider was 35 px low. Where on that
 * line it sits is `SLIDER_LIFT`, which centres it on the cells rather than hanging it off their
 * bottom edge, and its right edge is the frame's own margin, which is where the view kit's column
 * stands: a slider in this interface is at the right, on that line.
 *
 * IT ALSO SAYS WHEN IT DOES NOT APPLY. A rectangle and a circle are laid to the size they are
 * dragged out to and the trimmer takes one corner, so for those three there is no width for this to
 * set (`terrain-cells.ts:ToolCell.sized`) — nor for the ERASER once its own shape is one of the
 * same two figures. It stays on the row, dimmed and refusing, because a
 * control that vanished would reflow the row on every tool change and one that stayed live-looking
 * would be a lie.
 *
 * Nothing down here wears a plate that is not a control. The reading beside the slider stands on the
 * MAP, in the outline every unplated word in this frame wears; the slider's own dark track is the
 * design's drawing of a groove, so it stays.
 *
 * A cell writes through `setEditMode`, which is the only writer of the four tool facts. The row
 * does not name a tool: it names the two inputs a shell offers (which tool, which shape) and the
 * resolver decides what the map arms — the four shape cells all resolve to one tool that
 * multiplexes the figure internally, so a row that set tools directly would be re-deciding that.
 *
 * The badges are the LIVE keybindings, read the way the keyboard page reads them, so a rebind shows
 * here with no wiring of its own. The design source drew a sample of them; every cell that has a
 * binding carries one.
 */
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { tourTargetAttr } from '../../chrome/tour/steps';
import { UNAVAILABLE, z } from '../../design/styles';
import { EDGE_RIGHT, QUAD, SCALE } from '../units';

import { BrushSizeSlider } from './BrushSizeSlider';
import { RoadStyles } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AUTO_TRIM, CELL_BOX, ERASER_SHAPE, ToolCell } from './ToolCell';
import { BRUSH, TOOL_CELLS, activeCellId, type TerrainSurface } from './terrain-cells';

/**
 * Where the bar's right edge stops: the frame's own right margin, which is where the view kit's
 * buttons stand.
 *
 * SO THE SLIDER ENDS ON THE COLUMN'S LINE rather than short of it. Nothing holds the bar off the
 * kit, because the two never share a row of pixels. Both are anchored to the bottom of the window, so the distance
 * between them is a constant: the kit's own floor is `RAIL_FLOOR` and the tool row's plates stop at
 * `QUAD.bottom + CELL_BOX.h`, which leaves about six px at 720, 900 and 1440 alike. What the kit had
 * to be held off was the SHELF's plate, and that is what `RAIL_FLOOR` is.
 *
 * It is also what the tool row wraps at, so the bar is wider by a button and a margin and wraps that
 * much later.
 */
const BAR_RIGHT = EDGE_RIGHT;

/** The brush reading, at the size the design draws it: half again the tool captions beside it,
 *  because it is a figure read on its own rather than a name under a picture. Exported because the
 *  scope screen wears this bar's layout, down to the reading beside its slider. */
export const READOUT_SIZE = Math.round(BRUSH.readoutSize * SCALE);

/**
 * How far off the row's bottom line the reading and its slider stand, in css px.
 *
 * A CELL AND A SLIDER ARE NOT THE SAME HEIGHT, so sharing a bottom edge is not what makes them line
 * up. The groove is 79 design px against the cell plate's 115, and the knob riding it is a cream
 * disc among cream pills — the eye pairs the two shapes and reads the disc as the low one, because
 * it hangs 4 px past the line every plate on the row stops at, with its top 14 px inside theirs.
 * Measured in the browser, the whole assembly sat 9 px under the band the cells occupy.
 *
 * So it is CENTRED on that band, on the cells' plates: those are filled pills drawn to their own
 * boxes, and each cell's drawing is balanced on the same middle (`GlyphIcon` centres a glyph by its
 * ink), so the plate edges and the glyphs agree on one line to centre against. The shortcut badges
 * do not — they deliberately overhang each cell's top — and neither does the caption under the
 * active cell, which is a name for the tool rather than part of the row.
 *
 * The slider's own middle is `BRUSH.centreY`, the line its ticks and its knob are both drawn on,
 * not the middle of the groove's box: the two are half a design px apart here and there is no
 * reason for the next drawing to be as kind.
 *
 * It is a MARGIN rather than an `alignSelf`, because the tool row wraps: centred against the whole
 * flex line, a slider beside two wrapped rows of cells would float between them instead of standing
 * with the row it reads against.
 */
export const SLIDER_LIFT = CELL_BOX.h / 2 - (BRUSH.centreY - BRUSH.track.y) * SCALE;

/**
 * Between the road swatches and the tool row under them, in css px.
 *
 * Judged, not the design's own 30 design px. The shortcut badge overhangs the top of every cell by
 * 7 px, and the design draws no badge, so the drawing's gap leaves four pixels between a swatch and
 * a "B" and the two rows read as one crowded block.
 */
const SWATCH_GAP = 20;

/**
 * What pressing the ACTIVE cell writes: a cell is a toggle, the way a mode block is.
 *
 * PUTTING A TOOL AWAY IS NOT LEAVING THE MODE. A block's second press clears the mode and takes the
 * bar with it; a tool lives inside a mode that is still chosen, so this leaves the surface in force
 * with its bar up and nothing armed on the map. `core/model/edit-mode.ts:resolveEditMode` already
 * has that state and calls it `tool: 'none'` — the hand, with the mode's own content type kept, so
 * the next press on the same surface resumes where it left off.
 *
 * The SHAPE is deliberately not cleared with it. It is which figure the shape tool lays rather than
 * a tool of its own, so a visitor who puts the circle away and picks it up again gets the circle.
 */
const PUT_AWAY = { tool: 'none' } as const;

export function TerrainBar({ surface }: { surface: TerrainSurface }) {
  const t = useT();
  const editMode = useEditorStore((s) => s.editMode);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const eraserShape = useEditorStore((s) => s.eraserShape);
  const active = activeCellId(editMode.tool, editMode.shape);
  // A rectangle, a circle and the trimmer lay a figure of their own size, so while one of them is
  // armed the slider has nothing to set. With NOTHING armed it stays live: the width is the store's
  // and it is what the next tool picked up will lay at.
  const armed = TOOL_CELLS.find((cell) => cell.id === active);
  // The eraser is `sized` for its DAB and not for its two drag shapes, which are taken at whatever
  // size they were dragged out to — the same reason the rectangle and circle cells are not.
  const dragShaped = armed?.eraserShape === true && eraserShape !== 'dot';
  const sized = !armed || (armed.sized === true && !dragShaped);

  return (
    <div
      style={{
        position: 'fixed', left: QUAD.left, right: BAR_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        display: 'flex', flexDirection: 'column', gap: SWATCH_GAP,
        // The column spans the window, so it must let a press through everywhere it is not a
        // control; each control below claims its own pointer events.
        pointerEvents: 'none',
      }}
    >
      {surface === 'road' ? <RoadStyles /> : null}

      {/* `flex-start` is the BOTTOM here. `wrap-reverse` swaps the cross axis's two ends, so a row
          that hangs off the window's bottom edge and grows upward aligns its members with the start
          it flipped, and asking for `flex-end` puts them on the line's TOP — which is where the
          slider sat, 16 px clear of the cells it is meant to line up with. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: QUAD.gap, flexWrap: 'wrap-reverse' }}>
        <div
          {...tourTargetAttr('bar')}
          style={{
            display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap-reverse', gap: QUAD.gap,
            // As wide as the cells and no wider, but free to shrink: what gives at a narrow window
            // is this group, which wraps UPWARD (it hangs off the bottom edge) while the slider
            // keeps its place on the line. The smart-build proposal puts three more pills in here,
            // and in Russian they are three times the width of the Chinese the drawing measured.
            flex: '0 1 auto', minWidth: 0,
          }}
        >
          {/* The pitch a name is centred on holds because a cell only widens the row while it is the
              ACTIVE one, and only the active cell shows a name: every cell standing at the pitch
              this counts out has nothing to its left that has grown. */}
          {TOOL_CELLS.map((cell, i) => (
            <ToolCell
              key={cell.id}
              glyph={cell.glyph[surface]}
              label={t(cell.labelKey)}
              commandId={cell.commandId}
              active={cell.id === active}
              centre={QUAD.left + i * (CELL_BOX.w + QUAD.gap) + CELL_BOX.w / 2}
              onSelect={() => setEditMode(cell.id === active ? PUT_AWAY : cell.edit)}
              {...(cell.autoTrim ? { carries: AUTO_TRIM } : cell.eraserShape ? { carries: ERASER_SHAPE } : {})}
            />
          ))}
          {/* The eighth cell, counted onto the same pitch as the seven so its name lands where
              theirs do. */}
          <SmartBuild
            surface={surface}
            centre={QUAD.left + TOOL_CELLS.length * (CELL_BOX.w + QUAD.gap) + CELL_BOX.w / 2}
          />
        </div>

        {/* The far end of the same line, centred on the cells by `SLIDER_LIFT`: the reading stands
            on the map in the frame's own outline, and the groove under the knob is the design's
            drawing, not a plate. */}
        {/* The gap is wider than the design's own 13 design px because the design drew the knob at
            the middle of its travel: at one cell it stands on the track's left end, right against
            the reading. */}
        <div
          style={{
            flex: 'none', marginLeft: 'auto', marginBottom: SLIDER_LIFT,
            display: 'flex', alignItems: 'center', gap: 14,
            opacity: sized ? 1 : UNAVAILABLE,
          }}
        >
          {/* The reading rides the KNOB now (`BarSlider`), so the row keeps only the control. A
              number standing permanently beside a track is read once and never again, and it was the
              widest thing on this end of the bar. */}
          <BrushSizeSlider value={brushSize} onChange={setBrushSize} disabled={!sized} />
        </div>
      </div>
    </div>
  );
}
