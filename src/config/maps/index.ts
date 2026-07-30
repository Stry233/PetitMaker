/**
 * Built-in map registry. Every `*.json` in this directory is auto-registered by
 * its `template.id` via a Vite glob — drop a new map JSON in and it appears in the
 * New-Project picker and resolves on import/load with NO wiring edits elsewhere.
 */
import type { MapTemplate } from '../../core/model/types';

const modules = import.meta.glob('./*.json', { eager: true }) as Record<string, { default: MapTemplate }>;

/** Built-in maps keyed by `template.id`. */
export const MAP_TEMPLATES: Record<string, MapTemplate> = {};
for (const mod of Object.values(modules)) {
  const tmpl = mod.default;
  MAP_TEMPLATES[tmpl.id] = tmpl;
}

/** Stable display order for the picker (by id). */
export const MAP_LIST: MapTemplate[] = Object.values(MAP_TEMPLATES).sort((a, b) => a.id.localeCompare(b.id));

/** The cold-start / fallback map id. The one place the default is named. */
const DEFAULT_MAP_ID = 'hexia';

/** Resolve a template id to its map, falling back to the default. */
export function getMapTemplate(id: string | undefined): MapTemplate {
  return (id ? MAP_TEMPLATES[id] : undefined) ?? MAP_TEMPLATES[DEFAULT_MAP_ID] ?? MAP_LIST[0]!;
}

/** The default map template (cold start). */
export const DEFAULT_MAP: MapTemplate = getMapTemplate(DEFAULT_MAP_ID);
