import { describe, it, expect } from 'vitest';
import { migrateToCurrent, SaveVersionError } from '../../../io/save-format/migrate';
import { MIGRATIONS } from '../../../io/save-format/migrations';
import { CURRENT_VERSION, type Migration, type RawSave } from '../../../io/save-format/types';

/* Synthetic chains exercise the engine without touching the real format. */
const v1to2: Migration = { from: 1, description: 'add b', migrate: (r) => ({ ...r, b: 2 }) };
const v2to3: Migration = { from: 2, description: 'add c', migrate: (r) => ({ ...r, c: 3 }) };
const CHAIN = [v1to2, v2to3];

describe('migrateToCurrent (engine)', () => {
  it('lifts step by step through a multi-version chain', () => {
    const out = migrateToCurrent({ version: 1, a: 1 } as RawSave, CHAIN, 3);
    expect(out).toMatchObject({ version: 3, a: 1, b: 2, c: 3 });
  });

  it('treats a missing version as v1', () => {
    const out = migrateToCurrent({ a: 1 } as RawSave, CHAIN, 2);
    expect(out).toMatchObject({ version: 2, b: 2 });
    expect(out).not.toHaveProperty('c');
  });

  it('is identity when already at the target version', () => {
    const raw = { version: 3, done: true } as RawSave;
    const out = migrateToCurrent(raw, CHAIN, 3);
    expect(out).toBe(raw); // untouched, no migration applied
  });

  it('throws on a save newer than the target', () => {
    expect(() => migrateToCurrent({ version: 4 } as RawSave, CHAIN, 3)).toThrow(SaveVersionError);
  });

  it('throws when the chain has a gap', () => {
    expect(() => migrateToCurrent({ version: 1 } as RawSave, [v2to3], 3)).toThrow(
      /No migration path from save format v1/,
    );
  });

  it('throws on a non-object input', () => {
    expect(() => migrateToCurrent(null as unknown as RawSave, CHAIN, 3)).toThrow(SaveVersionError);
  });
});

describe('the real migration chain', () => {
  it('passes a current-version save through unchanged', () => {
    const raw = { version: CURRENT_VERSION, templateId: 'hexia', cells: '', objects: [] } as RawSave;
    expect(migrateToCurrent(raw)).toBe(raw);
  });

  it('is contiguous: exactly one migration per version below CURRENT_VERSION', () => {
    for (let v = 1; v < CURRENT_VERSION; v++) {
      expect(MIGRATIONS.filter((m) => m.from === v)).toHaveLength(1);
    }
    // No migration may target at or beyond the current version.
    expect(MIGRATIONS.every((m) => m.from < CURRENT_VERSION)).toBe(true);
  });
});
