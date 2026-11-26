/** One read per JSON file per page, by URL, served from the HTTP cache where it holds the file. */
const reads = new Map<string, Promise<unknown>>();

/**
 * The parsed JSON at `url`, read once and shared by every caller. A file that does not arrive (the
 * network, a refused status, a body that does not parse) answers null and is forgotten, so the next
 * call reads again. Never rejects.
 */
export function readJsonOnce(url: string): Promise<unknown> {
  let read = reads.get(url);
  if (!read) {
    read = fetch(url, { cache: 'force-cache' })
      .then((response) => (response.ok ? response.json() as Promise<unknown> : null))
      .catch(() => null)
      .then((value) => { if (value === null) reads.delete(url); return value; });
    reads.set(url, read);
  }
  return read;
}

/** Test-only: forget every read. */
export function __resetJsonReads(): void {
  reads.clear();
}
