import { MAX_IMPORT_BYTES } from '../save/limits';

/** `Blob.arrayBuffer` and `Blob.text` where the engine has them, `FileReader` where it predates them. */
export function readBlob(blob: Blob, as: 'bytes'): Promise<ArrayBuffer>;
export function readBlob(blob: Blob, as: 'text'): Promise<string>;
export function readBlob(blob: Blob, as: 'bytes' | 'text'): Promise<ArrayBuffer | string> {
  if (as === 'bytes' && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  if (as === 'text' && typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer | string);
    reader.onerror = () => reject(reader.error);
    if (as === 'bytes') reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });
}

/** An imported file's text, or null for a file past the import limit, which is never read. */
export async function readImportText(blob: Blob): Promise<string | null> {
  return blob.size > MAX_IMPORT_BYTES ? null : readBlob(blob, 'text');
}
