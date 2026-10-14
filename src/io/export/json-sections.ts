/**
 * What the save file carries, as the JSON export's switches choose it: one record of section
 * choices, the reducer the switches drive, the live size estimate summed from per-section sizes
 * measured once, and the serializer options the choices make.
 */
import type { HistoryEntry } from '../../core/commands/command-apply';
import type { MapNotes } from '../../core/model/types';
import { RECENT_HISTORY_STEPS } from './facts';
import { SECTIONS, carrying, type ExportJsonOptions, type SectionKey, type SectionNeed, type SectionSizes } from '../save/sections';

export { RECENT_HISTORY_STEPS };

export type HistoryDepth = 'all' | 'recent';

/** The choices a switch turns on and off: the sections, and pretty printing. */
export type JsonSectionKey = SectionKey | 'pretty';

export interface JsonSections extends Record<JsonSectionKey, boolean> {
  historyDepth: HistoryDepth;
}

/** Which optional sections the open map can carry at all. */
export type JsonSectionAvailability = Record<SectionNeed, boolean>;

export type JsonSectionAction =
  | { type: 'toggle'; key: JsonSectionKey }
  | { type: 'set'; key: JsonSectionKey; on: boolean }
  | { type: 'depth'; depth: HistoryDepth };

/** The file a window opens on: the sections carried by default, those that need map data where the
 *  map has it. */
export function initialSections(available: JsonSectionAvailability): JsonSections {
  const sections = Object.fromEntries(SECTIONS.map((spec) => [spec.key, 'needs' in spec ? available[spec.needs] : 'byDefault' in spec]));
  return { ...sections as Record<SectionKey, boolean>, pretty: false, historyDepth: 'all' };
}

export function sectionsReducer(state: JsonSections, action: JsonSectionAction): JsonSections {
  switch (action.type) {
    case 'toggle': return { ...state, [action.key]: !state[action.key] };
    case 'set': return state[action.key] === action.on ? state : { ...state, [action.key]: action.on };
    case 'depth': return state.historyDepth === action.depth ? state : { ...state, historyDepth: action.depth };
  }
}

/** Each section as carried: a choice the map cannot honour (no recipe, no provenance) counts as off. */
function carriedSections(sections: JsonSections, available: JsonSectionAvailability): Record<SectionKey, boolean> {
  return Object.fromEntries(SECTIONS.map((spec) => [spec.key, sections[spec.key] && (!('needs' in spec) || available[spec.needs])])) as Record<SectionKey, boolean>;
}

export const historyDepthSteps = (depth: HistoryDepth): 'all' | number => (depth === 'all' ? 'all' : RECENT_HISTORY_STEPS);

/** The notes are measured live as they are typed; every other section once per opening. */
const LIVE_SECTION: SectionKey = 'notes';

/** The serializer options that measure every section but the notes, for `sectionSizeFormats`. */
export function measuringOptions(history: ExportJsonOptions['history'], session: ExportJsonOptions['session']): ExportJsonOptions {
  return {
    carry: carrying(...SECTIONS.map(({ key }) => key).filter((key) => key !== LIVE_SECTION)),
    ...(history ? { history } : {}), ...(session ? { session } : {}), pretty: false,
  };
}

/** The file's estimated size: the carried sections' measured sizes plus the notes, measured live. The
 *  written file adds a little outer framing. */
export function estimatedTotal(sizes: SectionSizes, sections: JsonSections, available: JsonSectionAvailability, notesBytes: number): number {
  const carried = carriedSections(sections, available);
  return SECTIONS.reduce((sum, { key }) => sum + (key !== LIVE_SECTION && carried[key] ? sizes[key] : 0), sizes.core + sizes.manifest + notesBytes);
}

/** The serializer options the choices make; history and session are read as the file is written. */
export function exportOptionsFor(sections: JsonSections, available: JsonSectionAvailability, notes: MapNotes | null, read: {
  history: () => HistoryEntry[];
  session: () => NonNullable<ExportJsonOptions['session']>;
}): ExportJsonOptions {
  const carry = carriedSections(sections, available);
  carry.notes &&= !!notes;
  return {
    carry,
    ...(carry.notes && notes ? { notes } : {}),
    ...(carry.history ? { history: { entries: read.history(), depth: historyDepthSteps(sections.historyDepth) } } : {}),
    ...(carry.session ? { session: read.session() } : {}),
    pretty: sections.pretty,
  };
}
