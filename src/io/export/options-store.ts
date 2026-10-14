/*
 * The export window's remembered choices: the preset, the picture's parts, the
 * footer template and the size, kept between sessions so the window opens the way it was left.
 * The title and description are the map's own words and are never carried over. One localStorage
 * blob under the `exportOptions` preference; every field is checked against what the window can
 * actually offer, so a stale or hand-edited value falls back to the default rather than into the UI.
 */
import { jsonObject, jsonPref, writeJsonPref } from '../../platform/storage/prefs';
import { EXPORT_PRESETS, RESOLUTION_KEYS, type ExportOptions, type ExportPreset, type ResolutionKey } from './types';
import { DEFAULT_FOOTER } from './footer-template';

/** The options a window opens with when nothing was remembered. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  title: '', description: '', preset: 'share', showBadge: true, layerPreview: true, card3d: false, grid: true, footer: true, annotations: true,
  footerTemplate: DEFAULT_FOOTER, resolution: 'standard',
};

type Remembered = Omit<ExportOptions, 'title' | 'description'>;

const BOOLEANS = ['showBadge', 'layerPreview', 'card3d', 'grid', 'footer', 'annotations'] as const;
const FOOTER_TEMPLATE_MAX = 400;

/** What was remembered, field by field, with anything unrecognisable left out. */
function loadRememberedExportOptions(): Partial<Remembered> {
  const d = jsonPref('exportOptions', jsonObject);
  if (!d) return {};
  const out: Partial<Remembered> = {};
  for (const k of BOOLEANS) if (typeof d[k] === 'boolean') out[k] = d[k] as boolean;
  if (EXPORT_PRESETS.includes(d.preset as ExportPreset)) out.preset = d.preset as ExportPreset;
  // Older records kept the share-code switch as its own `importable` field; it decided the picture.
  if (typeof d.importable === 'boolean') out.preset = d.importable ? 'share' : 'plain';
  if (RESOLUTION_KEYS.includes(d.resolution as ResolutionKey)) out.resolution = d.resolution as ResolutionKey;
  if (typeof d.footerTemplate === 'string' && d.footerTemplate.length <= FOOTER_TEMPLATE_MAX) out.footerTemplate = d.footerTemplate;
  return out;
}

/** The options the window opens with: the defaults under what was remembered. */
export function openingExportOptions(): ExportOptions {
  return { ...DEFAULT_EXPORT_OPTIONS, ...loadRememberedExportOptions() };
}

/** The options without the map's own words, which are never remembered. */
function rememberedPart({ title: _title, description: _description, ...rest }: ExportOptions): Remembered {
  return rest;
}

/** Remember everything about the options except the map's own words; with `opened`, only once the
 *  remembered part differs from what the window opened with. */
export function rememberExportOptions(options: ExportOptions, opened?: ExportOptions): void {
  const rest = rememberedPart(options);
  if (opened && JSON.stringify(rest) === JSON.stringify(rememberedPart(opened))) return;
  writeJsonPref('exportOptions', rest);
}
