/**
 * ui calls no store action after an `await`, in a `.then`, `.catch` or `.finally` callback, or in an
 * event-bus or subscription handler: such a write outlives the render whose intent asked for it, so it
 * belongs to an `editor` verb or the session's wiring. A store action is a call on
 * `useEditorStore.getState()`, on a handle bound to it (`const s = useEditorStore.getState()`,
 * `const store = () => useEditorStore.getState()`), `useEditorStore.setState`, or a function selected
 * or destructured from the store; a function of the same file or of another ui module that makes such
 * a call is one too.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import ts from 'typescript';
import { SRC, parseSource, resolveModule, sourceFiles, srcRelative } from '../_support/source-graph';

const STORE = 'useEditorStore';

const unwrap = (n: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) ? unwrap(n.expression) : n;
const isFunction = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
const isStoreCall = (n: ts.Expression, member?: string): n is ts.CallExpression =>
  ts.isCallExpression(n) && (member === undefined
    ? ts.isIdentifier(n.expression) && n.expression.text === STORE
    : ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === member
      && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === STORE);

/** The expression a function returns when its body is that one expression or one `return`. */
function returned(fn: ts.FunctionLikeDeclaration): ts.Expression | undefined {
  const body = fn.body;
  if (!body) return undefined;
  if (!ts.isBlock(body)) return body;
  const [only] = body.statements;
  return body.statements.length === 1 && only && ts.isReturnStatement(only) ? only.expression : undefined;
}

/** Whether `name` is a parameter of a function enclosing `at`, which shadows a handle of that name. */
function shadowed(at: ts.Node, name: string): boolean {
  for (let p = at.parent; p; p = p.parent) {
    if (isFunction(p) && p.parameters.some((param) => ts.isIdentifier(param.name) && param.name.text === name)) return true;
  }
  return false;
}

/**
 * Every late store write in `path`, as `line: callee (context)`, and the names of the functions it
 * exports that write the store. `writers` are names it imports from other ui modules that write it.
 */
function lateWrites(path: string, text?: string, writers: ReadonlySet<string> = new Set()): { found: string[]; exports: Set<string> } {
  const source = parseSource(path, text);
  const states = new Set<string>(); // bound to the store's state
  const handles = new Set<string>(); // functions returning the store's state
  const actions = new Set<string>(); // actions selected or destructured from the store
  const functions = new Map<string, ts.FunctionLikeDeclaration[]>();
  const exported = new Set<string>();
  const declare = (name: string, fn: ts.Node | undefined): void => {
    if (fn && isFunction(fn)) functions.set(name, [...(functions.get(name) ?? []), fn]);
  };

  const isState = (e: ts.Expression): boolean => {
    const n = unwrap(e);
    if (isStoreCall(n, 'getState')) return true;
    if (ts.isIdentifier(n)) return states.has(n.text) && !shadowed(n, n.text);
    return ts.isCallExpression(n) && n.arguments.length === 0 && ts.isIdentifier(n.expression)
      && handles.has(n.expression.text) && !shadowed(n, n.expression.text);
  };

  const bind = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isIdentifier(node.name)) {
        const name = node.name.text;
        if (isState(init)) states.add(name);
        if (isStoreCall(init)) actions.add(name);
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.parameters.length === 0) {
          const out = returned(init);
          if (out && isState(out)) handles.add(name);
        }
        declare(name, init);
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'useCallback') declare(name, init.arguments[0]);
        if (ts.isVariableStatement(node.parent.parent) && node.parent.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.add(name);
      } else if (ts.isObjectBindingPattern(node.name) && (isState(init) || isStoreCall(init))) {
        for (const element of node.name.elements) if (ts.isIdentifier(element.name)) actions.add(element.name.text);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      declare(node.name.text, node);
      const out = node.parameters.length === 0 ? returned(node) : undefined;
      if (out && isState(out)) handles.add(node.name.text);
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.add(node.name.text);
    }
    ts.forEachChild(node, bind);
  };
  // A handle may be bound through another handle declared after it.
  bind(source);
  bind(source);

  const local = new Set<string>();
  const isAction = (call: ts.CallExpression): boolean => {
    const callee = unwrap(call.expression);
    if (ts.isPropertyAccessExpression(callee)) return isStoreCall(call, 'setState') || isState(callee.expression);
    if (!ts.isIdentifier(callee) || shadowed(call, callee.text)) return false;
    return actions.has(callee.text) || local.has(callee.text) || writers.has(callee.text);
  };
  const writes = (fn: ts.Node): boolean => {
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isCallExpression(n) && isAction(n)) hit = true;
      else ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn, visit);
    return hit;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, fns] of functions) if (!local.has(name) && fns.some(writes)) { local.add(name); grew = true; }
  }

  /** The functions that run late, each with the context that makes it late. */
  const late = new Map<ts.Node, string>();
  const handler = (arg: ts.Expression | undefined, context: string): void => {
    if (!arg) return;
    const fn = unwrap(arg);
    if (isFunction(fn)) late.set(fn, context);
    else if (ts.isIdentifier(fn)) for (const declared of functions.get(fn.text) ?? []) late.set(declared, context);
  };
  const awaits: ts.Node[] = [];
  const scan = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const member = n.expression.name.text;
      if (member === 'then' || member === 'catch' || member === 'finally') n.arguments.forEach((a) => handler(a, `.${member}`));
      else if (member === 'on' && /bus$/i.test(n.expression.expression.getText(source))) handler(n.arguments[1], 'bus handler');
      else if (member === 'subscribe') n.arguments.forEach((a) => handler(a, 'subscription'));
    }
    if (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier)) awaits.push(n);
    ts.forEachChild(n, scan);
  };
  scan(source);

  const encloses = (outer: ts.Node, inner: ts.Node): boolean => {
    for (let p = inner.parent; p; p = p.parent) if (p === outer) return true;
    return false;
  };
  const functionOf = (n: ts.Node): ts.Node | undefined => {
    let p = n.parent;
    while (p && !isFunction(p)) p = p.parent;
    return p;
  };
  const found: string[] = [];
  const check = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && isAction(n)) {
      let context: string | undefined;
      for (let p = n.parent; p && !context; p = p.parent) context = late.get(p);
      if (!context && awaits.some((a) => { const fn = functionOf(a); return !!fn && encloses(fn, n) && n.getStart(source) >= a.getEnd(); })) context = 'after await';
      if (context) found.push(`${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1}: ${n.expression.getText(source)} (${context})`);
    }
    ts.forEachChild(n, check);
  };
  check(source);
  return { found, exports: new Set([...exported].filter((name) => local.has(name))) };
}

