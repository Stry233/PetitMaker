/** Every name the app persists under: each pref's localStorage key and each IndexedDB database. */
import { BROWSER_DATABASES, PREFS } from '../../platform/storage/prefs';

export const STORAGE_NAMES: readonly string[] = [...Object.values(PREFS).map((d) => d.key), ...Object.values(BROWSER_DATABASES)];
