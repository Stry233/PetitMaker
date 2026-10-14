/*
 * The Help Center's demo scenes. A scene frames a crop of a real template (`stage`) and its `run` authors
 * the opening state with real commands and returns the steps, closures over the world, which the player
 * rewinds through the real undo stack between loops; every mark goes through the app's own overlay.
 */
import { BUILD_OBJECT_SCENES } from './build-objects';
import { BUILD_TERRAIN_SCENES } from './build-terrain';
import { BUILD_TRIM_SCENES } from './build-trims';
import { GENERATE_SCENES } from './generate';
import { MISC_SCENES } from './misc';
import { PLAN_SCENES } from './plan';
import { START_SCENES } from './start';
import type { HelpScene } from './common';

export type { DemoCtx, DemoView, HelpScene, SceneStep, Stage } from './common';

export const HELP_SCENES: Record<string, HelpScene> = {
  ...START_SCENES, ...BUILD_TERRAIN_SCENES, ...BUILD_TRIM_SCENES, ...BUILD_OBJECT_SCENES, ...GENERATE_SCENES, ...PLAN_SCENES, ...MISC_SCENES
};
