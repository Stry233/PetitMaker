/**
 * `spec(id, title, fn)` declares a test that proves one requirement of `docs/spec/`: its title opens
 * with `[<id>]`, which the coverage report reads, and an id the catalogue lacks fails at once.
 */
import { it } from 'vitest';
import { readCatalogue } from './spec-catalogue';

function known(id: string): void {
  const requirement = readCatalogue().requirements.get(id);
  if (!requirement) throw new Error(`${id} is no requirement of docs/spec/; add it there first`);
  if (requirement.retired) throw new Error(`${id} is retired in docs/spec/${requirement.area}.md`);
}

export function spec(id: string, title: string, fn: () => unknown, timeout?: number): void {
  known(id);
  it(`[${id}] ${title}`, fn, timeout);
}
