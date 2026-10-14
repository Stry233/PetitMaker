import { describe, it, expect } from 'vitest';
import { bool, checkArgs, int, list, num, obj, oneOf, req, str, toJsonSchema } from '../../../agent/tools/schema';

const point = obj({ x: req(int()), y: req(int()) });
const schema = obj({
  id: req(str()),
  count: int({ min: 1, max: 5 }),
  weight: num({ min: 0, max: 1 }),
  flag: bool(),
  kind: oneOf(['a', 'b']),
  tag: oneOf(['t', null]),
  points: list(point, { minItems: 2 }),
});

const problem = (value: unknown): string | null => {
  const r = checkArgs(schema, value);
  return r.ok ? null : r.problem;
};

describe('tool argument schemas', () => {
  it('emit JSON Schema keywords in wire order and list only nonempty required', () => {
    expect(JSON.stringify(toJsonSchema(obj({ n: int({ max: 3, min: 1, description: 'd' }) })))).toBe(
      '{"type":"object","properties":{"n":{"type":"integer","minimum":1,"maximum":3,"description":"d"}}}',
    );
    expect(toJsonSchema(list(str(), { maxItems: 4, minItems: 1 }))).toEqual({ type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } });
    expect(toJsonSchema(oneOf(['x', null]))).toEqual({ type: ['string', 'null'], enum: ['x', null] });
    expect(toJsonSchema(oneOf([0, 90]))).toEqual({ type: 'integer', enum: [0, 90] });
    expect(toJsonSchema(obj({ a: req(str()) }, { closed: true }))).toEqual({
      type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false,
    });
  });

  it('accept a well-formed call and drop optional nulls', () => {
    const r = checkArgs(schema, { id: 'o1', count: 3, weight: 0.5, flag: true, kind: 'a', tag: null, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], extra: 1 });
    expect(r).toEqual({ ok: true, value: { id: 'o1', count: 3, weight: 0.5, flag: true, kind: 'a', tag: null, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], extra: 1 } });
    expect(checkArgs(schema, { id: 'o1', count: null, kind: null })).toEqual({ ok: true, value: { id: 'o1' } });
  });

  it('refuse numeric strings, fractions, out-of-range numbers and off-list values without coercing', () => {
    expect(problem({ id: 'o', count: '3' })).toBe('count must be an integer, got "3".');
    expect(problem({ id: 'o', count: 2.5 })).toBe('count must be a whole number, got 2.5.');
    expect(problem({ id: 'o', count: 9 })).toBe('count must be at most 5, got 9.');
    expect(problem({ id: 'o', weight: -1 })).toBe('weight must be at least 0, got -1.');
    expect(problem({ id: 'o', flag: 'yes' })).toBe('flag must be true or false, got "yes".');
    expect(problem({ id: 'o', kind: 'c' })).toBe('kind must be one of a, b, got "c".');
  });

  it('name the missing and the nested argument', () => {
    expect(problem({})).toBe('id is required.');
    expect(problem({ id: null })).toBe('id is required.');
    expect(problem({ id: 'o', points: [{ x: 1, y: 2 }] })).toBe('points needs at least 2 item(s), got 1.');
    expect(problem({ id: 'o', points: [{ x: 1, y: 2 }, { x: 1 }] })).toBe('points[1].y is required.');
    expect(problem([])).toBe('the arguments must be an object, got an array.');
  });

  it('a closed object refuses an undeclared argument', () => {
    const closed = obj({ a: str() }, { closed: true });
    expect(checkArgs(closed, { b: 1 })).toEqual({ ok: false, problem: 'b is not an argument of this tool.' });
  });

  it('a lazy value set is read at check time', () => {
    const values = ['first'];
    const field = obj({ v: oneOf(() => values) });
    values.push('later');
    expect(checkArgs(field, { v: 'later' }).ok).toBe(true);
    expect(toJsonSchema(field)).toEqual({ type: 'object', properties: { v: { type: 'string', enum: ['first', 'later'] } } });
  });
});
