/**
 * Shared bottom bar for terrain surfaces. Data selects the surface-specific glyphs and Smart Build
 * actions; tool facts still flow through `setEditMode`. The tool cells and size slider share a
 * horizontal scroll row. Shape-sized tools keep the slider visible but disabled to preserve layout.
 * Shortcut badges read live keybindings.
 */
import { useFrameLayout } from '../frame-layout';
import type { BuildShape, BuildTool } from '../../../core/model/edit-mode';
import type { EraserShape } from '../../../core/model/types';
import { SWATCH_ROW_GAP, ToolRow } from './ToolRow';
import { cssMotion } from '../motion/use-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { tourTargetAttr } from '../../chrome/tour/steps';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { UNAVAILABLE, z } from '../../design/styles';
import { EDGE_RIGHT, QUAD, SCALE } from '../units';

import { BrushSizeSlider } from './BrushSizeSlider';
import { RoadStyles } from './RoadStyles';
import { SmartBuild } from './SmartBuild';
import { AUTO_TRIM, CELL_BOX, ERASER_SHAPE, ToolCell } from './ToolCell';
import { BRUSH, TOOL_CELLS, activeCellId, type TerrainSurface } from './terrain-cells';
/** The brush reading, at the size the design draws it: half again the tool captions beside it,
 *  because it is a figure read on its own rather than a name under a picture. Exported because the
 *  scope screen wears this bar's layout, down to the reading beside its slider. */
export const READOUT_SIZE = Math.round(BRUSH.readoutSize * SCALE);

/** Margin that aligns the slider with the tool-cell plates. */
export const SLIDER_LIFT = CELL_BOX.h / 2 - (BRUSH.centreY - BRUSH.track.y) * SCALE;

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

/** Shared tool arrangement for the editor and help figures. */
export function TerrainRow({ surface, activeTool, activeShape, eraserShape, brushSize, onBrushSize, onSelect }: {
  surface: TerrainSurface;
  activeTool: BuildTool;
  activeShape: BuildShape;
  eraserShape: EraserShape;
  brushSize: number;
  onBrushSize: (n: number) => void;
  onSelect: (edit: { tool: BuildTool; shape?: BuildShape }) => void;
}) {
  const t = useT();
  const active = activeCellId(activeTool, activeShape);
  // A rectangle, a circle and the trimmer lay a figure of their own size, so while one of them is
  // armed the slider has nothing to set. With NOTHING armed it stays live: the width is the store's
  // and it is what the next tool picked up will lay at.
  const armed = TOOL_CELLS.find((cell) => cell.id === active);
  // The eraser is `sized` for its DAB and not for its two drag shapes, which are taken at whatever
  // size they were dragged out to — the same reason the rectangle and circle cells are not.
  const dragShaped = armed?.eraserShape === true && eraserShape !== 'dot';
  const sized = !armed || (armed.sized === true && !dragShaped);

  return (
    <ToolRow>
      <div
        {...tourTargetAttr('bar')}
        {...helpTargetAttr('terrain')}
        style={{
          display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', gap: QUAD.gap,
          flex: '0 0 auto', minWidth: 0,
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
            onSelect={() => onSelect(cell.id === active ? PUT_AWAY : cell.edit)}
            {...(cell.autoTrim ? { carries: AUTO_TRIM } : cell.eraserShape ? { carries: ERASER_SHAPE } : {})}
            {...(cell.id === 'trim' ? { helpTarget: 'trim' } : {})}
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
          flex: 'none', marginLeft: 'auto', marginTop: SLIDER_LIFT,
          display: 'flex', alignItems: 'center', gap: 14,
          opacity: sized ? 1 : UNAVAILABLE,
        }}
      >
        {/* The reading rides the KNOB now (`BarSlider`), so the row keeps only the control. A
            number standing permanently beside a track is read once and never again, and it was the
            widest thing on this end of the bar. */}
        <BrushSizeSlider value={brushSize} onChange={onBrushSize} disabled={!sized} />
      </div>
    </ToolRow>
  );
}

export function TerrainBar({ surface }: { surface: TerrainSurface }) {
  const layout = useFrameLayout();
  const editMode = useEditorStore((s) => s.editMode);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const eraserShape = useEditorStore((s) => s.eraserShape);

  return (
    <div
      style={{
        position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        transition: cssMotion('frame.layout.adapt', 'right'),
        display: 'flex', flexDirection: 'column', gap: SWATCH_ROW_GAP,
        // The column spans the window, so it must let a press through everywhere it is not a
        // control; each control below claims its own pointer events.
        pointerEvents: 'none',
      }}
    >
      {surface === 'road' ? <RoadStyles /> : null}
      <TerrainRow
        surface={surface}
        activeTool={editMode.tool}
        activeShape={editMode.shape}
        eraserShape={eraserShape}
        brushSize={brushSize}
        onBrushSize={setBrushSize}
        onSelect={setEditMode}
      />
    </div>
  );
}
