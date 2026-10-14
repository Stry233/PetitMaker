// Settings, Local data: the full reset over the page's one autosave (`io/storage/local-reset.ts`).
import { resetAllLocalData } from '../../io/storage/local-reset';
import { autosave } from './autosave';

/** Wipes everything this origin keeps and reloads the page. */
export function resetLocalData(): Promise<void> {
  return resetAllLocalData(autosave);
}
