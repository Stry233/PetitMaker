/**
 * The generate shelf: candidate cards built on detached map copies, the kind's settings strip, and
 * the actions on a whole batch. A setting or scope change invalidates the batch; a matching card
 * replays its recorded run through the live executor as one undo step.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { setCursorBusy } from '../../../../view/interaction/cursor-controller';
import type { MacroCoord } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import { batchKey, cardRecipe, clearLastRun as clearRun, stencilInputs } from '../../../../editor/editing/generate-batch';
import { useEditorStore } from '../../../../state/store';
import { graphemes } from '../../../../core/base/text';
import { helpTargetAttr } from '../../../session/help-targets';
import { cssMotion } from '../../../design/motion';
import { MOTIONS } from '../../../design/motion/registry';
import { useTransition } from '../../../design/motion/use-motion';
import { ScaleProvider, usePx } from '../../../design/scale';
import { z } from '../../../design/styles';
import { PLATE_INK } from '../../../design/tokens';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { TrashIcon } from '../../../primitives/line-glyphs';
import { useScrollRow, scrollBleed } from '../../../primitives/use-scroll-row';
import { GLYPHS } from '../../frame';
import { useFrameLayout, useRailClearance } from '../../frame-layout';
import { GlyphIcon } from '../../GlyphIcon';
import { RAIL, SHELF_SCALE, SHELF_TABS, TEXT } from '../../units';
import { ShelfAction } from './generate-controls';
import { GenerateCards, CUSTOM } from './GenerateCards';
import { GenerateStrip } from './GenerateStrip';
import {
  BATCH, BODY_H, CANDIDATES, CARD, CARD_H, CHOSEN, GAP, PAD, PAIR_GAP, STENCIL_MIN_SIDE, STRIP, TABS,
  GENERATE_KIND, type GenerateKind,
} from './generate-shelf';
import { ItemPickScreen } from './ItemPickScreen';
import { MazeEndpoints } from './MazeEndpoints';
import { useFrameZoom } from '../../use-frame-zoom';
import { SCOPE_TOOLS_FOR } from './scope-cells';
import { ScopeScreen } from './ScopeScreen';
import { ShelfBand } from '../ShelfBand';
import { ShelfTabs, TAB_ROW } from '../ShelfTabs';
import { drawSamples, poolFor, type StencilSample } from './stencil-samples';
import { useCandidateLanding } from './use-candidate-landing';
import { useGeneratePreviews } from './use-generate-previews';
import { useGenerateRecipe, type GenerateRecipe } from './use-generate-recipe';
import { useMazeEnds } from './use-maze-ends';
import { useStencilFonts } from './use-stencil-fonts';
import { useStencilReview } from './use-stencil-review';

/** How far the block under the names travels as a kind arrives: the object shelf's own category swap. */
const SWAP_X = MOTIONS['shelf.category.swap'].amplitude ?? 0;

/** The cards and the tile at their end; it never wraps, so every card stays one of the row to compare. */
const ROW: CSSProperties = { display: 'flex', alignItems: 'stretch', justifyContent: 'center', flexWrap: 'nowrap' };

/** The shelf under its own scale; the body reads `usePx` for its own measurements, so the scale wraps it. */
export function GenerateShelf({ initialKind }: { initialKind?: GenerateKind } = {}) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <GenerateShelfBody {...(initialKind ? { initialKind } : {})} />
    </ScaleProvider>
  );
}

