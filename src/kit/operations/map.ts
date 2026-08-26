/**
 * Opening a map: a fresh template, or one that already exists.
 *
 * Both discard the generation scope, because a scope describes the map that is being replaced.
 */
import { createDefaultRegistry } from '../../rules/index';
import type { GridState, MapTemplate } from '../../core/model/types';
import { getMapTemplate } from '../../config/maps';
import { installMap, installLoadedMap } from '../context';
import { forgetGenerationScope } from './generate';

/** `template` names a built-in map, or IS the map — a template the built-in registry does not hold
 *  (`getMapTemplate` answers an unknown id with the default, which would silently open the wrong
 *  planet). */
export function newMap(template: string | MapTemplate): void {
  installMap(typeof template === 'string' ? getMapTemplate(template) : template, createDefaultRegistry());
  forgetGenerationScope();
}

export function loadMap(state: GridState): void {
  installLoadedMap(state, createDefaultRegistry());
  forgetGenerationScope();
}
