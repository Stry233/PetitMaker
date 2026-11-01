// Barrel: the versioned save-format surface.
export { CURRENT_VERSION, type SaveFile, type SaveObject, type RawSave, type PersistedCamera } from './types';
export { migrateToCurrent } from './migrate';
