/**
 * The bottom bar and the handover from one mode's bar to the next's: one presence keyed by the bar,
 * the editing toolbars sharing one key so their host morphs the controls they share. The wrappers
 * take no transform (each bar is fixed to the window) but stand at their bars' rung, since an opacity
 * under 1 makes a stacking context that would otherwise pass under the screen's vignette.
 */
import { useUiPreviewPose, type UiPreviewPose } from '../../design/preview';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ItemCategory } from '../../../config/catalog/categories';
import { AnimatePresence, motion, usePresence, useReducedMotionConfig } from 'framer-motion';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { barInFront, type BarFront } from '../../../state/keymap/toolbar';
import { useEditorStore } from '../../../state/store';
import { arrangementFadeCss, fadeTimings } from '../../design/motion';
import { useBeat } from '../../design/motion/use-motion';
import { z } from '../../design/styles';
import { useEffectEvent } from '../../primitives/use-effect-event';
import { useAway } from '../../primitives/away';
import { SurfaceBoundary } from '../../chrome/guards/SurfaceBoundary';
import { BarFailure } from '../bars/BarFailure';
import { EditToolbar } from '../bars/EditToolbar';
import { ObjectShelf } from '../bars/objects/ObjectShelf';
import { MultiSelectBar } from '../bars/selection/MultiSelectBar';
import { planetShelfItems } from '../../../state/object-shelf-view';
import { ScopeScreen } from '../bars/generate/ScopeScreen';
import { ObjectBrushBar } from '../bars/objects/ObjectBrushBar';
import type { ContentType } from '../../../state/editing/edit-mode';
import { GenerateShelf } from '../edition-surfaces';
import { BlueprintShelf } from '../bars/blueprint/BlueprintShelf';
import { FrameStep } from '../bars/blueprint/FrameStep';
import { SaveDock } from '../bars/blueprint/SaveDock';
import { useRunCommand } from '../use-shell-commands';

/** What stands in the bar's place (`state/keymap/toolbar.ts:barInFront`). */
type Cover = BarFront;
const posedCover = (pose: UiPreviewPose, mode: BuildMode): Cover | null =>
  pose.regionScreen ? 'scope' : pose.blueprintSave && mode === 'blueprint' ? 'save' : pose.objectBrush && mode === 'object' ? 'brush' : null;
/** A bar that throws stands its slot's band in its place; choosing another mode or toolbar mounts that one fresh. */
const barFailure = (retry: () => void) => <BarFailure onRetry={retry} />;

/** The handover between the bar and a screen standing in its place. */
const COVER = 'mode.bar.cover';

/** The screen in the bar's place fades on Web Animations, which start on the first frame after the
 *  commit that mounts or ends it; a Framer fade starts at the press and loses its first frames to that
 *  commit. `wait` holds its arrival until the bar it covers has gone. */
