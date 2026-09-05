/*
 * options-store.ts — the export window's remembered choices: the preset, the picture's parts, the
 * footer template and the size, kept between sessions so the window opens the way it was left.
 * The title and description are the map's own words and are never carried over. One localStorage
 * blob under the `exportOptions` preference; every field is checked against what the window can
 * actually offer, so a stale or hand-edited value falls back to the default rather than into the UI.
 */
import { readPref, writePref } from '../../core/runtime/prefs';
import type { ExportOptions, ExportPreset, ResolutionKey } from './types';

type Remembered = Omit<ExportOptions, 'title' | 'description'>;

const BOOLEANS = ['importable', 'showBadge', 'layerPreview', 'card3d', 'grid', 'footer', 'annotations'] as const;
const PRESETS: readonly ExportPreset[] = ['share', 'plain'];
const RESOLUTIONS: readonly ResolutionKey[] = ['compact', 'standard', 'high', 'original'];
const FOOTER_TEMPLATE_MAX = 400;

/** What was remembered, field by field, with anything unrecognisable left out. */
export function loadRememberedExportOptions(): Partial<Remembered> {
  const raw = readPref('exportOptions');
  if (!raw) return {};
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  const out: Partial<Remembered> = {};
  for (const k of BOOLEANS) if (typeof d[k] === 'boolean') out[k] = d[k] as boolean;
  if (PRESETS.includes(d.preset as ExportPreset)) out.preset = d.preset as ExportPreset;
  if (RESOLUTIONS.includes(d.resolution as ResolutionKey)) out.resolution = d.resolution as ResolutionKey;
  if (typeof d.footerTemplate === 'string' && d.footerTemplate.length <= FOOTER_TEMPLATE_MAX) out.footerTemplate = d.footerTemplate;
  return out;
}

/** Remember everything about the options except the map's own words. */
export function rememberExportOptions(options: ExportOptions): void {
  const { title: _title, description: _description, ...rest } = options;
  writePref('exportOptions', JSON.stringify(rest));
}
