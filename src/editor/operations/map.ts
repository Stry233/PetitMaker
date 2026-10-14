/**
 * Opening a map: a fresh template, or one that already exists.
 *
 * Generation scopes are kept per map, so a fresh template starts with none; a loaded map drops any
 * scope it carried, because a scope describes the map that was there before.
 */
import { createDefaultRegistry } from '../../rules/index';
import type { GridState, MapTemplate } from '../../core/model/types';
import { templateOf } from '../../config/maps/resolve';
import type { MapPort } from '../session/context';
import { forgetGenerationScope } from './generate';

/** `template` names a built-in map, or is the map: a template the built-in registry does not hold.
 *  An id that names no built-in throws rather than opening the default planet. */
export function newMap(port: MapPort, template: string | MapTemplate): void {
  port.install(templateOf(template), createDefaultRegistry());
}

export function loadMap(port: MapPort, state: GridState): void {
  port.installLoaded(state, createDefaultRegistry());
  forgetGenerationScope(state);
}
