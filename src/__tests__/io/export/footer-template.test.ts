import { describe, it, expect } from 'vitest';
import { parseFooter, serializeFooter, resolveFooter, DEFAULT_FOOTER, FOOTER_TOKENS } from '../../../io/export/footer-template';

const VALUES = { date: '2026-06-28', dims: '1600×1080', name: 'Hexia', layers: '6', objects: '3', title: '' };

describe('footer-template', () => {
  it('parse → serialize round-trips', () => {
    const t = '{name}{fill} {date} · {dims}';
    expect(serializeFooter(parseFooter(t))).toBe(t);
  });
  it('parses tokens and literal text in order', () => {
    expect(parseFooter('{date} · {dims}')).toEqual([
      { t: 'token', id: 'date' }, { t: 'text', v: ' · ' }, { t: 'token', id: 'dims' },
    ]);
  });
  it('default footer puts date left, dims right (no separator)', () => {
    const { left, right } = resolveFooter(DEFAULT_FOOTER, VALUES);
    expect(left).toBe('2026-06-28');
    expect(right).toBe('1600×1080');
  });
  it('fill splits left/right; everything before is left, after is right', () => {
    const { left, right } = resolveFooter('{name}{fill}{date} · {dims}', VALUES);
    expect(left).toBe('Hexia');
    expect(right).toBe('2026-06-28 · 1600×1080');
  });
  it('no fill → all left', () => {
    const { left, right } = resolveFooter('{name} {date}', VALUES);
    expect(left).toBe('Hexia 2026-06-28');
    expect(right).toBe('');
  });
  it('empty/unknown token values drop out', () => {
    const { left } = resolveFooter('{title}{name}', VALUES); // title is empty
    expect(left).toBe('Hexia');
  });
  it('serialize strips stray braces from literal text', () => {
    expect(serializeFooter([{ t: 'text', v: 'a{b}c' }])).toBe('abc');
  });
});

describe('footer ai/proc tokens (value-only)', () => {
  it('lists ai and proc tokens in the picker', () => {
    const ids = FOOTER_TOKENS.map(t => t.id);
    expect(ids).toContain('ai');
    expect(ids).toContain('proc');
  });
  it('resolves to value-only and drops empties', () => {
    const r = resolveFooter('AI {ai}{fill}Proc {proc}', { ai: '23%', proc: '' });
    expect(r.left).toBe('AI 23%');
    expect(r.right).toBe('Proc'); // empty proc value leaves just the user label, trimmed
  });
});
