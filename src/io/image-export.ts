/**
 * Image export & download utilities for the editor.
 *
 * Provides helpers for downloading Blobs and JSON strings. Map captures go
 * through `host.capture2d` (the tightly-framed, chrome-free path).
 */

/**
 * Trigger a browser download for an arbitrary Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Decode a `data:` URL into a Blob WITHOUT fetch(). The CSP's `connect-src`
 * forbids fetching `data:` URLs, so a canvas capture (a `data:image/png;base64,…`)
 * can't be turned into a Blob via `fetch(url).blob()` — that throws a CSP error.
 * Parse the payload directly instead.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (/;base64/i.test(head)) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

/**
 * Download a JSON string as a `.json` file.
 */
export function downloadJSON(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, filename);
}
