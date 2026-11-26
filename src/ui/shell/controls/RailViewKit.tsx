/** The rail's view kit: the 2D/3D switch, the hide toggle, fit, zoom and the turns. */
import type { Ref } from 'react';
import { group, RailButton } from './RailButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { motion } from 'framer-motion';
import { helpTargetAttr } from '../../session/help-targets';
import { hasWebGL2 } from '../../../platform/device/device-quality';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { FramePose } from '../../../state/frame-pose';
import { sessionOffers } from '../../../state/session-offer';
import { interfaceHideable } from '../../../state/slices/blueprint';
import { FitIcon as FitGlyph } from '../../primitives/line-glyphs';
import {
  apparentSize, FIT_BOX, FIT_INK, FIT_TRIM, GLYPHS, viewKitCell,
} from '../frame';
import type { RailPlan } from '../frame-plan';
import { GlyphIcon } from '../GlyphIcon';
import { usePlanGlide } from '../frame-layout';
import { INK } from '../../design/tokens';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { RAIL } from '../units';
import { roleSize } from '../../design/text-weight';
import { useRunCommand } from '../use-shell-commands';
import { useMorphGroup } from '../../primitives/morph';

/** Size the fit-to-view icon by its visible ink rather than its source box. */
function FitIcon() {
  const box = FIT_BOX * FIT_TRIM * (RAIL.glyph / apparentSize(FIT_INK));
  return <span style={{ display: 'flex', width: box, height: box, flex: 'none' }}><FitGlyph size={box} /></span>;
}
/** Ms between repeats while a stepper is held: zoom and the turns repeat, the toggles and fit do not. */
const STEP_REPEAT = 90;
/** The two turns, named from the visitor's side: `dir: 1` is a drag to the right, carrying the planet that way. */
const YAW_TURNS = [
  { dir: -1, direction: 'left', flip: true, labelKey: 'a11y.rotate_left', tourTarget: 'turn-left' },
  { dir: 1, direction: 'right', flip: false, labelKey: 'a11y.rotate_right', tourTarget: 'turn-right' },
] as const;
/** The commands of the kit's first two cells, the view switch and the hide toggle: a session that
 *  offers neither keeps the camera steps alone, standing where the two stood. */
const LEAD = ['view.toggle', 'view.interface_hidden'] as const;
/**
 * The view kit: the 2D/3D switch, the hide toggle, fit, zoom and the turns. The hide toggle is the one
 * button left standing when the interface is away, dimmed until reached for, so the way back is the
 * press that was the way out.
 */
