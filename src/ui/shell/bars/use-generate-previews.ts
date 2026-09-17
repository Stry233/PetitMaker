import { useEffect, useMemo, useRef, useState } from 'react';
import { focusFrame, renderThumbnail } from '../../../canvas/thumbnail';
import type { GridState, MacroCoord, StencilPlan } from '../../../core/model/types';
import { currentKit } from '../../../kit/context';
import { generateCandidate, peekCandidate, type Candidate } from '../../../kit/operations';
import type { GenSignal } from '../../../kit/operations/generate';
import { CANDIDATES, CARD, batchSeeds, isStencilKind, shelfConfig, type ShelfSettings } from './generate-shelf';
import { buildStencilPlan, peekStencilPlan, type PlanInputs } from './stencil-plan';
import { regionBox } from './stencil-raster';
import type { StencilSample } from './stencil-samples';

const CUSTOM = CANDIDATES;
/** Wait for settings to settle before generating another batch, in milliseconds. */
const SETTLE_MS = 350;
/** Thumbnail long edge in device pixels; aspect follows the card's picture slot. */
const SHOT_PX = 640;
const SHOT_ASPECT = CARD.pic.w / CARD.pic.h;

interface PreviewOptions {
  gridState: GridState | null;
  region: MacroCoord[];
  selectingRegion: boolean;
  settings: Omit<ShelfSettings, 'seed'>;
  base: number;
  customSeed: number | null;
  hand: StencilSample[];
  ownSample: StencilSample | null;
  fontsReady: boolean;
  ownFontsReady: boolean;
  planInputs: PlanInputs | null;
  wordFits: (sample: StencilSample | null) => boolean;
  fits: boolean;
  recipeKey: string;
  forgetApplied: () => void;
  clearFailed: () => void;
}

