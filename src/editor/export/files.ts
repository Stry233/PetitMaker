// The files the editor hands out and takes back that are not maps: a 3D still and the keymap.
import { CARD_3D_CELL_ASPECT } from '../../io/export/compose';
import { downloadBlob, downloadJSON, exportFileName } from '../../io/export/download';
import { readImportText } from '../../io/import/read-blob';
import { SUPPORTS_DOWNLOADS } from '../../platform/build/edition';
import { dataUrlToBlob } from '../../platform/remote/data-url';
import { parseKeybinds, serializeKeybinds } from '../../state/keymap/file';
import type { Overrides } from '../../state/keymap/resolve';
import { useEditorStore } from '../../state/store';

/** A 3D view that can be photographed: whole, or cropped to the largest centred box of an aspect
 *  (width over height); each a PNG data URL, empty when the view has no picture to give. */
interface View3dCapture {
  captureImage: () => string;
  captureFramed: (aspect: number) => string;
}

interface View3dExportHooks {
  /** The responsibility notice; resolves whether it was confirmed. A still carries no share code. */
  confirmNotice: (carriesCode: boolean) => Promise<boolean>;
}

/** Downloads a still of the 3D preview as it stands when asked, once the notice was confirmed: the
 *  slice an export shot takes while one is being set (`preview3DEdit`), else the whole view.
 *  Whether a file was written; none is in an edition without downloads. */
export async function exportView3d(view: View3dCapture, hooks: View3dExportHooks): Promise<boolean> {
  if (!SUPPORTS_DOWNLOADS) return false;
  const framed = useEditorStore.getState().preview3DEdit !== null;
  const url = framed ? view.captureFramed(CARD_3D_CELL_ASPECT) : view.captureImage();
  if (!url || !await hooks.confirmNotice(false)) return false;
  downloadBlob(dataUrlToBlob(url), exportFileName(['3d', Date.now()], 'png'));
  return true;
}

/** Downloads the keymap overrides as a keybinds file. */
export function downloadKeymap(overrides: Overrides): void {
  downloadJSON(serializeKeybinds(overrides), exportFileName(['keybinds'], 'json'));
}

/** A keybinds file as the keymap reads it; refused when the file cannot be read as text. */
export async function readKeymapFile(file: Blob): Promise<ReturnType<typeof parseKeybinds> | { ok: false }> {
  const text = await readImportText(file);
  return text === null ? { ok: false } : parseKeybinds(text);
}
