/**
 * The generate shelf's recipe: each kind keeps its own seed, ceiling, material and recipe number
 * while another is visited, and the own card files a letter's text or a recipe number.
 */
import { describe, it, expect } from 'vitest';
import { createGenerateRecipe, recipeElevation } from '../../../editor/editing/generate-recipe';
import { KIND_ENGINE, RECIPE_RANGES } from '../../../tools/generation/facts';

const make = () => createGenerateRecipe(['maze', 'text', 'image', 'island'], 'maze', { richness: 50, corridorWidth: 1, contrast: 100 });

describe('the generate recipe', () => {
  it('remembers each kind\'s own settings while another is visited', () => {
    const recipe = make();
    const mazeSeed = recipe.get().byKind.maze.base;
    recipe.setMaxElevation(1);
    recipe.setKind('island');
    recipe.reroll();
    expect(recipe.get().byKind.island.base).not.toBe(mazeSeed);
    expect(recipe.get().byKind.maze).toMatchObject({ base: mazeSeed, maxElevation: 1 });
    expect(recipeElevation(recipe.get())).toBe(KIND_ENGINE.island.maxElevation);
  });

  it('holds the raised layer between the floor and the kind\'s ceiling', () => {
    const recipe = make();
    recipe.setMaxElevation(99);
    expect(recipeElevation(recipe.get())).toBe(KIND_ENGINE.maze.maxElevation);
    recipe.setMaxElevation(-5);
    expect(recipeElevation(recipe.get())).toBe(RECIPE_RANGES.maxElevation.min);
  });

  it('files a letter\'s trimmed text and the other kinds\' digits, reporting only a change', () => {
    const recipe = make();
    recipe.setKind('text');
    expect(recipe.commitCustom('  Hi ')).toBe(true);
    expect(recipe.get().ownText).toBe('Hi');
    expect(recipe.commitCustom('Hi')).toBe(false);
    recipe.setKind('maze');
    expect(recipe.commitCustom('1234')).toBe(true);
    expect(recipe.get().byKind.maze.customSeed).toBe(1234);
    expect(recipe.commitCustom('1234')).toBe(false);
    expect(recipe.get().byKind.island.customSeed).toBeNull();
  });
});