/** Owns detached previews, cache restoration and cancellation for the batch and custom card. */
export function useGeneratePreviews({
  gridState, region, selectingRegion, settings, base, customSeed, hand, ownSample,
  fontsReady, ownFontsReady, planInputs, wordFits, fits, recipeKey, forgetApplied, clearFailed,
}: PreviewOptions) {
  const [shots, setShots] = useState<(string | null | undefined)[]>(() => Array(CANDIDATES).fill(undefined));
  const [customShot, setCustomShot] = useState<string | null | undefined>(null);
  const [customPending, setCustomPending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // Command-heavy candidates stay outside React state; pictures are the rendered state.
  const candidatesRef = useRef<(Candidate | null)[]>(Array(CANDIDATES).fill(null));
  const customRef = useRef<Candidate | null>(null);
  const plansRef = useRef<(StencilPlan | null)[]>(Array(CANDIDATES + 1).fill(null));
  const stencil = isStencilKind(settings.kind);
  const scope = region.length > 0 ? region : null;
  const seeds = batchSeeds(base);
  const previewKey = `${recipeKey}|${base}`;
  const ownKey = ownSample ? ownSample.text ?? ownSample.src ?? null : null;
  const shotFrame = useMemo(
    () => focusFrame(regionBox(region), gridState?.template ?? null, SHOT_ASPECT),
    [region, gridState],
  );

  useEffect(() => {
    // Nothing is worth photographing while the region is being painted: the next stroke would make
    // every picture a promise the click cannot keep, and the cards are not on screen anyway.
    // A picture kind with no region to work in has nothing to photograph — and the cards must go
    // BLANK rather than keep the last kind's pictures, which leaves another generator's land
    // standing under the letters.
    if (stencil && !fits) {
      setShots(Array(CANDIDATES).fill(null));
      candidatesRef.current = Array(CANDIDATES).fill(null);
      // AND THE PLANS WITH THEM. A candidate is dropped here but a plan is the RECIPE, and one left
      // standing is a card with no picture that still builds — the region shrank under it and the
      // click laid the picture the last region was fitted for. A card that cannot show what it
      // would do must not be able to do it.
      plansRef.current = Array(CANDIDATES + 1).fill(null);
      return undefined;
    }
    if (!gridState || selectingRegion) return undefined;
    if (!fontsReady) {
      plansRef.current = [...Array(CANDIDATES).fill(null), plansRef.current[CUSTOM] ?? null];
      candidatesRef.current = Array(CANDIDATES).fill(null);
      setShots(Array(CANDIDATES).fill(undefined));
      setPreviewing(true);
      return () => { setPreviewing(false); };
    }
    let dropped = false;
    const signal: GenSignal = { cancelled: false };

    /*
     * A BATCH ALREADY ANSWERED STANDS BACK UP AT ONCE. Returning to a kind asks the exact question
     * the caches still hold — the ground, the recipe and the scope in the candidate cache's key,
     * and for the picture kinds the built plan in the plan cache's — so when every card of the
     * batch peeks, the cards must not blank, sit out the settle, rasterize a plan, or ask the pool
     * for maps it already has; only their pictures are re-read, from the thumbnail cache, which
     * answers on the same candidate grids. Everything here is a synchronous cache read: a single
     * miss falls through to the slow path with nothing spent.
     */
    const peekKit = currentKit();
    restore: if (peekKit && (!stencil || planInputs)) {
      const dealt = stencil ? hand : seeds;
      const plans: (StencilPlan | null)[] = Array(dealt.length).fill(null);
      if (stencil) {
        for (let i = 0; i < dealt.length; i++) {
          const entry = dealt[i] as StencilSample;
          if (!wordFits(entry)) continue;   // a refused card: no plan, a null picture, no candidate
          const plan = peekStencilPlan(entry, planInputs!);
          if (plan === undefined) break restore;
          plans[i] = plan;
        }
      }
      const peeked: (Candidate | null)[] = [];
      for (let i = 0; i < dealt.length; i++) {
        const seed = stencil ? base + i : (dealt[i] as number);
        if (stencil && !plans[i]) { peeked.push(null); continue; }
        const hit = peekCandidate(peekKit, {
          config: shelfConfig({ ...settings, seed, stencilPlan: plans[i] }), region: scope,
        });
        if (!hit) break restore;
        peeked.push(hit);
      }
      forgetApplied();
      clearFailed();
      candidatesRef.current = [...peeked];
      plansRef.current = [...plans, plansRef.current[CUSTOM] ?? null];
      // Cleared and repainted within one frame on the cache's answers; a card may never stand
      // another recipe's picture under this batch's numbers, however briefly.
      setShots(Array(CANDIDATES).fill(undefined));
      void Promise.all(peeked.map(async (candidate, i) => {
        const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, SHOT_ASPECT, shotFrame) : null;
        if (dropped) return;
        setShots((prev) => prev.map((s, j) => (j === i ? shot : s)));
      }));
      return () => {
        dropped = true;
        candidatesRef.current = Array(CANDIDATES).fill(null);
      };
    }

    /*
     * THE CARDS GO BLANK NOW, NOT WHEN THE RUN STARTS. The seeds change with the recipe, and the
     * pass that photographs them waits `SETTLE_MS` for the settings to stop moving — so a batch
     * cleared inside `run` would leave the OLD batch's pictures standing under the NEW batch's
     * numbers for a third of a second, a card saying it is a recipe it is not a picture of. Pending is
     * the honest state, and it is the one the card already knows how to draw.
     */
    setShots(Array(CANDIDATES).fill(undefined));

    const run = async (): Promise<void> => {
      const kit = currentKit();
      if (!kit) return;
      // What stands was built from the settings that have just changed, so it no longer answers to
      // the batch about to be photographed, and the shelf lets go of it. It STAYS on the map:
      // moving a slider is asking another question, not retracting the answer already given, and a
      // click on a card was that answer. Neither does a card's report of its own failure survive:
      // these are about to be other recipes.
      forgetApplied();
      clearFailed();
      setPreviewing(true);
      // The whole batch is asked for at once: the worker pool builds two or three concurrently and
      // each card's picture lands the moment its own run is back, not behind five others. The
      // thumbnail queue (canvas/thumbnail) serializes the captures themselves.
      // A picture kind's cards are the hand it was dealt, not five seeds: the plan IS the recipe, so
      // the seed rides along unused and every card is exactly what it shows.
      const dealt = stencil ? hand : seeds;
      await Promise.all(dealt.map(async (entry, i) => {
        const seed = stencil ? base + i : (entry as number);
        const plan = stencil && planInputs && wordFits(entry as StencilSample)
          ? await buildStencilPlan(entry as StencilSample, planInputs)
          : null;
        if (dropped) return;
        // The card is refused, or its picture would not build. Its PLAN goes with its photograph, or
        // the one the last region left behind stays live and a click builds a letter fitted to a
        // region that is no longer painted.
        if (stencil && !plan) {
          plansRef.current[i] = null;
          setShots((prev) => prev.map((sh, j) => (j === i ? null : sh)));
          return;
        }
        plansRef.current[i] = plan;
        const candidate = await generateCandidate(kit, {
          config: shelfConfig({ ...settings, seed, stencilPlan: plan }),
          region: scope,
          signal,
        });
        if (dropped) return;
        candidatesRef.current[i] = candidate;
        // The picture waits on the map's own icons being decoded, so it is taken asynchronously and
        // the batch may have been dropped by the time it is back.
        const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, SHOT_ASPECT, shotFrame) : null;
        if (dropped) return;
        setShots((prev) => prev.map((s, j) => (j === i ? shot : s)));
      }));
      if (!dropped) setPreviewing(false);
    };

    const timer = setTimeout(() => { void run(); }, SETTLE_MS);
    return () => {
      dropped = true;
      signal.cancelled = true;
      clearTimeout(timer);
      // The settings these were built under are the ones just left behind, so a click in the gap
      // before the next batch arrives generates for real rather than landing an answer to a
      // question the user has stopped asking.
      candidatesRef.current = Array(CANDIDATES).fill(null);
    };
  }, [previewKey, gridState, region, selectingRegion, fontsReady, forgetApplied, clearFailed]);

  /*
   * The visitor's own card, on the recipe WITHOUT the batch's base: a new batch draws five other
   * recipes and leaves this one exactly where it was, so it is only re-photographed when a setting
   * moves it — the same rule as the others, minus the one term it does not share.
   */
  useEffect(() => {
    // A picture kind's own card is driven by what was typed or imported rather than by a number.
    if (!gridState || selectingRegion || (stencil && !fits) || (stencil ? !ownSample : customSeed === null)) {
      customRef.current = null;
      setCustomShot(null);
      setCustomPending(false);
      return undefined;
    }
    if (!ownFontsReady) {
      plansRef.current[CUSTOM] = null;
      customRef.current = null;
      setCustomShot(undefined);
      setCustomPending(true);
      return undefined;
    }
    let dropped = false;
    const signal: GenSignal = { cancelled: false };
    setCustomShot(undefined);

    // The batch cards' own fast path (above), for the visitor's card: a recipe already answered
    // on this ground comes back without the settle, a raster, or a pending face.
    const peekKit = currentKit();
    if (peekKit) {
      const plan = stencil && ownSample && planInputs && wordFits(ownSample)
        ? peekStencilPlan(ownSample, planInputs)
        : null;
      if (stencil && plan === null) {
        // The cached answer IS the refusal (a word that will not fit, a picture that would not
        // read): the card comes back blank exactly as the slow path leaves it.
        plansRef.current[CUSTOM] = null;
        customRef.current = null;
        setCustomShot(null);
        setCustomPending(false);
        return () => { dropped = true; customRef.current = null; };
      }
      if (plan !== undefined) {
        const hit = peekCandidate(peekKit, {
          config: shelfConfig({ ...settings, seed: customSeed ?? base, ...(plan ? { stencilPlan: plan } : {}) }),
          region: scope,
        });
        if (hit) {
          plansRef.current[CUSTOM] = plan;
          customRef.current = hit;
          setCustomPending(false);
          void renderThumbnail(hit.state, SHOT_PX, SHOT_ASPECT, shotFrame).then((shot) => {
            if (!dropped) setCustomShot(shot);
          });
          return () => {
            dropped = true;
            customRef.current = null;
          };
        }
      }
    }

    const run = async (): Promise<void> => {
      const kit = currentKit();
      if (!kit) return;
      setCustomPending(true);
      const plan = stencil && ownSample && planInputs && wordFits(ownSample)
        ? await buildStencilPlan(ownSample, planInputs)
        : null;
      if (dropped) return;
      if (stencil && !plan) { plansRef.current[CUSTOM] = null; setCustomShot(null); setCustomPending(false); return; }
      plansRef.current[CUSTOM] = plan;
      const candidate = await generateCandidate(kit, {
        config: shelfConfig({ ...settings, seed: customSeed ?? base, stencilPlan: plan }),
        region: scope,
        signal,
      });
      if (dropped) return;
      customRef.current = candidate;
      const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, SHOT_ASPECT, shotFrame) : null;
      if (dropped) return;
      setCustomShot(shot);
      setCustomPending(false);
    };

    const timer = setTimeout(() => { void run(); }, SETTLE_MS);
    return () => {
      dropped = true;
      signal.cancelled = true;
      clearTimeout(timer);
      customRef.current = null;
    };
    // `ownKey` and not `ownSample`: the sample is rebuilt each render, and an object identity in the
    // deps would re-photograph the card on every keystroke anywhere in the shelf.
  }, [recipeKey, customSeed, ownKey, gridState, region, selectingRegion, ownFontsReady]);

  return {
    shots, customShot, customPending, previewing, previewKey,
    candidateAt: (i: number): Candidate | null => i === CUSTOM ? customRef.current : candidatesRef.current[i] ?? null,
    planAt: (i: number): StencilPlan | null => plansRef.current[i] ?? null,
  };
}
