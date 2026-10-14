/*
 * The picture kinds' steps a Help figure runs on a sandbox world: the boxes a stencil fills, a
 * glyph rasterized in the shipped faces, and a plan built through the shelf's own plan inputs. Kept
 * apart from the world so a scene that never draws a stencil never loads the raster code.
 */
import { isBuildableZone } from '../../core/game/zones';
import type { MacroCoord } from '../../core/model/types';
import type { StencilKind } from '../../tools/generation/kinds';
import type { Stencil, StencilPlan } from '../../tools/generation/recipe';
import {
  buildStencilPlan, ensureGlyphFonts, islandBox, planInputsFor, rasterizeText, regionBox,
  type PlanKnobs, type StencilBox, type StencilSource,
} from '../../tools/generation/stencil';
import type { SandboxWorld } from './demo-world';

/** The bounding box of the world's buildable ground. */
export function buildableBox(world: SandboxWorld): StencilBox | null {
  return islandBox(world.state, isBuildableZone);
}

/** The bounding box of `cells`; null for none. */
export function cellsBox(cells: readonly MacroCoord[]): StencilBox | null {
  return regionBox(cells);
}

/** `text` rasterized over `box` once its glyph faces have loaded; null where it cannot be drawn. */
export async function glyphStencil(text: string, box: StencilBox): Promise<Stencil | null> {
  await ensureGlyphFonts(text);
  return rasterizeText(text, box);
}

/** A picture kind's plan for `sample` over `box`, built through the shelf's own plan inputs. */
export function stencilPlanOn(sample: StencilSource, input: StencilKind, box: StencilBox, knobs: PlanKnobs): Promise<StencilPlan | null> {
  return buildStencilPlan(sample, planInputsFor(input, box, knobs));
}
