import { describe, it, expect } from 'vitest';
import { boundedMap } from '../../../core/base/bounded-map';

describe('a bounded map', () => {
  it('drops the entry set longest ago when a new key arrives while full', () => {
    const map = boundedMap<string, number>(2);
    map.set('a', 1).set('b', 2).set('c', 3);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });

  it('replaces a held key in place without dropping another', () => {
    const map = boundedMap<string, number>(2);
    map.set('a', 1).set('b', 2).set('a', 9);
    expect([...map.entries()]).toEqual([['a', 9], ['b', 2]]);
  });

  it('keeps a touched entry over one set after it', () => {
    const map = boundedMap<string, number>(2);
    map.set('a', 1).set('b', 2);
    expect(map.touch('a')).toBe(1);
    map.set('c', 3);
    expect([...map.keys()]).toEqual(['a', 'c']);
    expect(map.touch('missing')).toBeUndefined();
  });
});
