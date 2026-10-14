/**
 * The generator promises that one (seed, config) produces one map: a seed retyped into the shelf
 * regenerates the same planet. A map that depended on the clock, `Math.random`, module state left by
 * an earlier run or anything else a process carries would break that, so the same matrix is run
 * twice here and once in each of two fresh processes, and every digest must agree.
 *
 * The maps are also frozen across code changes: the digests are held against the golden fixture
 * recorded for `GENERATOR_VERSION`, so a refactor that moves a generated map fails here. A change
 * meant to move them bumps the version and rewrites the fixture from
 * `npx vite-node src/__tests__/tools/generation/_print-generation-digests.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { DIGEST_CONFIGS, generationDigests } from './_generation-digest';
import { GENERATOR_VERSION } from '../../../tools/generation/recipe';
import GOLDEN from '../../fixtures/generation/golden-digests.json';

// Two fresh processes start a module runner each and generate the whole matrix.
vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const PRINTER = 'src/__tests__/tools/generation/_print-generation-digests.ts';

/** The digests a fresh process computes. */
function digestsInProcess(): Promise<Record<string, string>> {
  return new Promise((done, fail) => {
    execFile(resolve(ROOT, 'node_modules/.bin/vite-node'), [PRINTER], { cwd: ROOT, maxBuffer: 1 << 24 }, (error: Error | null, stdout: string, stderr: string) => {
      if (error) { fail(new Error(`${error.message}\n${stderr}`)); return; }
      done(JSON.parse(stdout.trim().split('\n').pop()!) as Record<string, string>);
    });
  });
}

/** This process's digests, computed once for both cases. */
let mine: Record<string, string> | null = null;
const digests = (): Record<string, string> => (mine ??= generationDigests());

describe('one seed, one map', () => {
  it('generates the same map for every matrix entry in this process and in two fresh ones', async () => {
    const others = Promise.all([digestsInProcess(), digestsInProcess()]);
    const first = digests();
    const second = generationDigests();
    const [a, b] = await others;
    expect(Object.keys(first)).toEqual(DIGEST_CONFIGS.map(([label]) => label));
    expect(second, 'a second run in this process').toEqual(first);
    expect(a, 'a fresh process').toEqual(first);
    expect(b, 'another fresh process').toEqual(first);
    expect(new Set(Object.values(first)).size, 'distinct entries give distinct maps').toBe(DIGEST_CONFIGS.length);
  });
});

describe('one recipe version, one map', () => {
  it('records the golden digests for the current generator version', () => {
    expect(GOLDEN.generatorVersion, 'GENERATOR_VERSION moved: rewrite the golden fixture with the printer').toBe(GENERATOR_VERSION);
  });

  it('generates the golden map for every matrix entry', () => {
    expect(digests(), 'a generated map moved: bump GENERATOR_VERSION and rewrite the golden fixture, or keep the output').toEqual(GOLDEN.digests);
  });
});
