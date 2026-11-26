// Tests run on sequential ids: every id is new, carries its prefix, and the same calls mint the same
// ids on every run.
import { describe, it, expect, vi } from 'vitest';
import { generateId, generateObjectId, generateRecordId } from '../../../core/model/object-id';

describe('object ids under test', () => {
  it('are sequential, distinct and prefixed', () => {
    const a = generateObjectId(), b = generateObjectId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^seq[0-9a-z]+$/);
    expect(parseInt(b.slice(3), 36)).toBe(parseInt(a.slice(3), 36) + 1);
    expect(generateId('an')).toMatch(/^anseq[0-9a-z]+$/);
  });
});

describe('record ids', () => {
  it('follow the sequential ids under test', () => {
    const a = generateRecordId('b'), b = generateRecordId('b');
    expect(a).toMatch(/^bseq[0-9a-z]+$/);
    expect(b).not.toBe(a);
  });

  it('are random UUIDs in the editor, where the platform has them', async () => {
    vi.resetModules();
    const fresh = await import('../../../core/model/object-id');
    expect(fresh.generateRecordId('b')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.resetModules();
  });
});
