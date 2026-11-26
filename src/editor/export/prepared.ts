/**
 * Export choices made outside the save-and-share window, for the panels that show them. The picture's
 * choices are the remembered ones (`io/export/options-store.ts`); the file's are held here until its
 * panel takes them. An open panel hears the revision move and reads again.
 */
import { rememberExportOptions } from '../../io/export/options-store';
import type { JsonSections } from '../../io/export/json-sections';
import type { ExportOptions } from '../../io/export/types';

type FileExportChoices = Partial<JsonSections>;

let revision = 0;
let fileChoices: FileExportChoices | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  revision += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribePreparedExport(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Moves each time choices are prepared. */
export const preparedExportRevision = (): number => revision;

/** Remembers `options` as the picture's choices, so its panel opens on them. */
export function prepareImageExport(options: ExportOptions): void {
  rememberExportOptions(options);
  publish();
}

/** Leaves `choices` for the file panel, over any left before. */
export function prepareFileExport(choices: FileExportChoices): void {
  fileChoices = { ...fileChoices, ...choices };
  publish();
}

/** The file choices left waiting, cleared as they are taken. */
export function takePreparedFileChoices(): FileExportChoices | null {
  const taken = fileChoices;
  fileChoices = null;
  return taken;
}
