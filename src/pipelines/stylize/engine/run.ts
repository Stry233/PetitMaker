/**
 * The generation orchestrator: capture -> letterbox -> assemble the conditioned image set ->
 * prompt -> dialect call -> crop back -> one optional judge/correction pass. Store-free (the
 * caller mints into `versionStore` and stamps the mapEdit), so it is testable against a fake
 * dialect and a captured picture with no live map and no network. It letterboxes and crops on a
 * document canvas.
 */
import { loadImage } from '../../../platform/async/load-image';
import { assertRasterDataUrl } from '../dialects/image-response';
import { TerrainType, type GridState } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { stylizeElementOf } from '../scene/element';
import { cropBackRect, letterboxToCanvas, planNormalize } from '../normalize';
import { CUSTOM_DIRECTION_PAPER, WATER_FEATURE, type DirectionId, type StylePack, type StylizeElement } from '../presets';
import { compilePrompt, JUDGE_INSTRUCTIONS, STYLIZE_TRUST, type ConditionImages } from '../prompt/compile';
import { buildManifest } from '../scene/manifest';
import { verbalizeScene } from '../scene/verbalize';
import { StylizeError, type DialectConfig, type StylizeDialect, type StylizeImage } from '../dialects/types';
import { orderByRole } from '../dialects/request';
import type { Recipe } from './recipe';

export interface EngineDeps {
  /** Wired to `host.capture2dImage({ maxPx: maxEdge, annotations: false })`: no grid, no ink. */
  captureMap(): string | null;
  /** For the manifest and the layout render. */
  state: GridState;
  dialect: StylizeDialect;
  cfg: DialectConfig;
  /** `null` for the custom direction, which letterboxes on `CUSTOM_DIRECTION_PAPER`. */
  pack: StylePack | null;
  /** The style anchor, when one stands: a pack's own full sample ('pack'), or an earlier kept
   *  take of this same map ('take'), which is the strongest cross-take consistency anchor there
   *  is — the reference and the target share their content, so nothing can leak wrongly. */
  styleRef?: { url: string; kind: 'pack' | 'take' };
}


/** The elements the map holds: each placed item's stylize element (plant merges tree and flora),
 *  and water-feature where terrain water lies rather than a placed object. */
function presentCategoriesOf(state: GridState): Set<StylizeElement> {
  const present = new Set<StylizeElement>();
  for (const obj of state.objects.values()) {
    const label = stylizeElementOf(getCatalogItem(obj.catalogId));
    if (label) present.add(label);
  }
  outer: for (const row of state.cells) {
    for (const cell of row) {
      if (cell?.terrain?.type === TerrainType.Water) { present.add(WATER_FEATURE); break outer; }
    }
  }
  return present;
}

/** Assembles the role-tagged image set actually sent this call, in the dialect's wire order: style
 *  dropped before layout when the recipe's raw conditions would exceed the dialect's own budget. */
function buildImageSet(
  sourceDataUrl: string,
  layoutDataUrl: string | null,
  styleDataUrl: string | null,
  styleKind: 'pack' | 'take',
  dialect: StylizeDialect,
): { images: StylizeImage[]; conditionImages: ConditionImages } {
  const { maxImages, imageOrder } = dialect;
  let style = styleDataUrl !== null && imageOrder.includes('style');
  let layout = layoutDataUrl !== null && imageOrder.includes('layout');
  const total = () => 1 + (style ? 1 : 0) + (layout ? 1 : 0);
  if (total() > maxImages) style = false;
  if (total() > maxImages) layout = false;

  const tagged: StylizeImage[] = [{ role: 'source', dataUrl: sourceDataUrl }];
  if (style) tagged.push({ role: 'style', dataUrl: styleDataUrl! });
  if (layout) tagged.push({ role: 'layout', dataUrl: layoutDataUrl! });

  return { images: orderByRole(tagged, imageOrder), conditionImages: { style: style ? styleKind : false, layout, order: imageOrder } };
}

async function asDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

export async function runEngine(
  deps: EngineDeps,
  direction: DirectionId,
  customText: string | undefined,
  recipe: Recipe,
  signal?: AbortSignal,
): Promise<{ image: HTMLImageElement }> {
  const captured = deps.captureMap();
  if (!captured) throw new StylizeError('device', 'map capture failed');

  const sourceImg = await loadImage(captured);
  const plan = planNormalize(sourceImg.width, sourceImg.height, deps.dialect.maxEdge, deps.dialect.aspects);
  const paper = deps.pack?.paper ?? CUSTOM_DIRECTION_PAPER;
  const sourceDataUrl = letterboxToCanvas(sourceImg, plan, paper).toDataURL('image/png');

  // Loaded only when a recipe asks for the layout condition, which LAYOUT_CONDITION_ENABLED keeps
  // off, so the renderer stays out of the stylize chunk.
  const layoutDataUrl = recipe.conditions.layout
    ? (await import('../control/semantic')).renderSemanticLayout(deps.state, plan).toDataURL('image/png')
    : null;
  // The anchor usually arrives as a bundled asset URL (or a take's own data URL); a dialect can
  // only carry a data URL, so anything else is loaded and re-encoded here (PNG: every provider
  // takes it, webp not all).
  const styleDataUrl = recipe.conditions.style && deps.styleRef ? await asDataUrl(deps.styleRef.url) : null;

  const { images, conditionImages } = buildImageSet(sourceDataUrl, layoutDataUrl, styleDataUrl, deps.styleRef?.kind ?? 'pack', deps.dialect);

  const scene = verbalizeScene(buildManifest(deps.state));
  const presentCategories = presentCategoriesOf(deps.state);
  const promptArgs = { direction, customText, scene, presentCategories, images: conditionImages };
  const prompt = compilePrompt(promptArgs).text;

  let outputDataUrl = await deps.dialect.generate(deps.cfg, { images, prompt, system: STYLIZE_TRUST, aspectId: plan.aspectId }, signal);

  assertRasterDataUrl(outputDataUrl);
  if (recipe.judge && deps.dialect.judge) {
    const clauses = await deps.dialect.judge(deps.cfg, { source: sourceDataUrl, output: outputDataUrl, scene, instructions: JUDGE_INSTRUCTIONS }, signal);
    if (clauses.length > 0) {
      const correctionPrompt = compilePrompt({ ...promptArgs, feedback: clauses }).text;
      // Re-anchored on the original images, never the drifted output, and never chained again.
      outputDataUrl = await deps.dialect.generate(deps.cfg, { images, prompt: correctionPrompt, system: STYLIZE_TRUST, aspectId: plan.aspectId }, signal);
    }
  }

  assertRasterDataUrl(outputDataUrl);
  const outputImg = await loadImage(outputDataUrl);
  const crop = cropBackRect(plan, outputImg.width, outputImg.height);
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.round(crop.w);
  cropCanvas.height = Math.round(crop.h);
  cropCanvas.getContext('2d')!.drawImage(outputImg, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

  return { image: await loadImage(cropCanvas.toDataURL('image/png')) };
}
