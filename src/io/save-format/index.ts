// Barrel: the versioned save-format surface.
export { CURRENT_VERSION, type SaveFile, type SaveObject, type RawSave, type Migration, type MapNotes, type PersistedCamera } from './types';
export { migrateToCurrent, SaveVersionError } from './migrate';
