/** The rail's view kit: the 2D/3D switch, the hide toggle, fit, zoom and the turns. */
import { group, useRailReflow, RailButton } from './RailButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { AnimatePresence, motion } from 'framer-motion';
import { helpTargetAttr } from '../../session/help-targets';
import { hasWebGL2 } from '../../../platform/device/device-quality';
import { useT } from '../../../i18n/context';
import { host } from '../../../editor/host/host';
import { useEditorStore } from '../../../state/store';
import { FitIcon as FitGlyph } from '../../primitives/line-glyphs';
import { useUiZooming } from '../../design/ui-zoom-anim';
import {
  apparentSize, FIT_BOX, FIT_INK, FIT_TRIM, GLYPHS, KIT_BUTTONS, viewKitCell,
  type RailPlan,
} from '../frame';
import { GlyphIcon } from '../GlyphIcon';
import { MOTIONS } from '../../design/motion/registry';
import { useTransition } from '../../design/motion/use-motion';
import { cssMotion } from '../../design/motion';
import { INK } from '../../design/tokens';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { RAIL } from '../units';
import { useRunCommand } from '../use-shell-commands';

/** Size the fit-to-view icon by its visible ink rather than its source box. */
function FitIcon() {
  const box = FIT_BOX * FIT_TRIM * (RAIL.glyph / apparentSize(FIT_INK));
  return <span style={{ display: 'flex', width: box, height: box, flex: 'none' }}><FitGlyph size={box} /></span>;
}
/** How far the camera turns per press of a yaw button, in the units `camera.orbit` takes (screen px
 *  of drag), which is the only turn verb both views answer to. */
const YAW_STEP = 60;
/** Ms between repeats while a stepper is held: zoom and the turns repeat, the toggles and fit do not. */
const STEP_REPEAT = 90;
/** The two turns, named from the visitor's side: `dir: 1` is a drag to the right, carrying the planet that way. */
const YAW_TURNS = [
  { dir: -1, flip: true, labelKey: 'a11y.rotate_left' },
  { dir: 1, flip: false, labelKey: 'a11y.rotate_right' },
] as const;
/** The planet session's kit: fit, zoom in and zoom out, standing where the view switch and the hide
 *  toggle (`SESSION_VEILED`, the kit's first two cells) stood. */
const SESSION_KIT = 3;
const SESSION_VEILED = 2;
/** How far under its own size a yaw button starts and ends. The registry's amplitude is how far it
 *  travels, and this shape is that travel spent on a scale. */
const YAW_FROM = 1 - MOTIONS['rail.yaw.offer'].amplitude;
/** A yaw button coming and going, on one motion in both directions: it is one fact either way. The
 *  transition rides each target rather than the element, so the press feedback keeps its own. */
const yawArrival = (offer: Record<string, unknown>) => ({
  initial: { opacity: 0, scale: YAW_FROM },
  animate: { opacity: 1, scale: 1, transition: offer },
  exit: { opacity: 0, scale: YAW_FROM, transition: offer },
});
/**
 * The view kit: the 2D/3D switch, the hide toggle, fit, zoom and the turns. The hide toggle is the one
 * button left standing when the interface is away, dimmed until reached for, so the way back is the
 * press that was the way out.
 */
