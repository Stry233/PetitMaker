/**
 * Tool argument schemas as typed builders. One declaration yields the JSON Schema a provider is sent
 * (`toJsonSchema`), the argument type a handler reads (`Infer`), and the check every call passes
 * before its handler runs (`checkArgs`), so the three cannot disagree.
 *
 * JSON keyword order is part of the wire: a field emits `type`, `enum`, `minItems`, `maxItems`,
 * `items`, `minimum`, `maximum`, `properties`, `required`, `additionalProperties`, `description`, in
 * that order, and an object's properties keep their declaration order.
 */

type Json = Record<string, unknown>;
type Problem = string;

/** One argument: how it reads on the wire and how a value is checked against it. `R` marks a field
 *  the call must supply. */
export interface Field<T, R extends boolean = false> {
  readonly required: R;
  json(): Json;
  /** The accepted value, or the problem with it in model-facing English; `at` names the argument. */
  check(value: unknown, at: string): { ok: true; value: T } | { ok: false; problem: Problem };
}

type AnyField = Field<unknown, boolean>;
export type Shape = Record<string, AnyField>;

export type Infer<F> = F extends Field<infer T, boolean> ? T : never;

type RequiredKeys<S extends Shape> = { [K in keyof S]: S[K]['required'] extends true ? K : never }[keyof S];
type OptionalKeys<S extends Shape> = Exclude<keyof S, RequiredKeys<S>>;
type InferShape<S extends Shape> =
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> };

interface Described { description?: string }
interface Bounded extends Described { min?: number; max?: number }

const ok = <T>(value: T) => ({ ok: true as const, value });
const bad = (problem: Problem) => ({ ok: false as const, problem });

/** What a value looks like inside a problem sentence. */
function shown(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return String(value);
}

function withDescription(json: Json, opts?: Described): Json {
  return opts?.description !== undefined ? { ...json, description: opts.description } : json;
}

function numeric(type: 'integer' | 'number', opts?: Bounded): Field<number> {
  return {
    required: false,
    json: () => withDescription({
      type,
      ...(opts?.min !== undefined ? { minimum: opts.min } : {}),
      ...(opts?.max !== undefined ? { maximum: opts.max } : {}),
    }, opts),
    check(value, at) {
      // A numeric string or a fraction is refused, never coerced: the schema says what the call
      // means, and a silent rounding would build somewhere the model did not name.
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad(`${at} must be ${type === 'integer' ? 'an integer' : 'a number'}, got ${shown(value)}.`);
      if (type === 'integer' && !Number.isInteger(value)) return bad(`${at} must be a whole number, got ${value}.`);
      if (opts?.min !== undefined && value < opts.min) return bad(`${at} must be at least ${opts.min}, got ${value}.`);
      if (opts?.max !== undefined && value > opts.max) return bad(`${at} must be at most ${opts.max}, got ${value}.`);
      return ok(value);
    },
  };
}

export const int = (opts?: Bounded): Field<number> => numeric('integer', opts);
export const num = (opts?: Bounded): Field<number> => numeric('number', opts);

export function str(opts?: Described): Field<string> {
  return {
    required: false,
    json: () => withDescription({ type: 'string' }, opts),
    check: (value, at) => (typeof value === 'string' ? ok(value) : bad(`${at} must be a string, got ${shown(value)}.`)),
  };
}

export function bool(opts?: Described): Field<boolean> {
  return {
    required: false,
    json: () => withDescription({ type: 'boolean' }, opts),
    check: (value, at) => (typeof value === 'boolean' ? ok(value) : bad(`${at} must be true or false, got ${shown(value)}.`)),
  };
}

type Literal = string | number | null;

/**
 * One of a fixed set of values. `values` may be a function, read each time the schema is emitted or
 * a call is checked, for a set that comes from data registered after this module loads.
 */
