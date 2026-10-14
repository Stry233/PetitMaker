/**
 * Module state is a cache keyed by its source, one page-wide registration, or the one live instance
 * of a page-wide mechanism. Every module-level `let` or `var` in `src/` outside the tests is listed in
 * `module-state-allowlist.json` under its repository path, with its kind and the file's reason, so a new one is
 * a reviewed decision and a removed one comes off the list. So is every module-level `const` holding
 * a mutable collection (`new Map`, `Set`, `WeakMap`, `WeakSet`, an empty array) its own file writes
 * to, every module-level class instance (`new X(…)`, a value class in `STATELESS` aside) and every
 * module-level factory result (`create(…)`, `createX(…)`, a signal or a store among them). A
 * collection built from a source and never written in its file is a lookup table, not state; a write
 * through another name or another file is not seen.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { parseSource, sourceFiles, srcRelative } from '../_support/source-graph';
import ALLOWLIST from './module-state-allowlist.json';

type Kind = 'cache' | 'registration' | 'page';
interface Entry { reason: string; names: Record<string, Kind> }
const KINDS = Object.keys(ALLOWLIST.kinds) as Kind[];
const LISTED = ALLOWLIST.files as Record<string, Entry>;

/** Collections and value objects: state only when their own file changes them in place. */
const COLLECTIONS = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'DataView', 'Float32Array', 'Float64Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Uint8ClampedArray', 'Vector2', 'Vector3', 'Matrix', 'Matrix4', 'Color', 'Euler', 'Quaternion',
]);
/** Classes whose instances hold nothing a caller can change: codecs, patterns and parsed values. */
const STATELESS = new Set(['TextEncoder', 'TextDecoder', 'RegExp', 'URL', 'Error', 'TypeError', 'RangeError']);
/** A factory call: its result is state as made. A React context is an identity, not state. */
const FACTORY = /^create(?!Context$)(?:[A-Z]\w*)?$/;

/** The name a `new` or a call is made through: `X` of `new X()`, `Intl.Collator` as `Collator`. */
const calleeName = (e: ts.Expression): string | null =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
const MUTATORS = new Set(['set', 'add', 'delete', 'clear', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) || ts.isTypeAssertionExpression(e) ? unwrap(e.expression) : e;

/** Whether `init` makes a value that module code can change in place: a collection (state only
 *  when its file writes it), or an instance or factory result (state as made). */
function mutableInit(init: ts.Expression): 'collection' | 'instance' | null {
  const e = unwrap(init);
  if (ts.isArrayLiteralExpression(e) && e.elements.length === 0) return 'collection';
  if (ts.isNewExpression(e)) {
    const name = calleeName(e.expression);
    if (name !== null && COLLECTIONS.has(name)) return 'collection';
    const intl = ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) && e.expression.expression.text === 'Intl';
    return name !== null && (STATELESS.has(name) || intl) ? null : 'instance';
  }
  if (ts.isCallExpression(e)) {
    const name = calleeName(e.expression);
    if (name !== null && FACTORY.test(name)) return 'instance';
  }
  return null;
}

/** The names `source` changes in place: a mutator called on it, or an element or `length` assigned. */
function writtenNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && MUTATORS.has(node.expression.name.text)) names.add(node.expression.expression.text);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if ((ts.isElementAccessExpression(left) || ts.isPropertyAccessExpression(left)) && ts.isIdentifier(left.expression)
        && (ts.isElementAccessExpression(left) || left.name.text === 'length')) names.add(left.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** The names a source declares as module state at its top level. */
function moduleState(path: string, text?: string): string[] {
  const source = parseSource(path, text);
  let written: Set<string> | undefined;
  const names: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const scope = statement.declarationList.flags & ts.NodeFlags.BlockScoped;
    if (scope === ts.NodeFlags.Using || scope === ts.NodeFlags.AwaitUsing) continue;
    if (scope === ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const made = mutableInit(declaration.initializer);
        if (made === 'instance' || (made === 'collection' && (written ??= writtenNames(source)).has(declaration.name.text))) names.push(declaration.name.text);
      }
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const visit = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) names.push(name.text);
        else for (const element of name.elements) if (!ts.isOmittedExpression(element)) visit(element.name);
      };
      visit(declaration.name);
    }
  }
  return names;
}

const found = new Map<string, string[]>(sourceFiles().map((file) => [`src/${srcRelative(file)}`, moduleState(file)] as const).filter(([, names]) => names.length > 0));

describe('module state', () => {
  it('lists every module-level state name with its kind', () => {
    const unlisted = [...found].flatMap(([file, names]) => names.filter((name) => !(name in (LISTED[file]?.names ?? {}))).map((name) => `${file}: ${name}`));
    expect(unlisted).toEqual([]);
  });

  it('lists only names that still exist', () => {
    const stale = Object.entries(LISTED).flatMap(([file, entry]) =>
      Object.keys(entry.names).filter((name) => !(found.get(file) ?? []).includes(name)).map((name) => `${file}: ${name}`));
    expect(stale).toEqual([]);
  });

  it('gives each listed file a reason and each name a known kind', () => {
    const bad = Object.entries(LISTED).filter(([, entry]) =>
      entry.reason.trim().length < 20 || Object.values(entry.names).some((kind) => !KINDS.includes(kind))).map(([file]) => file);
    expect(bad).toEqual([]);
  });

  it('reads top-level let and var, destructured names included, and leaves plain const and nested lets alone', () => {
    const text = 'let a = 0;\nvar b;\nlet { c, d: [e] } = f();\nconst g = 1;\nfunction h() { let i = 0; return i; }\n';
    expect(moduleState('example.ts', text)).toEqual(['a', 'b', 'c', 'e']);
  });

  it('reads a const collection its file writes, every instance and factory result, and leaves read-only tables and value classes alone', () => {
    const text = [
      'const cache = new Map<string, number>();', 'const seen = new Set() as Set<string>;', 'const queue: number[] = [];',
      'const table = new Map([[1, 2]]);', 'const EMPTY = new Set<string>();', 'const changed = createSignal();',
      'const rows = [1, 2];', 'export function f(k: string) { cache.set(k, 1); seen.add(k); queue[0] = 1; return table.get(1) ?? EMPTY.size + rows.length; }',
      'const sessions = new CurveSessions();', 'const useStore = create(() => ({}));', 'const lease = createLease(1);',
      'const encoder = new TextEncoder();', 'const collator = new Intl.Collator();', 'const make = createLease;', 'const crate = created();',
      'const Ctx = createContext(0);', 'const UP = new THREE.Vector3(0, 1, 0);',
    ].join('\n');
    expect(moduleState('example.ts', text)).toEqual(['cache', 'seen', 'queue', 'changed', 'sessions', 'useStore', 'lease']);
  });
});