export function ViewKit({ boxRef, plan, right, hidden, onHide, pose }: {
  boxRef?: Ref<HTMLDivElement>; plan: RailPlan; right: number; hidden: boolean; onHide: () => void; pose: FramePose;
}) {
  const t = useT();
  const glide = usePlanGlide('frame.layout.adapt');
  const weightAt = useFrameReadableWeight();
  const viewMode = useEditorStore((s) => s.viewMode);
  const hideable = useEditorStore(interfaceHideable);
  const run = useRunCommand();
  const webgl2 = hasWebGL2();
  // The fill direction follows the buttons on screen, not the planned complement; a planet session keeps
  // only the camera steps. Without the steppers (`RailPlan.steppers`, touch mode) the kit is its first
  // three buttons in either view.
  const [switchOffered, hideOffered] = LEAD.map((id) => sessionOffers(pose, id));
  const veiledCells = LEAD.length - (switchOffered ? 1 : 0) - (hideOffered ? 1 : 0);
  const shown = plan.kitButtons - veiledCells;
  const cell = (i: number) => viewKitCell(Math.max(0, i < LEAD.length && switchOffered ? i : i - veiledCells), shown, plan.kitFiles);
  /** A row an upright panel stands over steps aside while it is open (`RailPlan.kitRows`). */
  const under = (i: number) => plan.kitRows !== undefined && cell(i).row > plan.kitRows;
  return (
    <motion.div
      ref={boxRef}
      data-testid="shell-view-kit"
      {...useMorphGroup()}
      {...helpTargetAttr('camera')}
      {...mapEdgeAttr('right')}
      style={{
        ...group,
        top: plan.kitTop, right,
        transition: glide(['top', 'right']),
        // Explicit cells keep exiting yaw buttons from reflowing the remaining controls.
        display: 'grid',
        gridTemplateColumns: `repeat(${plan.kitFiles}, ${RAIL.button}px)`,
      }}
    >
      {/* The drawing marks the 3D view by filling this plate yellow, so the toggle is one button in
          two states rather than a pair of switches. */}
      <RailButton
        morph="view-toggle"
        label={t('a11y.toggle_view')}
        helpTarget="camera"
        on={viewMode === '3d'}
        files={plan.kitFiles}
        cell={cell(0)}
        grow="left"
        veiled={hidden || !switchOffered || under(0)}
        unavailable={!webgl2}
        tourTarget="view3d"
        onPress={() => run('view.toggle')}
      >
        <span style={{ fontSize: roleSize('lead'), fontWeight: weightAt(900, roleSize('lead')), color: INK }}>{viewMode.toUpperCase()}</span>
      </RailButton>
      <RailButton
        morph="hide"
        label={t(hidden ? 'a11y.show_ui' : 'a11y.hide_ui')}
        helpTarget="frame"
        files={plan.kitFiles}
        cell={cell(1)}
        grow="left"
        dim={hidden}
        veiled={!hideOffered || (!hidden && under(1))}
        unavailable={!hidden && !hideable}
        onPress={onHide}
      >
        <GlyphIcon glyph={GLYPHS.hideUi} size={RAIL.glyph} />
      </RailButton>
      {/* The design source drew no fit-to-view glyph, so this is the app's own stroke icon. A text
          arrow would render as flat type on one platform and as colour emoji on the next. */}
      <RailButton
        morph="fit"
        label={t('a11y.fit_view')}
        files={plan.kitFiles}
        cell={cell(2)}
        grow="left"
        veiled={hidden || under(2)}
        tourTarget="fit"
        onPress={() => run('camera.fit')}
      >
        <FitIcon />
      </RailButton>
      {plan.steppers ? <>
      <RailButton
        morph="zoom-in"
        label={t('a11y.zoom_in')}
        files={plan.kitFiles}
        cell={cell(3)}
        grow="left"
        repeat={STEP_REPEAT}
        veiled={hidden || under(3)}
        tourTarget="zoom-in"
        onPress={() => run('camera.zoom_in')}
      >
        <GlyphIcon glyph={GLYPHS.zoomIn} size={RAIL.glyph} />
      </RailButton>
      <RailButton
        morph="zoom-out"
        label={t('a11y.zoom_out')}
        files={plan.kitFiles}
        cell={cell(4)}
        grow="left"
        repeat={STEP_REPEAT}
        veiled={hidden || under(4)}
        tourTarget="zoom-out"
        onPress={() => run('camera.zoom_out')}
      >
        <GlyphIcon glyph={GLYPHS.zoomOut} size={RAIL.glyph} />
      </RailButton>
      </> : null}
      {/* The turns stand and leave with the zoom pair, as the input mode's morph carries them. */}
      {plan.steppers ? YAW_TURNS.map(({ dir, direction, flip, labelKey, tourTarget }) => (
          <RailButton
            key={dir}
            morph={`turn-${dir}`}
            label={t(labelKey)}
            files={plan.kitFiles}
            cell={cell(plan.kitButtons - YAW_TURNS.length + YAW_TURNS.findIndex((y) => y.dir === dir))}
            grow="left"
            repeat={STEP_REPEAT}
            veiled={hidden || under(plan.kitButtons - YAW_TURNS.length + YAW_TURNS.findIndex((y) => y.dir === dir))}
            tourTarget={tourTarget}
            onPress={() => run('camera.turn', { direction })}
          >
            <GlyphIcon glyph={GLYPHS.rotate} size={RAIL.glyph} flip={flip} />
          </RailButton>
        )) : null}
    </motion.div>
  );
}
