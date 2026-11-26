/**
 * The world a scene plays in. A scene that names its plot plays inside a lived-in map, the designed
 * neighbourhood of its template with the plot cleared back to the template; the world starts from
 * that map with an empty history, so the player's rewind stops at the neighbourhood. A scene that
 * only draws notes plays on the neighbourhood whole, since a note meets no rule of the ground under
 * it. Where the map comes from is `editor/sandbox/scene-worlds.ts`'s.
 */
import type { Rect } from '../../../../core/grid/rect';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { plotClearing as clearingOf } from '../../../../editor/sandbox/neighbourhood';
import { prepareSceneWorld as prepare, sceneBase, type SceneWorldAsk } from '../../../../editor/sandbox/scene-worlds';
import { CABIN, CABIN2, type HelpScene, type Plot } from './common';

/** The one-per-map items the scenes place, taken off the neighbourhood so they stay free to place. */
const PLACED_CAPPED = [CABIN, CABIN2];

const rectOf = (plot: Plot): Rect => ({ x: plot.x1, y: plot.y1, w: plot.x2 - plot.x1 + 1, h: plot.y2 - plot.y1 + 1 });

/** The lived-in map `scene` asks for; null for a scene that plays on its bare template. */
function askOf(scene: HelpScene): SceneWorldAsk | null {
  if (!scene.plot && !scene.notesOnly) return null;
  return {
    ...(scene.template !== undefined ? { templateId: scene.template } : {}),
    ...(scene.plot ? { plot: { cells: rectOf(scene.plot), free: PLACED_CAPPED } } : {}),
  };
}

/** The cells a scene's world clears for `plot`: the plot grown by the margin, in template cells. */
export function plotClearing(plot: Plot): Plot {
  const c = clearingOf(rectOf(plot));
  return { x1: c.x, y1: c.y, x2: c.x + c.w - 1, y2: c.y + c.h - 1 };
}

/** Makes `scene`'s world ready for `sceneWorld` without building it on this thread. Resolves at
 *  once for a scene that needs no neighbourhood or whose world is already here. */
export function prepareSceneWorld(scene: HelpScene): Promise<void> {
  const ask = askOf(scene);
  return ask ? prepare(ask) : Promise.resolve();
}

/** A fresh world for `scene`: with a plot, the neighbourhood around that plot; a scene that only
 *  draws notes, the neighbourhood as it stands; otherwise its template. */
export function sceneWorld(scene: HelpScene): SandboxWorld {
  const ask = askOf(scene);
  return ask ? new SandboxWorld(scene.template, { base: sceneBase(ask) }) : new SandboxWorld(scene.template);
}
