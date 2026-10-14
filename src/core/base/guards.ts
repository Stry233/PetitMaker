/*
 * Runtime checks for untrusted values (files, share codes, storage, model replies). Each guard
 * answers one question about a value of unknown type; the combinators build a check for a shape
 * out of them.
 */

/** A plain object: not null and not an array. */
export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === 'string';

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/** A number that is neither NaN nor infinite. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A whole number from 0 up to the largest safe integer. */
export const isSafeIndex = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** A yes or no answer about a value of unknown type. */
export type Check = (value: unknown) => boolean;

/** Absent, or passing `check`. */
export const optional = (check: Check): Check => (v) => v === undefined || check(v);

/** An array whose every element passes `check`. */
export const listOf = (check: Check): Check => (v) => Array.isArray(v) && v.every(check);

/** One of the given strings. */
const oneOf = (...values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v);

/** A record whose named fields each pass their check; other fields are ignored. */
export const shapeOf = (fields: Record<string, Check>): Check => (v) => isRecord(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

/** A record whose every value passes `check`. */
export const valuesOf = (check: Check): Check => (v) => isRecord(v) && Object.values(v).every(check);

/** A check for a string union, from a table keyed by every member so the type keeps it complete. */
export const member = <T extends string>(table: Record<T, true>): Check => oneOf(...Object.keys(table));
