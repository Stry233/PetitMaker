/**
 * The bottom bar and the handover from one mode's bar to the next's: one presence keyed by the bar,
 * the editing toolbars sharing one key so their host morphs the controls they share. The wrappers
 * take no transform (each bar is fixed to the window) but stand at their bars' rung, since an opacity
 * under 1 makes a stacking context that would otherwise pass under the screen's vignette.
 */
import { useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { useEditorStore } from '../../../state/store';
import { presence } from '../../design/motion';
import { useBeat, useTransition } from '../../design/motion/use-motion';
import { z } from '../../design/styles';
import { SurfaceBoundary } from '../../chrome/guards/SurfaceBoundary';
import { BarFailure } from '../bars/BarFailure';
import { EditToolbar } from '../bars/EditToolbar';
import { ObjectShelf } from '../bars/objects/ObjectShelf';
import { planetShelfItems } from '../bars/objects/object-shelf';
import { ScopeScreen } from '../bars/generate/ScopeScreen';
import type { ContentType } from '../../../state/editing/edit-mode';
import { GenerateShelf } from '../edition-surfaces';

const agentSelecting = (): boolean => {
  const state = useEditorStore.getState();
  return state.selectingRegion && state.regionSelectionOwner === 'agent';
};
const finishScope = () => useEditorStore.getState().setSelectingRegion(false);
/** A bar that throws stands its slot's band in its place; choosing another mode or toolbar mounts that one fresh. */
const barFailure = (retry: () => void) => <BarFailure onRetry={retry} />;

/**
 * The assistant's region selection replaces the bar: the bar fades out before the scope screen
 * enters, and the scope screen leaves before the bar returns, the bar staying mounted and inert in
 * between. Reduced motion swaps before paint.
 */
export function ModeBar({ mode, surface }: { mode: BuildMode; surface: ContentType | null }) {
  const covered = useEditorStore((s) => s.selectingRegion && s.regionSelectionOwner === 'agent');
  const leaving = useBeat('mode.switch', 'bar.leaving');
  const arriving = useBeat('mode.switch', 'bar.arriving');
  // A bar arriving with no travel must not paint a frame at its starting value.
  const reduced = useReducedMotionConfig();
  const toolbar = surface ?? (mode === 'annotate' ? 'notes' : null);
  const bar = toolbar ? <EditToolbar bar={toolbar} />
    : mode === 'object' ? <ObjectShelf source={planetShelfItems} />
      : mode === 'generate' ? <GenerateShelf /> : null;
  const scopeLeave = useTransition('mode.bar.leave');
  const scopeEnter = useTransition('mode.bar.enter');
  const [scopeReady, setScopeReady] = useState(covered);
  const hidden = covered || (!reduced && scopeReady);
  const hasBar = bar !== null;
  const barKey = toolbar ? 'toolbar' : mode;

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
        onAnimationComplete={(definition) => { if (definition === 'hidden' && agentSelecting()) setScopeReady(true); }}
        style={{ position: 'relative', zIndex: z.panel, display: reduced && covered ? 'none' : undefined }}
      >
        <AnimatePresence>
          {bar ? (
            <motion.div
              key={barKey}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1, transition: arriving }}
              exit={{ opacity: 0, transition: leaving }}
              style={{ position: 'relative', zIndex: z.panel }}
            >
              <SurfaceBoundary name={`${toolbar ?? mode} bar`} resetKey={toolbar ?? mode} fallback={barFailure}>{bar}</SurfaceBoundary>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
      {reduced ? (
        covered && <ScopeScreen onDone={finishScope} />
      ) : (
        <AnimatePresence onExitComplete={() => { if (!agentSelecting()) setScopeReady(false); }}>
          {covered && scopeReady && (
            <motion.div key="assistant-scope" {...presence('mode.bar.enter', { opacity: 0 }, { leave: 'mode.bar.leave' })} style={{ position: 'relative', zIndex: z.panel }}>
              <ScopeScreen onDone={finishScope} />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
}
