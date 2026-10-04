/**
 * Opening a map: a fresh template, or one that already exists.
 *
 * Both discard the generation scope, because a scope describes the map that is being replaced.
 */
import { createDefaultRegistry } from '../../rules/index';
import type { GridState, MapTemplate } from '../../core/model/types';
import { templateOf } from '../../config/maps/resolve';
import { installMap, installLoadedMap } from '../context';
import { forgetGenerationScope } from './generate';

/** `template` names a built-in map, or IS the map: a template the built-in registry does not hold.
 *  An id that names no built-in throws rather than opening the default planet. */
export function newMap(template: string | MapTemplate): void {
  installMap(templateOf(template), createDefaultRegistry());
  forgetGenerationScope();
}

export function loadMap(state: GridState): void {
  installLoadedMap(state, createDefaultRegistry());
  forgetGenerationScope();
}
