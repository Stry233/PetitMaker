// Allocation bounds shared by every untrusted import path.

/** Objects a map cell can hold. `area * MAX_OBJECTS_PER_CELL` bounds an imported object list. */
export const MAX_OBJECTS_PER_CELL = 8;

/** Largest file byte length accepted for import. */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
