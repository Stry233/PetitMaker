import { describe, expect, it } from 'vitest';
import { parseArgs, parsePartial } from '../../../agent/core/json';

describe('partial json ladder', () => {
  it('parses complete json', () => {
    expect(parseArgs('{"x":1,"s":"a"}')).toEqual({ x: 1, s: 'a' });
  });
  it('repairs a truncated object by closing strings and brackets', () => {
    expect(parsePartial('{"x":1,"s":"ab')).toEqual({ x: 1, s: 'ab' });
    expect(parsePartial('{"pos":{"x":4,"y"')).toEqual({ pos: { x: 4 } });
    expect(parsePartial('{"items":[1,2')).toEqual({ items: [1, 2] });
  });
  it('drops a dangling key with no value', () => {
    expect(parsePartial('{"x":1,"y":')).toEqual({ x: 1 });
  });
  it('returns {} for garbage in parsePartial and undefined in parseArgs', () => {
    expect(parsePartial('not json')).toEqual({});
    expect(parseArgs('not json')).toBeUndefined();
    expect(parseArgs('')).toBeUndefined();
  });
  it('parseArgs accepts only objects, not arrays or scalars', () => {
    expect(parseArgs('[1,2]')).toBeUndefined();
    expect(parseArgs('42')).toBeUndefined();
  });
  it('a cut inside an escape keeps earlier keys', () => {
    expect(parsePartial('{"a":1,"x":"b\\')).toEqual({ a: 1, x: 'b' });
    expect(parsePartial('{"a":1,"x":"b\\u00')).toEqual({ a: 1, x: 'b' });
    expect(parsePartial('{"a":1,"x":"b\\"')).toEqual({ a: 1, x: 'b"' });
  });
});
