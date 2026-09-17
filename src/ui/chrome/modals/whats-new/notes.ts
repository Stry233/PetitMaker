/** The bundled changelog sliced into the release notes a returning browser has not read. */

export interface ReleaseNotes {
  /** `unreleased` until `notesSince` stands the current build in for it. */
  version: string;
  heading: string;
  /** The Markdown under the heading. */
  body: string;
}

const UNRELEASED = /^\[?(Unreleased|未发布)\]?/i;

/** Every `## ` section of the changelog in file order, which is newest first; the preamble is dropped. */
export function releaseSections(markdown: string): ReleaseNotes[] {
  return markdown.split(/^## /m).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = nl === -1 ? '' : part.slice(nl + 1).trim();
    const numbered = /^\[?v?(\d+\.\d+\.\d+)/.exec(heading);
    const version = UNRELEASED.test(heading) ? 'unreleased' : numbered ? numbered[1]! : heading;
    return { version, heading, body };
  });
}

/** Numeric order on `major.minor.patch`; a `-dev` suffix does not count. */
export function compareVersions(a: string, b: string): number {
  const nums = (v: string) => v.replace(/-.*$/, '').split('.').map((n) => Number(n) || 0);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A section says something only when it lists an item; a placeholder line alone does not. */
function hasNotes(body: string): boolean {
  return body.split('\n').some((line) => /^[-*] /.test(line.trim()));
}

/**
 * The sections newer than the version this browser last saw, newest first. The unreleased section
 * stands for the current build. With no version on record only the newest section is owed.
 */
export function notesSince(markdown: string, lastSeen: string | null, current: string): ReleaseNotes[] {
  const sections = releaseSections(markdown)
    .map((s) => (s.version === 'unreleased' ? { ...s, version: current, heading: current } : s))
    .filter((s) => hasNotes(s.body));
  if (lastSeen === null) return sections.slice(0, 1);
  return sections.filter((s) => compareVersions(s.version, lastSeen) > 0);
}

/** Whether the window opens: a returning browser, a version it has not seen, and notes to show. */
export function whatsNewDue(f: { returning: boolean; lastSeen: string | null; current: string; notes: ReleaseNotes[] }): boolean {
  return f.returning && f.lastSeen !== f.current && f.notes.length > 0;
}
