/** The generate shelf's view of `editor/editing/generate-recipe.ts`, with the own card's typing
 *  draft, the item-pick screen and the file chooser, which are the shelf's own. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createGenerateRecipe, recipeElevation } from '../../../../editor/editing/generate-recipe';
import { batchSeeds, isStencilKind } from '../../../../tools/generation/facts';
import {
  CONTRAST, CORRIDOR, MIN_ELEVATION, RICHNESS, TABS, maxElevationFor, type GenerateKind, type StencilFillKind,
} from './generate-shelf';

export function useGenerateRecipe(initialKind: GenerateKind | undefined, onOwnChanged: () => void) {
  const [recipe] = useState(() => createGenerateRecipe(TABS.map((tab) => tab.id), initialKind ?? TABS[0]!.id, {
    richness: RICHNESS.default, corridorWidth: CORRIDOR.min, contrast: CONTRAST.default,
  }));
  const state = useSyncExternalStore(recipe.subscribe, recipe.get);
  const [pickingItem, setPickingItem] = useState(false);
  /** Non-null only while the own card's field is typed in, so a half-typed number is never a seed. */
  const [customDraft, setCustomDraft] = useState<string | null>(null);

  const { kind } = state;
  const memory = state.byKind[kind];
  const stencil = isStencilKind(kind);

  /** The typing has stopped: the recipe files what was typed. */
  const commitCustom = useCallback(() => {
    const raw = customDraft ?? '';
    setCustomDraft(null);
    if (recipe.commitCustom(raw)) onOwnChanged();
  }, [customDraft, recipe, onOwnChanged]);

  /** Takes a picture from the visitor's files. */
  const pickImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      recipe.takeImage(file);
      onOwnChanged();
    };
    input.click();
  }, [recipe, onOwnChanged]);

  useEffect(() => () => recipe.dispose(), [recipe]);

  return {
    kind, setKind: recipe.setKind, stencil, base: memory.base, seeds: batchSeeds(memory.base), reroll: recipe.reroll,
    richness: state.richness, setRichness: recipe.setRichness, corridorWidth: state.corridorWidth, setCorridorWidth: recipe.setCorridorWidth,
    ceiling: maxElevationFor(kind), floor: MIN_ELEVATION, elevation: recipeElevation(state), setMaxElevation: recipe.setMaxElevation,
    fillKind: stencil ? memory.fillKind : 'mountain' as StencilFillKind, setFillKind: stencil ? recipe.setFillKind : () => {},
    fillItem: state.fillItem, setFillItem: recipe.setFillItem, pickingItem, setPickingItem, contrast: state.contrast, setContrast: recipe.setContrast,
    ownText: state.ownText, ownImage: state.ownImage, pickImage, customSeed: memory.customSeed, customDraft, setCustomDraft, commitCustom,
  };
}

export type GenerateRecipe = ReturnType<typeof useGenerateRecipe>;
