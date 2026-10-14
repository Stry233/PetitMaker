/** Export file names and the browser download of a finished Blob or JSON string. */

/** A file-name fragment: letters, digits, underscore and hyphen; a run of anything else becomes one hyphen. */
export function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'planet';
}

/** Every file the app hands out is named `petitmaker-<part>-<part>.<ext>`. */
export function exportFileName(parts: readonly (string | number)[], ext: string): string {
  return `${['petitmaker', ...parts].join('-')}.${ext}`;
}

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
 * Download a JSON string as a `.json` file.
 */
export function downloadJSON(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, filename);
}