export function oneOf<const V extends Literal>(values: readonly V[] | (() => readonly V[]), opts?: Described): Field<V> {
  const read = (): readonly V[] => (typeof values === 'function' ? values() : values);
  return {
    required: false,
    json() {
      const vs = read();
      const types = [...new Set(vs.map((v) => (v === null ? 'null' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : 'string')))];
      return withDescription({ type: types.length === 1 ? types[0] : types, enum: [...vs] }, opts);
    },
    check(value, at) {
      const vs = read();
      return (vs as readonly unknown[]).includes(value)
        ? ok(value as V)
        : bad(`${at} must be one of ${vs.map(String).join(', ')}, got ${shown(value)}.`);
    },
  };
}

interface ListOpts extends Described { minItems?: number; maxItems?: number }

export function list<F extends AnyField>(item: F, opts?: ListOpts): Field<Infer<F>[]> {
  return {
    required: false,
    json: () => withDescription({
      type: 'array',
      ...(opts?.minItems !== undefined ? { minItems: opts.minItems } : {}),
      ...(opts?.maxItems !== undefined ? { maxItems: opts.maxItems } : {}),
      items: item.json(),
    }, opts),
    check(value, at) {
      if (!Array.isArray(value)) return bad(`${at} must be an array, got ${shown(value)}.`);
      if (opts?.minItems !== undefined && value.length < opts.minItems) return bad(`${at} needs at least ${opts.minItems} item(s), got ${value.length}.`);
      if (opts?.maxItems !== undefined && value.length > opts.maxItems) return bad(`${at} takes at most ${opts.maxItems} item(s), got ${value.length}.`);
      const out: Infer<F>[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = item.check(value[i], `${at}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value as Infer<F>);
      }
      return ok(out);
    },
  };
}

interface ObjOpts extends Described {
  /** Refuse argument names the shape does not declare (`additionalProperties: false`). */
  closed?: boolean;
}

export interface ObjField<S extends Shape> extends Field<InferShape<S>> {
  readonly shape: S;
}

/**
 * An object of named fields; a field is optional unless wrapped in `req`. An optional field sent as
 * null reads as absent, since some providers fill every unused optional with null; a field whose
 * own values include null keeps it.
 */
export function obj<S extends Shape>(shape: S, opts?: ObjOpts): ObjField<S> {
  const required = Object.keys(shape).filter((k) => shape[k]!.required);
  return {
    required: false,
    shape,
    json: () => withDescription({
      type: 'object',
      properties: Object.fromEntries(Object.entries(shape).map(([k, f]) => [k, f.json()])),
      ...(required.length > 0 ? { required } : {}),
      ...(opts?.closed ? { additionalProperties: false } : {}),
    }, opts),
    check(value, at) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad(`${at === '' ? 'the arguments' : at} must be an object, got ${shown(value)}.`);
      const input = value as Json;
      const out: Json = {};
      const prefix = at === '' ? '' : `${at}.`;
      for (const [key, field] of Object.entries(shape)) {
        const v = input[key];
        if (v === undefined || (v === null && !field.check(null, key).ok)) {
          if (field.required) return bad(`${prefix}${key} is required.`);
          continue;
        }
        const r = field.check(v, `${prefix}${key}`);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      for (const key of Object.keys(input)) {
        if (key in shape) continue;
        if (opts?.closed) return bad(`${prefix}${key} is not an argument of this tool.`);
        // An open object passes undeclared names through untouched for the handler to ignore.
        out[key] = input[key];
      }
      return ok(out as InferShape<S>);
    },
  };
}

/** Marks a field the call must supply. */
export function req<T>(field: Field<T>): Field<T, true> {
  return { ...field, required: true };
}

/** Any object schema, whatever its fields. */
export type AnyObjField = ObjField<Shape>;

export function toJsonSchema(field: AnyField): Json {
  return field.json();
}

/** A tool call's arguments checked against its schema: the accepted arguments (optional nulls
 *  dropped), or the first problem found. */
export function checkArgs<S extends Shape>(schema: ObjField<S>, value: unknown): { ok: true; value: InferShape<S> } | { ok: false; problem: Problem } {
  return schema.check(value ?? {}, '');
}
