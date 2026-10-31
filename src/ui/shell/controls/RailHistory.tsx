/** The rail's undo and redo pair. */
import type { Ref } from 'react';
import { veilTransition, group, useRailReflow, RailButton } from './RailButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { isAnnotating } from '../../../state/editing/edit-mode';
import { useScaleMoving } from '../../design/scale';
import {
  GLYPHS, HISTORY_BUTTONS, railCell, } from '../frame';
import { GlyphIcon } from '../GlyphIcon';
import { usePlanGlide } from '../frame-layout';
import { RAIL } from '../units';
import { useRunCommand } from '../use-shell-commands';
import { useHistoryState } from '../../session/use-history-state';
import { useMorphGroup } from '../../primitives/morph';

/** History follows continuous zoom directly; only discrete group reflows receive an offset tween. */
export function HistoryGroup({ boxRef, top, right, files, placement, veiled, drawnTop }: {
  boxRef?: Ref<HTMLDivElement>; top: number; right: number; files: number; placement: string; veiled: boolean;
  /** Where the live rail writer last drew the pair (`frame-layout.tsx:DrawnRail`). */
  drawnTop?: () => number | null;
}) {
  const t = useT();
  const zooming = useScaleMoving();
  const glide = usePlanGlide('frame.layout.adapt');
  const yieldGlide = usePlanGlide('rail.history.yield');
  const offset = useRailReflow(0, top, placement, zooming, drawnTop);
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
      ref={boxRef}
      data-testid="shell-rail-history"
      {...useMorphGroup()}
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
        transition: [zooming ? '' : yieldGlide(['top']), zooming ? '' : glide(['right']), veilTransition(veiled)].filter(Boolean).join(', '),
      }}
    >
      <RailButton
        morph="undo"
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
        morph="redo"
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
