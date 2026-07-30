import { CURRENT_VERSION, type Migration, type RawSave } from './types';
import { MIGRATIONS } from './migrations';

/** Thrown when a save can't be read: it's newer than this build, or there's no
 *  migration path to the current version. Carries a user-facing message. */
export class SaveVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveVersionError';
  }
}

/**
 * Lift a raw save of any past version up to `target` (default CURRENT_VERSION) by
 * running the migration chain one step at a time. Pure JSON → JSON: the result is
 * the target envelope shape, ready for the decoder.
 *
 * A missing `version` is treated as v1 (the format predates the field). A save
 * newer than `target`, or a gap in the chain, throws SaveVersionError.
 *
 * `migrations` and `target` are injectable so the engine can be tested with
 * synthetic chains without touching the real format.
 */
export function migrateToCurrent(
  raw: RawSave,
  migrations: Migration[] = MIGRATIONS,
  target: number = CURRENT_VERSION,
): RawSave {
  if (raw === null || typeof raw !== 'object') {
    throw new SaveVersionError('Invalid save file: expected an object.');
  }

  let version = typeof raw.version === 'number' ? raw.version : 1;

  if (version > target) {
    throw new SaveVersionError(
      `This map was saved by a newer version of the editor (format v${version}; ` +
        `this build reads up to v${target}). Please update to open it.`,
    );
  }

  let cur = raw;
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new SaveVersionError(`No migration path from save format v${version}.`);
    }
    // Copy before stamping: a migration may return its input object, and the engine
    // must never write into data the caller still holds.
    cur = { ...step.migrate(cur) };
    cur.version = ++version; // each migration advances exactly one version
  }
  return cur;
}
