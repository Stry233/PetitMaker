/** The rail's undo and redo pair. */
import { veilTransition, group, useRailReflow, RailButton } from './RailButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { isAnnotating } from '../../../state/editing/edit-mode';
import { useUiZooming } from '../../design/ui-zoom-anim';
import {
  GLYPHS, HISTORY_BUTTONS, railCell, } from '../frame';
import { GlyphIcon } from '../GlyphIcon';
import { CSS_CURVES } from '../../design/motion/curves';
import { MOTIONS } from '../../design/motion/registry';
import { cssMotion } from '../../design/motion';
import { RAIL } from '../units';
import { useRunCommand } from '../use-shell-commands';
import { useHistoryState } from '../../session/use-history-state';

/** How the pair travels between its two places. */
const YIELD_MOTION = MOTIONS['rail.history.yield'];
const YIELD_TRANSITION = `top ${YIELD_MOTION.duration}s ${CSS_CURVES[YIELD_MOTION.curve]}`;
/** History follows continuous zoom directly; only discrete group reflows receive an offset tween. */
export function HistoryGroup({ top, right, files, placement, veiled }: { top: number; right: number; files: number; placement: string; veiled: boolean }) {
  const t = useT();
  const zooming = useUiZooming();
  const offset = useRailReflow(0, top, placement, zooming);
  const run = useRunCommand();
  // The lane the history commands step: the region's while one is painted, the notes' in Notes, else the map's.
  const lane = useEditorStore((s) => (s.selectingRegion
    ? { undo: s.regionUndoLane.length > 0, redo: s.regionRedoLane.length > 0 }
    : isAnnotating(s)
      ? { undo: s.annotationUndoLane.length > 0, redo: s.annotationRedoLane.length > 0 }
      : null));
  const { canUndo, canRedo } = useHistoryState();
  return (
    <motion.div
      data-testid="shell-rail-history"
      {...mapEdgeAttr('right')}
      style={{
        ...group,
        ...offset,
        top,
        right,
        // A grid, as the kit is, so the two fold into one row by the same property in the same
        // shape. At one file it is what the flex column was.
        display: 'grid',
        gridTemplateColumns: `repeat(${files}, ${RAIL.button}px)`,
        opacity: veiled ? 0 : 1,
        visibility: veiled ? 'hidden' : 'visible',
        // A plain CSS transition; `animations.css` collapses it under the reduced-motion attribute,
        // so the pair still arrives at the place the panel left it and simply does not travel there.
        // The veil is on the same declaration because an element has one `transition`, and a second
        // one written here would silently drop the travel this group is placed by.
        transition: [zooming ? '' : `${YIELD_TRANSITION}, ${cssMotion('frame.layout.adapt', ['right'])}`, veilTransition(veiled)].filter(Boolean).join(', '),
      }}
    >
      <RailButton
        label={t('a11y.undo')}
        helpTarget="undo"
        disabled={!(lane ? lane.undo : canUndo)}
        files={files}
        cell={railCell(0, HISTORY_BUTTONS, files)}
        grow="left"
        veiled={veiled}
        onPress={() => run('history.undo')}
      >
        <GlyphIcon glyph={GLYPHS.undo} size={RAIL.glyph} />
      </RailButton>
      <RailButton
        label={t('a11y.redo')}
        helpTarget="undo"
        disabled={!(lane ? lane.redo : canRedo)}
        files={files}
        cell={railCell(1, HISTORY_BUTTONS, files)}
        grow="left"
        veiled={veiled}
        onPress={() => run('history.redo')}
      >
        <GlyphIcon glyph={GLYPHS.undo} size={RAIL.glyph} flip />
      </RailButton>
    </motion.div>
  );
}
