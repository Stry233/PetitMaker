/**
 * The generation orchestrator: capture -> letterbox -> assemble the conditioned image set ->
 * prompt -> dialect call -> crop back -> one optional judge/correction pass. Store-free (the
 * caller mints into `versionStore` and stamps the fingerprint), so it is testable against a fake
 * dialect with no map, no window and no network.
 */
import { loadImage } from '../../export/canvas-helpers';
import { ItemCategory, TerrainType, type GridState } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';
import { renderSemanticLayout } from '../control/semantic';
import { cropBackRect, letterboxToCanvas, planNormalize } from '../normalize';
import { STYLE_PACKS, type DirectionId, type StylePack } from '../presets';
import { compilePrompt, type ConditionImages } from '../prompt/compile';
import { buildManifest } from '../scene/manifest';
import { verbalizeScene } from '../scene/verbalize';
import { StylizeError, type DialectConfig, type StylizeDialect, type StylizeImage } from '../dialects/types';
import type { Recipe } from './recipe';

export interface EngineDeps {
  /** Wired to `host.capture2d(maxEdge, false, false)`: no grid, no ink. */
  captureMap(): string | null;
  /** For the manifest and the layout render. */
  state: GridState;
  dialect: StylizeDialect;
  cfg: DialectConfig;
  /** `null` for the custom direction (paper falls back to watercolor's). */
  pack: StylePack | null;
  /** The style anchor, when one stands: a pack's own full sample ('pack'), or an earlier kept
   *  take of this same map ('take'), which is the strongest cross-take consistency anchor there
   *  is — the reference and the target share their content, so nothing can leak wrongly. */
  styleRef?: { url: string; kind: 'pack' | 'take' };
}

const FALLBACK_PAPER = STYLE_PACKS.find((p) => p.id === 'watercolor')!.paper;

/** This module's own category vocabulary (see presets.ts): plant merges tree and flora,
 *  water-feature reads terrain rather than a placed object. Decoration has no catalog category of
 *  its own, so it never fires off this reading — a known gap, not a bug. */
const CATEGORY_LABEL: Partial<Record<ItemCategory, string>> = {
  [ItemCategory.Building]: 'building',
  [ItemCategory.Road]: 'road',
  [ItemCategory.Tree]: 'plant',
  [ItemCategory.Flora]: 'plant',
};

function presentCategoriesOf(state: GridState): Set<string> {
  const present = new Set<string>();
  for (const obj of state.objects.values()) {
    const label = CATEGORY_LABEL[categoryOf(obj) as ItemCategory];
    if (label) present.add(label);
  }
  outer: for (const row of state.cells) {
    for (const cell of row) {
      if (cell?.terrain?.type === TerrainType.Water) { present.add('water-feature'); break outer; }
    }
  }
  return present;
}

/** Assembles the role-tagged image set actually sent this call: source always last, style dropped
 *  before layout when the recipe's raw conditions would exceed the dialect's own budget. */
function buildImageSet(
  sourceDataUrl: string,
  layoutDataUrl: string | null,
  styleDataUrl: string | null,
  styleKind: 'pack' | 'take',
  maxImages: number,
): { images: StylizeImage[]; conditionImages: ConditionImages } {
  let style = styleDataUrl !== null;
  let layout = layoutDataUrl !== null;
  const total = () => 1 + (style ? 1 : 0) + (layout ? 1 : 0);
  if (total() > maxImages) style = false;
  if (total() > maxImages) layout = false;

  const images: StylizeImage[] = [];
  if (style) images.push({ role: 'style', dataUrl: styleDataUrl! });
  if (layout) images.push({ role: 'layout', dataUrl: layoutDataUrl! });
  images.push({ role: 'source', dataUrl: sourceDataUrl });

  return { images, conditionImages: { source: true, style: style ? styleKind : false, layout } };
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
  if (!captured) throw new StylizeError('bad_response');

  const sourceImg = await loadImage(captured);
  const plan = planNormalize(sourceImg.width, sourceImg.height, deps.dialect.maxEdge, deps.dialect.aspects);
  const paper = deps.pack?.paper ?? FALLBACK_PAPER;
  const sourceDataUrl = letterboxToCanvas(sourceImg, plan, paper).toDataURL('image/png');

  const layoutDataUrl = recipe.conditions.layout
    ? renderSemanticLayout(deps.state, plan).toDataURL('image/png')
    : null;
  // The anchor usually arrives as a bundled asset URL (or a take's own data URL); a dialect can
  // only carry a data URL, so anything else is loaded and re-encoded here (PNG: every provider
  // takes it, webp not all).
  const styleDataUrl = recipe.conditions.style && deps.styleRef ? await asDataUrl(deps.styleRef.url) : null;

  const { images, conditionImages } = buildImageSet(sourceDataUrl, layoutDataUrl, styleDataUrl, deps.styleRef?.kind ?? 'pack', deps.dialect.maxImages);

  const scene = verbalizeScene(buildManifest(deps.state));
  const presentCategories = presentCategoriesOf(deps.state);
  const prompt = compilePrompt({ direction, customText, scene, presentCategories, images: conditionImages }).text;

  let outputDataUrl = await deps.dialect.generate(deps.cfg, { images, prompt, aspectId: plan.aspectId }, signal);

  if (recipe.judge && deps.dialect.judge) {
    const clauses = await deps.dialect.judge(deps.cfg, { source: sourceDataUrl, output: outputDataUrl, scene }, signal);
    if (clauses.length > 0) {
      const correctionPrompt = `${prompt} Corrections: ${clauses.join(' ')}`;
      // Re-anchored on the ORIGINAL images, never the drifted output, and never chained again.
      outputDataUrl = await deps.dialect.generate(deps.cfg, { images, prompt: correctionPrompt, aspectId: plan.aspectId }, signal);
    }
  }

  const outputImg = await loadImage(outputDataUrl);
  const crop = cropBackRect(plan, outputImg.width, outputImg.height);
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.round(crop.w);
  cropCanvas.height = Math.round(crop.h);
  cropCanvas.getContext('2d')!.drawImage(outputImg, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

  return { image: await loadImage(cropCanvas.toDataURL('image/png')) };
}
