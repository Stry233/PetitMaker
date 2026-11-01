/**
 * The behaviour specification in `docs/spec/`, read as data. A requirement is one line,
 * `- **<ID>** <text>`, in its area's file; a test cites it by opening its title with `[<ID>]`.
 * Pure Node (no Vitest), so the coverage report reads the same catalogue the tests do.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const SPEC_DIR = join(REPO_ROOT, 'docs', 'spec');

/** Each area's file and the id prefix its requirements carry; rules are named by their rule id. A
 *  branch writes a new numbered requirement as `<PREFIX>-NEW-<NAME>`, numbered when it merges
 *  (`scripts/internal/guards/number-spec-ids.mts`), so parallel branches never take the same number. */
export const AREAS = {
  rules: /^V-[A-Z]+(?:-[A-Z0-9]+)*$/,
  editing: /^EDIT-(?:\d{2}|NEW-[A-Z0-9-]+)$/,
  files: /^FILE-(?:\d{2}|NEW-[A-Z0-9-]+)$/,
  planets: /^PLAN-(?:\d{2}|NEW-[A-Z0-9-]+)$/,
  generation: /^GEN-(?:\d{2}|NEW-[A-Z0-9-]+)$/,
  interface: /^UI-(?:\d{2}|NEW-[A-Z0-9-]+)$/,
  assistant: /^ASST-(?:\d{2}|NEW-[A-Z0-9-]+)$/,
} as const;
export type Area = keyof typeof AREAS;

export interface Requirement {
  readonly id: string;
  readonly area: Area;
  readonly text: string;
  readonly retired: boolean;
  readonly line: number;
}

export interface Catalogue {
  readonly requirements: ReadonlyMap<string, Requirement>;
  /** Lines that open like a requirement but break the grammar, or repeat an id, as `file:line: reason`. */
  readonly problems: readonly string[];
}

const REQUIREMENT = /^- \*\*([^*]+)\*\* (\S.*)$/;
const RETIRED = /^\(retired \d{4}-\d{2}-\d{2}\)/;

let cached: Catalogue | undefined;

/** Parses every area file once per process. */
export function readCatalogue(): Catalogue {
  if (cached) return cached;
  const requirements = new Map<string, Requirement>();
  const problems: string[] = [];
  for (const area of Object.keys(AREAS) as Area[]) {
    const file = join(SPEC_DIR, `${area}.md`);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      problems.push(`docs/spec/${area}.md: missing`);
      continue;
    }
    text.split('\n').forEach((raw, i) => {
      if (!raw.startsWith('- **')) return;
      const at = `docs/spec/${area}.md:${i + 1}`;
      const m = REQUIREMENT.exec(raw);
      if (!m) { problems.push(`${at}: not "- **<ID>** <text>"`); return; }
      const [, id, body] = m as unknown as [string, string, string];
      if (!AREAS[area].test(id)) { problems.push(`${at}: ${id} is not an id of ${area}`); return; }
      if (requirements.has(id)) { problems.push(`${at}: ${id} repeats`); return; }
      requirements.set(id, { id, area, text: body, retired: RETIRED.test(body), line: i + 1 });
    });
  }
  cached = { requirements, problems };
  return cached;
}

/** The requirement ids a test file cites: a bracketed list opening a test title, or `spec('<ID>', ...)`. */
export function citedIds(source: string): string[] {
  const ids: string[] = [];
  for (const m of source.matchAll(/\b(?:it|test)(?:\.(?:each\([^)]*\)|only|skip|todo|concurrent))?\(\s*['"`]\[([A-Z][A-Z0-9, -]*)\]/g)) {
    ids.push(...m[1]!.split(/[,\s]+/).filter(Boolean));
  }
  for (const m of source.matchAll(/\bspec\(\s*['"]([A-Z][A-Z0-9-]*)['"]/g)) ids.push(m[1]!);
  return ids;
}

/** Every unit test file in the repository, as repository-relative paths. */
export function testFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.test\.(?:ts|tsx|mts)$/.test(name)) out.push(relative(REPO_ROOT, full).split('\\').join('/'));
    }
  };
  walk(join(REPO_ROOT, 'src'));
  walk(join(REPO_ROOT, 'scripts'));
  return out.sort();
}

/** Each cited id with the files citing it. */
export function citations(): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, string[]>();
  for (const file of testFiles()) {
    for (const id of new Set(citedIds(readFileSync(join(REPO_ROOT, file), 'utf8')))) {
      byId.set(id, [...(byId.get(id) ?? []), file]);
    }
  }
  return byId;
}