export function ViewKit({ plan, right, hidden, onHide, session }: { plan: RailPlan; right: number; hidden: boolean; onHide: () => void; session: boolean }) {
  const t = useT();
  const zooming = useUiZooming();
  const weightAt = useFrameReadableWeight();
  const offer = useTransition('rail.yaw.offer');
  const viewMode = useEditorStore((s) => s.viewMode);
  const run = useRunCommand();
  const webgl2 = hasWebGL2();
  // The fill direction follows the buttons on screen, not the planned complement; a planet session keeps
  // only the camera steps.
  const shown = session ? SESSION_KIT : KIT_BUTTONS - (viewMode === '3d' ? 0 : YAW_TURNS.length);
  const cell = (i: number) => viewKitCell(session ? Math.max(0, i - SESSION_VEILED) : i, shown, plan.kitFiles);
  const offset = useRailReflow(0, plan.kitTop, String(plan.kitFiles), zooming);
  return (
    <motion.div
      data-testid="shell-view-kit"
      {...helpTargetAttr('camera')}
      {...mapEdgeAttr('right')}
      style={{
        ...group,
        ...offset,
        top: plan.kitTop, right,
        transition: zooming ? undefined : cssMotion('frame.layout.adapt', ['top', 'right']),
        // Explicit cells keep exiting yaw buttons from reflowing the remaining controls.
        display: 'grid',
        gridTemplateColumns: `repeat(${plan.kitFiles}, ${RAIL.button}px)`,
      }}
    >
      {/* The drawing marks the 3D view by filling this plate yellow, so the toggle is one button in
          two states rather than a pair of switches. */}
      <RailButton
        label={t('a11y.toggle_view')}
        helpTarget="camera"
        on={viewMode === '3d'}
        files={plan.kitFiles}
        cell={cell(0)}
        grow="left"
        veiled={hidden || session}
        unavailable={!webgl2}
        tourTarget="view3d"
        onPress={() => run('view.toggle')}
      >
        <span style={{ fontSize: RAIL.viewLabel, fontWeight: weightAt(900, RAIL.viewLabel), color: INK }}>{viewMode.toUpperCase()}</span>
      </RailButton>
      <RailButton
        label={t(hidden ? 'a11y.show_ui' : 'a11y.hide_ui')}
        helpTarget="frame"
        files={plan.kitFiles}
        cell={cell(1)}
        grow="left"
        dim={hidden}
        veiled={session}
        onPress={onHide}
      >
        <GlyphIcon glyph={GLYPHS.hideUi} size={RAIL.glyph} />
      </RailButton>
      {/* The design source drew no fit-to-view glyph, so this is the app's own stroke icon. A text
          arrow would render as flat type on one platform and as colour emoji on the next. */}
      <RailButton
        label={t('a11y.fit_view')}
        files={plan.kitFiles}
        cell={cell(2)}
        grow="left"
        veiled={hidden}
        onPress={() => run('camera.fit')}
      >
        <FitIcon />
      </RailButton>
      <RailButton
        label={t('a11y.zoom_in')}
        files={plan.kitFiles}
        cell={cell(3)}
        grow="left"
        repeat={STEP_REPEAT}
        veiled={hidden}
        onPress={() => run('camera.zoom_in')}
      >
        <GlyphIcon glyph={GLYPHS.zoomIn} size={RAIL.glyph} />
      </RailButton>
      <RailButton
        label={t('a11y.zoom_out')}
        files={plan.kitFiles}
        cell={cell(4)}
        grow="left"
        repeat={STEP_REPEAT}
        veiled={hidden}
        onPress={() => run('camera.zoom_out')}
      >
        <GlyphIcon glyph={GLYPHS.zoomOut} size={RAIL.glyph} />
      </RailButton>
      {/*
        The turns arrive and leave in the kit's last row: the kit is planned for its full complement and every
        button holds an explicit cell, so a leaving turn moves nothing. Each is its own keyed child for
        `AnimatePresence`.
      */}
      <AnimatePresence initial={false}>
        {viewMode === '3d' && !session ? YAW_TURNS.map(({ dir, flip, labelKey }) => (
          <RailButton
            key={dir}
            label={t(labelKey)}
            arrival={yawArrival(offer)}
            files={plan.kitFiles}
            cell={cell(KIT_BUTTONS - YAW_TURNS.length + YAW_TURNS.findIndex((y) => y.dir === dir))}
            grow="left"
            repeat={STEP_REPEAT}
            veiled={hidden}
            onPress={() => host.camera.orbit(dir * YAW_STEP, 0)}
          >
            <GlyphIcon glyph={GLYPHS.rotate} size={RAIL.glyph} flip={flip} />
          </RailButton>
        )) : null}
      </AnimatePresence>
    </motion.div>
  );
}
