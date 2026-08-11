/**
 * Opening a map: a fresh template, or one that already exists.
 *
 * Both discard the generation scope, because a scope describes the map that is being replaced.
 */
import { createDefaultRegistry } from '../../rules/index';
import type { GridState } from '../../core/model/types';
import { getMapTemplate } from '../../config/maps';
import { installMap, installLoadedMap } from '../context';
import { forgetGenerationScope } from './generate';

export function newMap(templateId: string): void {
  installMap(getMapTemplate(templateId), createDefaultRegistry());
  forgetGenerationScope();
}

export function loadMap(state: GridState): void {
  installLoadedMap(state, createDefaultRegistry());
  forgetGenerationScope();
}
