import { describe, expect, it } from 'vitest';
import { clampNotes, NOTE_LIMITS } from '../../../core/model/notes';

describe('clampNotes', () => {
  it('keeps a title of 48 and a description of 200 characters, counting code points', () => {
    expect(NOTE_LIMITS).toEqual({ title: 48, description: 200 });
    const title = '🌱'.repeat(50), description = '谷'.repeat(230);
    const notes = clampNotes({ title, description });
    expect([...notes!.title!].length).toBe(48);
    expect([...notes!.description!].length).toBe(200);
  });

  it('trims surrounding whitespace, drops blank fields and answers undefined when nothing remains', () => {
    expect(clampNotes({ title: '  River garden ', description: '   ' })).toEqual({ title: 'River garden' });
    expect(clampNotes({ title: '', description: '' })).toBeUndefined();
    expect(clampNotes(undefined)).toBeUndefined();
  });

  it('accepts only strings and ignores fields the format no longer carries', () => {
    expect(clampNotes({ title: 12, description: 'ok', author: 'someone' } as unknown as Record<string, unknown>)).toEqual({ description: 'ok' });
  });
});