/** What a picture kind builds from: the painted box, its plan inputs, and why a card has no picture. */
function useStencilInputs(recipe: GenerateRecipe, region: MacroCoord[]) {
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  const { kind, stencil, base, fillKind, fillItem, contrast, ownText, ownImage, customDraft } = recipe;
  const { input } = GENERATE_KIND[kind];
  const { box, fits, planInputs, wordFits } = useMemo(
    () => stencilInputs(gridState, region, { kind, fill: fillKind, item: fillItem, contrast }),
    [gridState, region, kind, fillKind, fillItem, contrast],
  );
  /** The batch's hand, dealt from the kind's pool by the same base seed the terrain kinds draw from. */
  const hand = useMemo(() => (stencil ? drawSamples(poolFor(input), CANDIDATES, base) : []), [stencil, input, base]);
  const ownSample: StencilSample | null = input === 'text'
    ? (ownText ? { id: 'own', text: ownText } : null)
    : input === 'image' ? (ownImage ? { id: 'own', src: ownImage.src } : null) : null;
  const ownReview = useStencilReview(input === 'text', ownText, customDraft !== null);
  const ownAllowed = input !== 'text' || ownReview.allowed;
  const fontsReady = useStencilFonts(input === 'text' ? hand.map((sample) => sample.text ?? '').join(' ') : null);
  const ownFontsReady = useStencilFonts(input === 'text' && ownText ? ownText : null);
  const noteFor = (sample: StencilSample | null): string | null => {
    if (!stencil || !(sample?.id === 'own' ? ownFontsReady : fontsReady)) return null;
    if (!fits) {
      const side = STENCIL_MIN_SIDE[input!];
      return t('generate.region_too_small', { width: side, height: side });
    }
    if (wordFits(sample)) return null;
    return t(graphemes(sample!.text ?? '').length > 1 ? 'generate.text_too_wide' : 'generate.text_needs_room');
  };
  const ownNote = input === 'text' && !ownAllowed ? ownReview.note : noteFor(ownSample);
  return { box, fits, hand, ownSample, ownReview, ownAllowed, fontsReady, ownFontsReady, planInputs, wordFits, noteFor, ownNote };
}