function CoverFade({ wait, children }: { wait: boolean; children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const ref = useRef<HTMLDivElement>(null);
  const fade = useRef<Animation | null>(null);
  const play = useEffectEvent((shown: boolean) => {
    const el = ref.current;
    // Leaving reports done after the commit, once the presence has marked the screen as leaving.
    if (!el || typeof el.animate !== 'function') { if (!shown) void Promise.resolve().then(() => safeToRemove?.()); return; }
    // A turn back mid-fade starts from where the screen stands, a fresh fade from its resting state.
    const was = fade.current;
    const midway = was !== null && (was.playState === 'running' || was.pending);
    const from = midway ? Number(getComputedStyle(el).opacity) : shown ? 0 : 1;
    was?.cancel();
    const fades = fadeTimings(COVER);
    fade.current = shown
      ? el.animate([{ opacity: from }, { opacity: 1 }], { delay: wait ? fades.in.delay * 1000 : 0, duration: fades.in.duration * 1000, easing: fades.in.css, fill: 'backwards' })
      : el.animate([{ opacity: from }, { opacity: 0 }], { duration: fades.out.duration * 1000, easing: fades.out.css, fill: 'forwards' });
    if (!shown) fade.current.finished.then(() => safeToRemove?.(), () => {});
  });
  useLayoutEffect(() => { play(present); }, [present]);
  useEffect(() => () => { fade.current?.cancel(); fade.current = null; }, []);
  const away = useAway();
  return <div ref={ref} {...away} style={{ position: 'relative', zIndex: z.panel }}>{children}</div>;
}

/** One bar in the handover, away from its first exit frame while it fades where it stood. */
function BarFade({ reduced, arriving, leaving, children }: {
  reduced: boolean | null; arriving: Record<string, unknown>; leaving: Record<string, unknown>; children: ReactNode;
}) {
  const away = useAway();
  return (
    <motion.div
      {...away}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: arriving }}
      exit={{ opacity: 0, transition: leaving }}
      style={{ position: 'relative', zIndex: z.panel }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A region selection, Blueprint's frame or save step, or the object shelf's brush bar replaces the bar
 * on one clock (`mode.bar.cover`): what leaves fades where it stands early and what arrives fades in
 * late, so the two never stand together, and leaving the screen plays the same in reverse. The bar
 * stays mounted and inert under the screen, so it keeps its claim on what it offers and the shelf its
 * tab, and upright the band glides between the two panels' heights meanwhile. Both fades start on the
 * frame after the commit (a CSS transition and `CoverFade`). Reduced motion swaps before paint.
 */
export function ModeBar({ mode, surface }: { mode: BuildMode; surface: ContentType | null }) {
  const pose = useUiPreviewPose();
  const run = useRunCommand();
  // Each Done presses its command's off, whose body stands beside the state's back-out row (`editor/back/back-out.ts`).
  const coverScreen = (cover: Cover) => (cover === 'brush' ? <ObjectBrushBar onDone={() => run('objects.brush_bar', { on: false })} />
    : cover === 'frame' ? <FrameStep /> : cover === 'save' ? <SaveDock /> : <ScopeScreen onDone={() => run('region.paint', { on: false })} />);
  const liveCover = useEditorStore(barInFront);
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
  // A picture of the region screen or the save step stands nothing under it: the live bar there is hidden and only holds its claim.
  const bar = pose?.regionScreen || pose?.blueprintSave ? null
    : multi ? <MultiSelectBar />
    : toolbar ? <EditToolbar bar={toolbar} />
    : mode === 'object' ? <ObjectShelf source={planetShelfItems} leftTab={shelfTab} />
      : mode === 'generate' ? <GenerateShelf />
        : mode === 'blueprint' ? <BlueprintShelf /> : null;
  const hasBar = bar !== null;
  const barKey = multi ? 'multi-select' : toolbar ? 'toolbar' : mode;
  const surfaceKey = multi ? 'multi-select' : toolbar ?? mode;
  const coveredAway = useAway(covered);

  return (
    <>
      <div
        data-testid="shell-mode-bar"
        {...coveredAway}
        style={{
          position: 'relative', zIndex: z.panel, display: reduced && covered ? 'none' : undefined,
          opacity: covered ? 0 : 1, visibility: covered ? 'hidden' : undefined,
          transition: arrangementFadeCss(COVER, !covered, ['opacity', 'visibility'], reduced),
        }}
      >
        {/* Nothing beside the bar moves by layout projection, so its presence re-renders nothing around it. */}
        <AnimatePresence presenceAffectsLayout={false}>
          {bar ? (
            <BarFade key={barKey} reduced={reduced} arriving={arriving} leaving={leaving}>
              <SurfaceBoundary name={`${surfaceKey} bar`} resetKey={surfaceKey} fallback={barFailure}>{bar}</SurfaceBoundary>
            </BarFade>
          ) : null}
        </AnimatePresence>
      </div>
      {reduced ? (
        cover && coverScreen(cover)
      ) : (
        <AnimatePresence>
          {covered && (
            // A screen arriving where no bar stands has nothing to wait out.
            <CoverFade key={shownCover.current} wait={hasBar}>{coverScreen(shownCover.current)}</CoverFade>
          )}
        </AnimatePresence>
      )}
    </>
  );
}
