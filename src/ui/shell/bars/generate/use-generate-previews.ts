import { useEditorStore } from '../../../../state/store';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GridState, MacroCoord } from '../../../../core/model/types';
import type { StencilPlan } from '../../../../tools/generation/recipe';
import type { PlanInputs } from '../../../../tools/generation/stencil';
import type { Candidate } from '../../../../editor/operations';
import { previewBatch, previewOwn, shotFrameFor, type BatchSettings, type Shot, type StencilInputs } from '../../../../editor/editing/generate-batch';
import { CANDIDATES, batchSeeds, isStencilKind } from '../../../../tools/generation/facts';
import { CARD } from './generate-shelf';
import type { StencilSample } from './stencil-samples';
import { useEffectEvent } from '../../../primitives/use-effect-event';

const CUSTOM = CANDIDATES;
/** Thumbnail long edge in device pixels; aspect follows the card's picture slot. */
const SHOT_SIZE = { px: 640, aspect: CARD.pic.w / CARD.pic.h };

interface PreviewOptions {
  gridState: GridState | null;
  region: MacroCoord[];
  selectingRegion: boolean;
  settings: BatchSettings;
  base: number;
  customSeed: number | null;
  hand: StencilSample[];
  ownSample: StencilSample | null;
  fontsReady: boolean;
  ownFontsReady: boolean;
  planInputs: PlanInputs | null;
  wordFits: StencilInputs['wordFits'];
  fits: boolean;
  recipeKey: string;
  forgetApplied: () => void;
  clearFailed: () => void;
}

/** Holds the batch's and the own card's pictures for the shelf; `editor/editing/generate-batch.ts`
 *  builds, restores and cancels them. */
export function useGeneratePreviews({
  gridState, region, selectingRegion, settings, base, customSeed, hand, ownSample,
  fontsReady, ownFontsReady, planInputs, wordFits, fits, recipeKey, forgetApplied, clearFailed,
}: PreviewOptions) {
  const ignoreLoad = useEditorStore((s) => !!s.gridState?.ignoreChunkLoad);
  const [shots, setShots] = useState<Shot[]>(() => Array(CANDIDATES).fill(undefined));
  const [customShot, setCustomShot] = useState<Shot>(null);
  const [customPending, setCustomPending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // Command-heavy candidates stay outside React state; pictures are the rendered state.
  const candidatesRef = useRef<(Candidate | null)[]>(Array(CANDIDATES).fill(null));
  const customRef = useRef<Candidate | null>(null);
  const plansRef = useRef<(StencilPlan | null)[]>(Array(CANDIDATES + 1).fill(null));
  const stencil = isStencilKind(settings.kind);
  const scope = region.length > 0 ? region : null;
  const seeds = batchSeeds(base);
  const previewKey = `${recipeKey}|${base}|${ignoreLoad}`;
  const ownKey = ownSample ? ownSample.text ?? ownSample.src ?? null : null;
  const shotFrame = useMemo(() => shotFrameFor(region, gridState, SHOT_SIZE.aspect), [region, gridState]);

  // The batch reruns when its preview key names a new recipe; the closures read the rest as it starts.
  const runBatch = useEffectEvent(() => previewBatch({
    stencil, fits, ready: !!gridState && !selectingRegion, fontsReady, hand, seeds, base, settings, scope, planInputs, wordFits,
    shotFrame, shotSize: SHOT_SIZE, plans: plansRef, candidates: candidatesRef, setShots, setPreviewing, forgetApplied, clearFailed,
  }));
  useEffect(() => runBatch(), [previewKey, gridState, region, selectingRegion, fontsReady, forgetApplied, clearFailed]);

  // The visitor's own card, on the recipe without the batch's base: a new batch leaves it standing.
  // Keyed on `ownKey`, so typing elsewhere keeps the picture.
  const runOwn = useEffectEvent(() => previewOwn({
    stencil, fits, ready: !!gridState && !selectingRegion, ownFontsReady, ownSample, customSeed, base, settings, scope, planInputs, wordFits,
    shotFrame, shotSize: SHOT_SIZE, plans: plansRef, own: customRef, setCustomShot, setCustomPending,
  }));
  useEffect(() => runOwn(), [recipeKey, ignoreLoad, customSeed, ownKey, gridState, region, selectingRegion, ownFontsReady]);

  return {
    shots, customShot, customPending, previewing, previewKey,
    candidateAt: (i: number): Candidate | null => i === CUSTOM ? customRef.current : candidatesRef.current[i] ?? null,
    planAt: (i: number): StencilPlan | null => plansRef.current[i] ?? null,
  };
}