/** `initialKind` opens the shelf at a named kind (a picture poses one); the live shelf opens at the first tab. */
function GenerateShelfBody({ initialKind }: { initialKind?: GenerateKind }) {
  const { px } = usePx();
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  const region = useEditorStore((s) => s.region);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const agentSelecting = useEditorStore((s) => s.regionSelectionOwner === 'agent');
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  /** `[]` is "no region painted", the whole planet, which a run takes as null. */
  const scope = region.length > 0 ? region : null;

  // The own card's recipe changing lets go of it if it is the card standing on the map.
  const forgetOwn = useRef(() => {});
  const recipe = useGenerateRecipe(initialKind, useCallback(() => forgetOwn.current(), []));
  const { kind, stencil, base, seeds, elevation, corridorWidth, fillKind, fillItem, contrast, customSeed } = recipe;
  const traits = GENERATE_KIND[kind];
  const maze = useMazeEnds(traits.gates, gridState, scope, corridorWidth);
  const landing = useCandidateLanding(maze.landed);
  const { forgetApplied: letGo, clearFailed, appliedIndex } = landing;
  const { cancelDrag } = maze;
  const forgetApplied = useCallback(() => { letGo(); cancelDrag(); }, [letGo, cancelDrag]);
  useLayoutEffect(() => { forgetOwn.current = () => { if (appliedIndex === CUSTOM) forgetApplied(); }; });
  const inputs = useStencilInputs(recipe, region);

  const settings = { kind, richness: recipe.richness, maxElevation: elevation, corridorWidth, gates: maze.gates };
  const recipeKey = batchKey({
    kind, richness: recipe.richness, maxElevation: elevation, corridorWidth, gates: maze.gates,
    stencil: stencil ? { fill: fillKind, item: fillItem, contrast, box: inputs.box } : null,
  });
  const previews = useGeneratePreviews({
    gridState, region, selectingRegion, settings, base, customSeed, hand: inputs.hand,
    ownSample: inputs.ownAllowed ? inputs.ownSample : null, fontsReady: inputs.fontsReady, ownFontsReady: inputs.ownFontsReady,
    planInputs: inputs.planInputs, wordFits: inputs.wordFits, fits: inputs.fits, recipeKey, forgetApplied, clearFailed,
  });
  const busy = previews.previewing || previews.customPending || landing.landingIndex !== null;
  // The map is unusable while the bar drives the generator, on the pointer as well as here.
  useEffect(() => { setCursorBusy(busy); return () => setCursorBusy(false); }, [busy]);

  /** Lands a card's run; `over` re-lands it with a maze end moved, as another maze at the same seed. */
  const applyCandidate = (index: number, over?: { gates: typeof maze.gates }) => {
    const card = cardRecipe({
      index, stencil, base, customSeed, seeds, plan: stencil ? previews.planAt(index) : null, fits: inputs.fits,
      pending: index === CUSTOM ? previews.customPending : previews.previewing && previews.shots[index] === undefined,
      ownAllowed: inputs.ownAllowed,
    });
    if (!card) return;
    cancelDrag();
    void landing.land(index, {
      settings, seed: card.seed, plan: card.plan, ...(over ? { over } : {}), candidate: previews.candidateAt(index), region: scope,
      stencil: traits.input,
    });
  };

  /** Clear is bounded by the last run's region and spares placements made by hand there. */
  const clearLastRun = () => {
    if (!clearRun()) return;
    forgetApplied();
    maze.forgetLanded();
  };

  const cardsRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const zoom = useFrameZoom();
  const layout = useFrameLayout();
  const clearance = useRailClearance(PAD.bottom + STRIP.h + STRIP.gap, SHELF_TABS.floor + TEXT.shelfTab);
  const stripClearance = useRailClearance(PAD.bottom, STRIP.h);
  const right = layout ? layout.edgeRight + clearance : PAD.right;
  const stripFade = useScrollRow(stripRef, { zoom, bleed: { top: 20, right: 12, bottom: 12, left: 12 }, pointerEvents: 'auto' });
  // The card row draws no scrollbar, so its fade is the one sign of more to see.
  const cardsFade = useScrollRow(cardsRef, { zoom, pointerEvents: 'auto' });
  const swapMotion = useTransition('shelf.category.swap');

  const cardH = CARD_H;
  /** The card's width follows its height, since its shape is the drawing's. */
  const cardW = Math.min(px(CARD.w), (cardH * CARD.w) / CARD.h);
  /** How far the chosen card's plate stands past the card box: the scroll row concedes it on every edge. */
  const chosenOut = Math.ceil(cardH * CHOSEN.insetY);
  const stackedActions = layout ? layout.width - right - PAD.side < cardW * 3 : false;
  const actionW = stackedActions ? RAIL.button : cardH * BATCH.wide;
  const actionH = stackedActions ? (cardH - PAIR_GAP) / 2 : cardH;
  /** The room over the block: the names stand at one height in both shelves. */
  const rowGap = SHELF_TABS.floor - PAD.bottom - BODY_H;
  const scopeSays = scope ? t('units.cells', { n: scope.length }) : t('generate.scope_all');
  const adapt = (props: string[]) => cssMotion('frame.layout.adapt', props);

  // Painting a region is a screen of its own: every candidate is stale the moment the region changes.
  if (selectingRegion && !agentSelecting) {
    return (
      <ScopeScreen
        onDone={() => setSelectingRegion(false)}
        {...(SCOPE_TOOLS_FOR[kind] ? { tools: SCOPE_TOOLS_FOR[kind] } : {})}
        {...(traits.input ? { minSide: STENCIL_MIN_SIDE[traits.input] } : {})}
      />
    );
  }
  // Choosing a letter's object is the item shelf standing in for this one.
  if (recipe.pickingItem) {
    return <ItemPickScreen current={fillItem} onPicked={(id) => { recipe.setFillItem(id); recipe.setPickingItem(false); }} />;
  }

  return (
    <>
      <MazeEndpoints ends={maze.shown} onMove={(which, cell, dropped) => maze.moveEnd(which, cell, dropped, (gates) => {
        // While a run stands, a dropped end re-runs it at its own seed: one drop, one generation, one undo entry.
        if (appliedIndex !== null) applyCandidate(appliedIndex, { gates });
      })} />
      <div {...helpTargetAttr(traits.helpPage)} {...mapEdgeAttr('bottom')} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: z.panel }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          <ShelfBand />
          <div
            style={{
              position: 'relative', width: '100%', boxSizing: 'border-box',
              padding: `${PAD.top}px ${layout?.edgeRight ?? PAD.right}px ${PAD.bottom}px ${PAD.side}px`,
              transition: adapt(['padding-right']),
              display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: rowGap,
            }}
          >
            {/* The heading is the row of kinds alone, on the map above the band. */}
            <div style={{ ...TAB_ROW, position: 'relative', marginRight: layout ? clearance : 0, transition: adapt(['margin-right']) }}>
              <ShelfTabs
                label={t('menu.generate')}
                tabs={TABS.map((entry) => ({ id: entry.id, label: t(entry.labelKey), helpTarget: GENERATE_KIND[entry.id].helpPage }))}
                active={kind}
                onSelect={recipe.setKind}
              />
            </div>
            {/* A change of kind swaps the whole declared-height block under the names, on the object shelf's category swap. */}
            <motion.div
              key={kind}
              data-testid="shell-gen-body"
              initial={{ opacity: 0, x: SWAP_X }}
              animate={{ opacity: 1, x: 0 }}
              transition={swapMotion}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', height: BODY_H, gap: STRIP.gap }}
            >
              <div style={{ display: 'flex', alignItems: 'stretch', height: cardH, minWidth: 0, marginRight: layout ? clearance : 0, transition: adapt(['margin-right']) }}>
                <GenerateCards
                  ref={cardsRef}
                  recipe={recipe}
                  cardW={cardW}
                  view={{
                    shots: previews.shots, customShot: previews.customShot,
                    appliedIndex, failedIndex: landing.failedIndex, landingIndex: landing.landingIndex,
                    noteFor: inputs.noteFor, ownNote: inputs.ownNote, ownAllowed: inputs.ownAllowed, ownPending: inputs.ownReview.pending,
                    ...(traits.input === 'text' ? { onRetryOwn: inputs.ownReview.retry } : {}),
                    hand: inputs.hand, onSelect: (i) => applyCandidate(i),
                  }}
                  style={{
                    ...ROW, gap: GAP.card,
                    // Solid between cards too, so a wheel there glides the row rather than reaching the map.
                    pointerEvents: 'auto', flex: '0 1 auto', minWidth: 0, justifyContent: 'flex-start',
                    height: cardH + 2 * chosenOut, ...scrollBleed(chosenOut), ...cardsFade,
                  }}
                />
                {/* New batch and Clear act on a whole generation, so they stand outside the scroll, beside the last card. */}
                <div style={{ display: 'flex', flexDirection: stackedActions ? 'column' : 'row', alignItems: 'stretch', flex: '0 0 auto', marginLeft: GAP.card }}>
                  <ShelfAction label={t('generate.reroll')} testId="shell-gen-batch" busy={busy} width={actionW} height={actionH}
                    radius={px(BATCH.radius)} onPress={recipe.reroll}>
                    <GlyphIcon glyph={GLYPHS.rotate} size={BATCH.glyph} />
                  </ShelfAction>
                  <ShelfAction label={t('generate.clear_generated')} testId="shell-gen-clear" busy={busy} width={actionW} height={actionH}
                    radius={px(BATCH.radius)} onPress={clearLastRun}
                    offset={stackedActions ? { marginLeft: 0, marginTop: PAIR_GAP } : { marginLeft: PAIR_GAP - GAP.card, marginTop: 0 }}>
                    <span aria-hidden style={{ display: 'flex', color: PLATE_INK }}><TrashIcon size={BATCH.glyph} /></span>
                  </ShelfAction>
                </div>
              </div>
              <GenerateStrip
                ref={stripRef}
                recipe={recipe}
                ends={maze}
                scopeSays={scopeSays}
                style={{
                  display: 'flex', alignItems: 'center', flexWrap: 'nowrap', height: STRIP.h, minWidth: 0, gap: GAP.strip, pointerEvents: 'auto',
                  ...stripFade,
                  // The strip reserves its own rail band apart from the taller card row.
                  marginRight: layout ? stripClearance - 12 : -(right - STRIP.right),
                  transition: adapt(['margin-right']),
                }}
              />
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}