/** Every late store write under `src/ui`, a ui module's exported writers counting as actions where
 *  another imports them. */
function uiLateWrites(): string[] {
  const files = sourceFiles(join(SRC, 'ui'));
  const exportsOf = new Map<string, Set<string>>();
  const importedWriters = (file: string): Set<string> => {
    const out = new Set<string>();
    for (const statement of parseSource(file).statements) {
      const named = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
      if (!named || !ts.isNamedImports(named) || !ts.isStringLiteral((statement as ts.ImportDeclaration).moduleSpecifier)) continue;
      const target = resolveModule(file, ((statement as ts.ImportDeclaration).moduleSpecifier as ts.StringLiteral).text);
      const theirs = target ? exportsOf.get(target) : undefined;
      if (theirs) for (const e of named.elements) if (theirs.has((e.propertyName ?? e.name).text)) out.add(e.name.text);
    }
    return out;
  };
  let found: string[] = [];
  // Writers reach importers a module at a time, so repeat until no export set grows.
  for (let grew = true; grew;) {
    grew = false;
    found = [];
    for (const file of files) {
      const result = lateWrites(file, undefined, importedWriters(file));
      if (result.exports.size > (exportsOf.get(file)?.size ?? 0)) grew = true;
      exportsOf.set(file, result.exports);
      found.push(...result.found.map((hit) => `${srcRelative(file)}:${hit}`));
    }
  }
  return found;
}

describe('ui writes the store only within a render\'s intent', () => {
  it('calls no store action after an await, in a promise callback, or in a bus or subscription handler', () => {
    expect(uiLateWrites(), 'move the write behind an editor verb or into the session\'s wiring').toEqual([]);
  });

  it('reads late writes through every handle, and none made at once', () => {
    const text = [
      `import { useEditorStore } from './store';`,
      `const store = () => useEditorStore.getState();`,
      `export const close = () => store().setModal(null);`,
      `export async function a() { store().setA(); await 1; store().setB(); }`,
      `export function b() { void Promise.resolve().then(() => useEditorStore.getState().setC()); }`,
      `export function C() { const set = useEditorStore((s) => s.setD); const bus = useEditorStore((s) => s.eventBus);`,
      `  bus.on('x', () => set(1)); useEditorStore.subscribe(() => close()); return () => set(2); }`,
      `export function d(s: { setE(): void }) { void Promise.resolve().then(() => s.setE()); }`,
    ].join('\n');
    const { found, exports } = lateWrites('sample.ts', text);
    expect(found.map((hit) => hit.replace(/^\d+: /, ''))).toEqual([
      'store().setB (after await)', 'useEditorStore.getState().setC (.then)', 'set (bus handler)', 'close (subscription)',
    ]);
    expect([...exports].sort()).toEqual(['C', 'a', 'b', 'close']);
  });
});
