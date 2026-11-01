/**
 * The bottom bar and the handover from one mode's bar to the next's: one presence keyed by the bar,
 * the editing toolbars sharing one key so their host morphs the controls they share. The wrappers
 * take no transform (each bar is fixed to the window) but stand at their bars' rung, since an opacity
 * under 1 makes a stacking context that would otherwise pass under the screen's vignette.
 */
import { useUiPreviewPose, type UiPreviewPose } from '../../design/preview';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ItemCategory } from '../../../config/catalog/categories';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { presence } from '../../design/motion';
import { useBeat, useTransition } from '../../design/motion/use-motion';
import { z } from '../../design/styles';
import { SurfaceBoundary } from '../../chrome/guards/SurfaceBoundary';
import { BarFailure } from '../bars/BarFailure';
import { EditToolbar } from '../bars/EditToolbar';
import { ObjectShelf } from '../bars/objects/ObjectShelf';
import { MultiSelectBar } from '../bars/selection/MultiSelectBar';
import { planetShelfItems } from '../bars/objects/object-shelf';
import { ScopeScreen } from '../bars/generate/ScopeScreen';
import { ObjectBrushBar } from '../bars/objects/ObjectBrushBar';
import type { ContentType } from '../../../state/editing/edit-mode';
import { GenerateShelf } from '../edition-surfaces';

/** What stands in the bar's place: the scope screen while a region is being selected, for the assistant
 *  or the generate shelf, or the object shelf's brush bar (EDIT-64). */
type Cover = 'scope' | 'brush';
const coverOf = (s: EditorStore): Cover | null =>
  s.selectingRegion ? 'scope' : s.objectBrushBar && s.editMode.mode === 'object' ? 'brush' : null;
const posedCover = (pose: UiPreviewPose, mode: BuildMode): Cover | null =>
  pose.regionScreen ? 'scope' : pose.objectBrush && mode === 'object' ? 'brush' : null;
const covering = (): boolean => coverOf(useEditorStore.getState()) !== null;
const finishScope = () => useEditorStore.getState().setSelectingRegion(false);
const finishBrush = () => useEditorStore.getState().setObjectBrushBar(false);
const coverScreen = (cover: Cover) => (cover === 'brush' ? <ObjectBrushBar onDone={finishBrush} /> : <ScopeScreen onDone={finishScope} />);
/** A bar that throws stands its slot's band in its place; choosing another mode or toolbar mounts that one fresh. */
const barFailure = (retry: () => void) => <BarFailure onRetry={retry} />;

/**
 * A region selection, or the object shelf's brush bar, replaces the bar: the bar fades out before the
 * screen enters, and the screen leaves before the bar returns, the bar staying mounted and inert in
 * between, so the bar that opened the screen keeps its claim on what it offers and the shelf its tab.
 * Reduced motion swaps before paint.
 */
export function ModeBar({ mode, surface }: { mode: BuildMode; surface: ContentType | null }) {
  const pose = useUiPreviewPose();
  const liveCover = useEditorStore(coverOf);
  // A picture stands the region screen or the brush bar where its pose says and never the live editor's cover.
  const cover: Cover | null = pose ? posedCover(pose, mode) : liveCover;
  const covered = cover !== null;
  // The screen leaving keeps its face until its exit ends.
  const shownCover = useRef<Cover>(cover ?? 'scope');
  if (cover) shownCover.current = cover;
  const leaving = useBeat('mode.switch', 'bar.leaving');
  const arriving = useBeat('mode.switch', 'bar.arriving');
  // A bar arriving with no travel must not paint a frame at its starting value.
  const reduced = useReducedMotionConfig();
  // Touch multi-select stands in whatever bar the mode shows until Done.
  const multi = useEditorStore((s) => s.multiSelectLatched);
  // Multi-select unmounts the object shelf without leaving the mode, so Done gives it back on the same tab.
  const shelfTab = useRef<ItemCategory | null>(null);
  useEffect(() => { if (mode !== 'object') shelfTab.current = null; }, [mode]);
  const toolbar = multi ? null : surface ?? (mode === 'annotate' ? 'notes' : null);
  // A picture of the region screen stands nothing under it: the live bar there is hidden and only holds its claim.
  const bar = pose?.regionScreen ? null
    : multi ? <MultiSelectBar />
    : toolbar ? <EditToolbar bar={toolbar} />
    : mode === 'object' ? <ObjectShelf source={planetShelfItems} leftTab={shelfTab} />
      : mode === 'generate' ? <GenerateShelf /> : null;
  const scopeLeave = useTransition('mode.bar.leave');
  const scopeEnter = useTransition('mode.bar.enter');
  const [scopeReady, setScopeReady] = useState(covered);
  const hidden = covered || (!reduced && scopeReady);
  const hasBar = bar !== null;
  const barKey = multi ? 'multi-select' : toolbar ? 'toolbar' : mode;
  const surfaceKey = multi ? 'multi-select' : toolbar ?? mode;

  useLayoutEffect(() => {
    if (reduced) setScopeReady(covered);
    else if (!hasBar && covered) setScopeReady(true);
  }, [covered, reduced, hasBar]);

  return (
    <>
      <motion.div
        data-testid="shell-mode-bar"
        aria-hidden={hidden || undefined}
        {...(hidden ? { inert: '' } : {})}
        initial={false}
        animate={hidden ? 'hidden' : 'visible'}
        variants={{
          hidden: { opacity: 0, transition: scopeLeave, transitionEnd: { visibility: 'hidden' } },
          visible: { opacity: 1, visibility: 'visible', transition: scopeEnter },
        }}
        onAnimationComplete={(definition) => { if (definition === 'hidden' && covering()) setScopeReady(true); }}
        style={{ position: 'relative', zIndex: z.panel, display: reduced && covered ? 'none' : undefined }}
      >
        {/* Nothing beside the bar moves by layout projection, so its presence re-renders nothing around it. */}
        <AnimatePresence presenceAffectsLayout={false}>
          {bar ? (
            <motion.div
              key={barKey}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1, transition: arriving }}
              exit={{ opacity: 0, transition: leaving }}
              style={{ position: 'relative', zIndex: z.panel }}
            >
              <SurfaceBoundary name={`${surfaceKey} bar`} resetKey={surfaceKey} fallback={barFailure}>{bar}</SurfaceBoundary>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
      {reduced ? (
        cover && coverScreen(cover)
      ) : (
        <AnimatePresence onExitComplete={() => { if (!covering()) setScopeReady(false); }}>
          {covered && scopeReady && (
            <motion.div key={shownCover.current} {...presence('mode.bar.enter', { opacity: 0 }, { leave: 'mode.bar.leave' })} style={{ position: 'relative', zIndex: z.panel }}>
              {coverScreen(shownCover.current)}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
}
