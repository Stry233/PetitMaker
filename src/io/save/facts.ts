// The save format's light facts, for callers that must not pull the codecs into their bundle.
import type { I18nKey } from '../../i18n/keys';
import type { SectionKey } from './sections';

export { PLANET_NAME_MAX } from './planet-codec';

/** What each optional section of the JSON export is called, in the export window and in a warning
 *  that names a section the import could not restore. */
export const SECTION_LABELS: Readonly<Record<SectionKey, I18nKey>> = {
  annotations: 'export.json_annotations',
  notes: 'export.json_notes',
  generation: 'export.json_generation',
  provenance: 'export.json_provenance',
  history: 'export.json_history',
  session: 'export.json_session',
  stats: 'export.json_stats',
  catalog: 'export.json_catalog',
};
