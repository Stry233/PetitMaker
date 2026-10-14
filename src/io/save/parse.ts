import { isRecord } from '../../core/base/guards';
import { isCustomTemplate, upgradeLandmarks } from '../../core/model/planet';
import type { MapTemplate } from '../../core/model/types';
import { resolveTemplate } from '../../config/maps/resolve';
import { parseStoredTemplate } from './planet-codec';
import { migrateToCurrent, type RawSave, type SaveFile } from './format';
import { ImportError } from './import-error';

/** A save read once: the input as given, the envelope migrated to the current version, the
 *  template its cells are laid on, and the version it was written at. */
export interface ParsedSave {
  readonly raw: Readonly<RawSave>;
  readonly file: SaveFile;
  readonly template: MapTemplate;
  /** A save without a numeric `version` predates the field and reads as version 1. */
  readonly fromVersion: number;
}

/** Migrates a parsed save once and checks its envelope. `template` is the planet the caller
 *  already knows the save belongs to; without it the save's own planet is resolved. Throws
 *  `ImportError`: `malformed` for a malformed envelope or an unreachable version, `future-version`
 *  for a newer one, `incompatible-template` for a save made on another template. */
export function parseSave(raw: unknown, options: { template?: MapTemplate } = {}): ParsedSave {
  if (!isRecord(raw)) throw new ImportError('malformed', 'Invalid save file: expected an object.');
  const template = options.template ?? templateOfSave(raw);
  const file = migrateToCurrent(raw) as unknown as SaveFile;
  if (typeof file.cells !== 'string') throw new ImportError('malformed', 'Invalid save file: cell data is not a string.');
  if (!Array.isArray(file.objects)) throw new ImportError('malformed', 'Invalid save file: object data is not a list.');
  // Row-major cell data is meaningful only for its declared template dimensions.
  if (file.templateId && file.templateId !== template.id && readTemplateId(file) !== template.id) {
    throw new ImportError('incompatible-template', `Save was made for map template "${file.templateId}", not "${template.id}".`);
  }
  return { raw, file, template, fromVersion: typeof raw.version === 'number' ? raw.version : 1 };
}

/** The template a parsed save was made on: its embedded planet, else the built-in its id names.
 *  Only a custom planet's id reads the embedded template, so a stray field never fails a built-in save. */
function templateOfSave(raw: unknown): MapTemplate {
  const r = raw as { templateId?: string; template?: unknown };
  const stored = storedTemplateOf(r);
  return stored ? upgradeLandmarks(stored) : resolveTemplate(r.templateId);
}

/** The custom planet a save embeds, as stored, when it is the one the save names; otherwise
 *  undefined, and the save names a built-in or an unknown planet. */
function storedTemplateOf(r: { templateId?: unknown; template?: unknown }): MapTemplate | undefined {
  if (typeof r.templateId !== 'string' || !isCustomTemplate({ id: r.templateId }) || r.template === undefined) return undefined;
  const stored = parseStoredTemplate(r.template);
  return stored.id === r.templateId ? stored : undefined;
}

/** The id this build reads a save's planet by: an embedded planet's landmarks take the profile's
 *  footprints (`upgradeLandmarks`), and its id the content's. */
function readTemplateId(save: { templateId?: string; template?: unknown }): string | undefined {
  const stored = storedTemplateOf(save);
  return stored ? upgradeLandmarks(stored).id : save.templateId;
}
