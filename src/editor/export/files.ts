// The files the editor hands out and takes back that are not maps: a 3D still and the keymap.
import { downloadBlob, exportFileName } from '../../io/export/download';
import { readImportText } from '../../io/import/read-blob';
import { dataUrlToBlob } from '../../platform/remote/data-url';
import { parseKeybinds, serializeKeybinds } from '../../state/keymap/file';
import type { Overrides } from '../../state/keymap/resolve';

/** Downloads a captured 3D view, given as a data URL. */
export function downloadView3d(dataUrl: string): void {
  downloadBlob(dataUrlToBlob(dataUrl), exportFileName(['3d', Date.now()], 'png'));
}

/** Downloads the keymap overrides as a keybinds file. */
export function downloadKeymap(overrides: Overrides): void {
  downloadBlob(new Blob([serializeKeybinds(overrides)], { type: 'application/json' }), exportFileName(['keybinds'], 'json'));
}

/** A keybinds file as the keymap reads it; refused when the file cannot be read as text. */
export async function readKeymapFile(file: Blob): Promise<ReturnType<typeof parseKeybinds> | { ok: false }> {
  const text = await readImportText(file);
  return text === null ? { ok: false } : parseKeybinds(text);
}
