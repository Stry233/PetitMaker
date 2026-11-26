/** The generate shelf's view of its batch (`editor/editing/generate-batch.ts:createGenerateBatch`):
 *  the batch reads its recipe, map and region itself; this tells it what only the page knows (the
 *  letter faces that arrived, the own text's check) and starts a pass when what it reads changes. */
import { useEditorStore } from '../../../../state/store';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { EditContext } from '../../../../core/commands/edit-context';
import { createGenerateBatch } from '../../../../editor/editing/generate-batch';
import type { GenerateRecipeController } from '../../../../editor/editing/generate-recipe';
import { regionOf } from '../../../../state/editing/region';
import { CARD } from './generate-shelf';
import type { MazeEndsState } from './use-maze-ends';
import { useStencilFonts } from './use-stencil-fonts';

/** Thumbnail long edge in device pixels; aspect follows the card's picture slot. */
const SHOT_SIZE = { px: 640, aspect: CARD.pic.w / CARD.pic.h };
/** How long a card says it did not build, in ms: read where the eye is, gone before the next click. */
const FAILED_MS = 4000;

interface BatchOptions {
  /** The recipe the batch deals from; the caller's own view of it re-renders this hook. */
  recipe: GenerateRecipeController;
  /** The maze's ends, where the shelf offers them; the caller's view of them re-renders this hook. */
  ends?: MazeEndsState['session'];
  /** Whether the own card's typed text passed its check. */
  ownAllowed?: boolean;
  /** The map the cards build against where it is not the live editor's (a Help figure's sandbox). */
  kit?: EditContext;
}

export function useGenerateBatch({ recipe, ends, ownAllowed = true, kit }: BatchOptions) {
  const [batch] = useState(() => createGenerateBatch({
    shotSize: SHOT_SIZE, failedMs: FAILED_MS, recipe, ...(ends ? { ends } : {}), ...(kit ? { kit } : {}),
  }));
  const view = useSyncExternalStore(batch.subscribe, batch.get);
  const appliedIndex = useEditorStore((s) => (kit ? null : s.generateApplied?.card ?? null));
  useEffect(() => {
    const takeDown = batch.show();
    return () => { takeDown(); batch.dispose(); };
  }, [batch]);

  // What the batch reads off the store re-renders the shelf, so `read()` is this render's; a batch
  // on a map handed in reads none of it.
  const gridState = useEditorStore((s) => (kit ? null : s.gridState));
  const region = useEditorStore((s) => (kit ? null : regionOf(s, 'generator')));
  const selectingRegion = useEditorStore((s) => !kit && s.selectingRegion);
  const ignoreLoad = useEditorStore((s) => !kit && !!s.gridState?.ignoreChunkLoad);
  const now = batch.read();

  const fontsReady = useStencilFonts(now.input === 'text' ? now.hand.map((sample) => sample.text ?? '').join(' ') : null);
  const ownText = now.input === 'text' ? now.ownSample?.text ?? null : null;
  const ownFontsReady = useStencilFonts(ownText);
  // Before the passes below start, and before the next press.
  useLayoutEffect(() => batch.publish({ fontsReady, ownFontsReady, ownAllowed }), [batch, fontsReady, ownFontsReady, ownAllowed]);

  const previewKey = `${now.key}|${now.base}|${ignoreLoad}`;
  const ownKey = ownAllowed && now.ownSample ? now.ownSample.text ?? now.ownSample.src ?? null : null;

  // The batch reruns when its preview key names a new recipe; the pass reads the rest as it starts.
  useEffect(() => batch.previewBatch(), [batch, previewKey, gridState, region, selectingRegion, fontsReady]);

  // The visitor's own card, on the recipe without the batch's base: a new batch leaves it standing.
  // Keyed on `ownKey`, so typing elsewhere keeps the picture.
  useEffect(
    () => batch.previewOwn(),
    [batch, now.key, ignoreLoad, now.customSeed, ownKey, gridState, region, selectingRegion, ownFontsReady],
  );

  return {
    ...view, appliedIndex, fontsReady, ownFontsReady,
    hand: now.hand, box: now.box, fits: now.fits, wordFits: now.wordFits,
    relandStanding: batch.relandStanding, ownChanged: batch.ownChanged,
  };
}
