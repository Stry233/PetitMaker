/**
 * ui renders state, captures input and calls verbs; workflows, policies and store orchestration live
 * in `editor/`, `state/`, `io/` and the pipelines. Each guard finds one way a ui file still holds them:
 * - `lowerImport`: a runtime import (static or dynamic) into `io/`, `tools/` or `pipelines/` that is
 *   not a fact module (`facts.ts`, `*-facts.ts`), a warm-scheduled chunk loader or a `NAMED` binding.
 * - `storeSetState`: `<store>.setState(` on any of the page's zustand stores (`STORES`).
 * - `multiAction`: one function body (nested functions on their own) calling two or more distinct
 *   store actions of any store, read off the live stores so a new action is covered.
 * - `storeSubscribe`, `mapEditListen`, `mapRevision`: a store subscription, a map-edit listener and a
 *   read of `cellsVersion`/`objectsVersion` or a `mapRevisionOf` call outside `ui/session/`, which owns
 *   those signals.
 * - `executorCall`: a command-executor call other than the `historyDepth()` read.
 * - `moduleSideEffect`: a top-level call of a binding imported from `editor/`, `agent/`, `tools/`,
 *   `io/` or `pipelines/`.
 * - `factPurity`: a fact module under `io/`, `tools/` or `pipelines/` importing the store, `editor/`
 *   or React, or reading a DOM global, so the `lowerImport` exception carries no workflow.
 * `presentation-allowlist.ts` lists the sites each guard still tolerates per file or folder; counts
 * are exact, and an entry for a missing path fails.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { REPO, importEdges, parseSource, repoFiles, repoRelative, resolveModule, sourceText } from '../_support/source-graph';
import { useEditorStore } from '../../state/store';
import { useKeybinds } from '../../state/keymap/store';
import { useAgentConnection } from '../../agent/connection/store';
import { useAgentSession } from '../../agent/session/store';
import { NAMED, PRESENTATION_ALLOWLIST, type GuardId } from './presentation-allowlist';

interface Source { path: string; text: string }

const GUARDS: readonly GuardId[] = [
  'lowerImport', 'storeSetState', 'multiAction', 'storeSubscribe', 'executorCall', 'mapEditListen', 'mapRevision', 'moduleSideEffect', 'factPurity',
];
const LOWER = /^src\/(?:io|tools|pipelines)\//;
const SIDE_EFFECT_LAYERS = /^src\/(?:editor|agent|tools|io|pipelines)\//;
/** Chunk loaders the startup warm schedule prefetches; ui reaches the chunk through them. */
const CHUNK_LOADERS: ReadonlySet<string> = new Set(['src/pipelines/stylize/loaders.ts']);
const SESSION = 'src/ui/session/';
const EXECUTOR_CALLS: ReadonlySet<string> = new Set([
  'execute', 'transaction', 'transactionAsync', 'undo', 'redo', 'restoreHistory', 'getUndoEntries', 'getProvenanceSummary', 'getRegistry',
]);
const EXECUTOR_FIELDS: ReadonlySet<string> = new Set(['commandExecutor', 'executor']);
const MAP_EDIT_EVENTS: ReadonlySet<string> = new Set(['cells-changed', 'objects-changed', 'history-applied', 'history-changed']);
const REVISION_FIELDS: ReadonlySet<string> = new Set(['cellsVersion', 'objectsVersion']);
const DOM_GLOBALS: ReadonlySet<string> = new Set([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'requestAnimationFrame', 'matchMedia',
]);
/** Every zustand store ui may read, by the name it is imported under, with its live actions. */
const STORES: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries({
  useEditorStore, useKeybinds, useAgentConnection, useAgentSession,
}).map(([name, store]) => [name, new Set(Object.entries(store.getState() as object)
  .filter(([, value]) => typeof value === 'function').map(([key]) => key))]));
const actionOf = (store: string, field: string): string | null => (STORES.get(store)?.has(field) ? `${store}.${field}` : null);

const isFact = (path: string) => /(?:^|-)facts\.ts$/.test(basename(path));
const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)
  || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);

/** `node` without parentheses, non-null assertions and casts around it. */
function bare(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) node = node.expression;
  return node;
}
/** The store `node` names, or null. */
const storeOf = (node: ts.Expression): string | null => {
  const n = bare(node);
  return ts.isIdentifier(n) && STORES.has(n.text) ? n.text : null;
};
/** The store whose `<method>` `node` is as a callee, or null. */
const storeMethod = (node: ts.Expression, method: string): string | null => {
  const n = bare(node);
  return ts.isPropertyAccessExpression(n) && n.name.text === method ? storeOf(n.expression) : null;
};
const isStoreMethod = (node: ts.Expression, method: string) => storeMethod(node, method) !== null;
/** The store a `<store>.getState()` call, or a whole-state `<store>()` hook read, returns the state of. */
const stateOf = (node: ts.Expression): string | null => {
  const n = bare(node);
  if (!ts.isCallExpression(n) || n.arguments.length !== 0) return null;
  return storeMethod(n.expression, 'getState') ?? storeOf(n.expression);
};
const isGetState = (node: ts.Expression) => {
  const n = bare(node);
  return ts.isCallExpression(n) && n.arguments.length === 0 && isStoreMethod(n.expression, 'getState');
};
/** The store and field a `<store>((s) => s.field)` selector reads, or null. */
function selected(node: ts.Expression): { store: string; field: string } | null {
  const n = bare(node);
  const store = ts.isCallExpression(n) ? storeOf(n.expression) : null;
  if (!store || !ts.isCallExpression(n) || n.arguments.length !== 1) return null;
  const selector = n.arguments[0]!;
  if (!ts.isArrowFunction(selector) || selector.parameters.length !== 1 || ts.isBlock(selector.body)) return null;
  const param = selector.parameters[0]!.name;
  const body = bare(selector.body);
  return ts.isIdentifier(param) && ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression) && body.expression.text === param.text
    ? { store, field: body.name.text } : null;
}
/** The field a selector reads off `useEditorStore`, where the executor lives. */
const selectedField = (node: ts.Expression): string | null => {
  const sel = selected(node);
  return sel && sel.store === 'useEditorStore' ? sel.field : null;
};

/** The function (or the file) a declaration's binding is visible in. */
const scopeOf = (node: ts.Node): ts.Node => {
  let at = node.parent;
  while (at && !isFunction(at) && !ts.isSourceFile(at)) at = at.parent;
  return at;
};
const within = (node: ts.Node, scope: ts.Node) => {
  for (let at: ts.Node | undefined = node; at; at = at.parent) if (at === scope) return true;
  return false;
};

/** The store and executor bindings a file declares: names bound to the store's state, to a getter of
 *  it, to one store action (`const set = useEditorStore((s) => s.setModal)`), and to the executor. */
interface Bindings {
  state: { name: string; store: string; scope: ts.Node }[];
  getter: { name: string; store: string; scope: ts.Node }[];
  action: { name: string; action: string; scope: ts.Node }[];
  executor: { name: string; scope: ts.Node }[];
}

function bindingsOf(file: ts.SourceFile): Bindings {
  const found: Bindings = { state: [], getter: [], action: [], executor: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const scope = scopeOf(node);
      const init = bare(node.initializer);
      const sel = selected(init);
      const state = stateOf(init);
      if (ts.isIdentifier(node.name)) {
        const name = node.name.text;
        if (state) found.state.push({ name, store: state, scope });
        const getter = storeMethod(init, 'getState')
          ?? (ts.isArrowFunction(init) && !ts.isBlock(init.body) && isGetState(init.body) ? stateOf(init.body) : null);
        if (getter) found.getter.push({ name, store: getter, scope });
        const action = sel ? actionOf(sel.store, sel.field) : null;
        if (action) found.action.push({ name, action, scope });
        if (selectedField(init) === 'commandExecutor' || (ts.isPropertyAccessExpression(init) && init.name.text === 'commandExecutor')) found.executor.push({ name, scope });
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const key = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
          if (key === 'commandExecutor') found.executor.push({ name: element.name.text, scope });
          const action = state ? actionOf(state, key) : null;
          if (action) found.action.push({ name: element.name.text, action, scope });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const bound = <T extends { name: string; scope: ts.Node }>(list: T[], id: ts.Identifier): T | undefined =>
  list.find((b) => b.name === id.text && within(id, b.scope));

/** The store action `call` invokes, or null. */
function actionCalled(call: ts.CallExpression, b: Bindings): string | null {
  const callee = bare(call.expression);
  if (ts.isIdentifier(callee)) return bound(b.action, callee)?.action ?? null;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const target = bare(callee.expression);
  const getter = ts.isCallExpression(target) && target.arguments.length === 0 ? bare(target.expression) : null;
  const store = stateOf(target)
    ?? (ts.isIdentifier(target) ? bound(b.state, target)?.store : undefined)
    ?? (getter && ts.isIdentifier(getter) ? bound(b.getter, getter)?.store : undefined);
  return store ? actionOf(store, callee.name.text) : null;
}

/** Whether `call` calls a command-executor method on the store's `commandExecutor` (read off the state
 *  or selected), a binding of it, or a detached world's `executor`. */
function executorCalled(call: ts.CallExpression, b: Bindings): boolean {
  const callee = bare(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || !EXECUTOR_CALLS.has(callee.name.text)) return false;
  const target = bare(callee.expression);
  return (ts.isPropertyAccessExpression(target) && EXECUTOR_FIELDS.has(target.name.text))
    || selectedField(target) === 'commandExecutor'
    || (ts.isIdentifier(target) && (target.text === 'commandExecutor' || !!bound(b.executor, target)));
}

/** The names an import clause binds: `{ a, b as c }` names a and b, `X` is the default; null for a
 *  namespace, a dynamic import or a re-export of everything, which may read any. */
function importedNames(edge: { clause: string; dynamic: boolean }): string[] | null {
  if (edge.dynamic || edge.clause === '' || edge.clause.includes('*')) return null;
  const named = /\{([^}]*)\}/.exec(edge.clause)?.[1] ?? '';
  const names = named.split(',').map((part) => part.trim()).filter((part) => part !== '' && !/^type\s/.test(part)).map((part) => part.split(/\s+as\s+/)[0]!);
  return /^\s*[A-Za-z_$][\w$]*\s*(?:,|$)/.test(edge.clause) ? ['default', ...names] : names;
}

/** The repository path a relative specifier of `path` loads, or null. */
const target = (path: string, spec: string) => {
  const resolved = resolveModule(join(REPO, path), spec);
  return resolved ? repoRelative(resolved) : null;
};

/** Every site each guard finds in `sources`, per file. */
function scan(sources: readonly Source[]): Record<GuardId, Map<string, number>> {
  const found = Object.fromEntries(GUARDS.map((g) => [g, new Map<string, number>()])) as Record<GuardId, Map<string, number>>;
  const hit = (guard: GuardId, path: string) => found[guard].set(path, (found[guard].get(path) ?? 0) + 1);
  for (const { path, text } of sources) {
    const file = parseSource(path, text);
    if (path.startsWith('src/ui/')) scanUi(path, text, file, hit);
    else if (LOWER.test(path) && isFact(path)) scanFact(path, text, file, hit);
  }
  return found;
}

function scanUi(path: string, text: string, file: ts.SourceFile, hit: (guard: GuardId, path: string) => void): void {
  const inSession = path.startsWith(SESSION);
  const edges = importEdges(path, text);
  for (const edge of edges) {
    if (edge.typeOnly) continue;
    const to = target(path, edge.spec);
    if (!to || !LOWER.test(to) || isFact(to) || CHUNK_LOADERS.has(to)) continue;
    const names = importedNames(edge);
    if (names && names.length > 0 && names.every((name) => NAMED[`${to}:${name}`] !== undefined)) continue;
    hit('lowerImport', path);
  }
  const b = bindingsOf(file);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isStoreMethod(node.expression, 'setState')) hit('storeSetState', path);
      if (!inSession && isStoreMethod(node.expression, 'subscribe')) hit('storeSubscribe', path);
      if (executorCalled(node, b)) hit('executorCall', path);
      const callee = bare(node.expression);
      const arg = node.arguments[0];
      if (!inSession && ((ts.isPropertyAccessExpression(callee) && callee.name.text === 'on' && arg && ts.isStringLiteralLike(arg) && MAP_EDIT_EVENTS.has(arg.text))
        || (ts.isIdentifier(callee) && callee.text === 'onMapEdited'))) hit('mapEditListen', path);
    }
    if (!inSession && ts.isPropertyAccessExpression(node) && REVISION_FIELDS.has(node.name.text)) hit('mapRevision', path);
    if (!inSession && ts.isCallExpression(node) && ts.isIdentifier(bare(node.expression)) && (bare(node.expression) as ts.Identifier).text === 'mapRevisionOf') hit('mapRevision', path);
    if (!inSession && ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && REVISION_FIELDS.has(key.text)) hit('mapRevision', path);
    }
    if (isFunction(node) && node.body) {
      const actions = new Set<string>();
      const inner = (n: ts.Node): void => {
        if (isFunction(n)) return;
        if (ts.isCallExpression(n)) { const action = actionCalled(n, b); if (action) actions.add(action); }
        ts.forEachChild(n, inner);
      };
      inner(node.body);
      if (actions.size >= 2) hit('multiAction', path);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const lowerBindings = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    const to = target(path, (statement.moduleSpecifier as ts.StringLiteral).text);
    if (!to || !SIDE_EFFECT_LAYERS.test(to)) continue;
    const clause = statement.importClause;
    if (clause?.name) lowerBindings.add(clause.name.text);
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) lowerBindings.add(named.name.text);
    if (named && ts.isNamedImports(named)) for (const e of named.elements) if (!e.isTypeOnly) lowerBindings.add(e.name.text);
  }
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    let calls = false;
    const inner = (n: ts.Node): void => {
      if (calls || isFunction(n)) return;
      if (ts.isCallExpression(n)) {
        let root: ts.Expression = bare(n.expression);
        while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root)) root = bare(root.expression);
        if (ts.isIdentifier(root) && lowerBindings.has(root.text)) { calls = true; return; }
      }
      ts.forEachChild(n, inner);
    };
    inner(statement.expression);
    if (calls) hit('moduleSideEffect', path);
  }
}

function scanFact(path: string, text: string, file: ts.SourceFile, hit: (guard: GuardId, path: string) => void): void {
  for (const edge of importEdges(path, text)) {
    const to = target(path, edge.spec);
    if (/^react(?:-dom)?(?:\/|$)/.test(edge.spec) || to === 'src/state/store.ts' || to?.startsWith('src/editor/')) hit('factPurity', path);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && DOM_GLOBALS.has(node.text)) {
      const p = node.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node)
        || ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p)) && p.name === node);
      if (!isName) hit('factPurity', path);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** The allowlist key that covers `path`: the file itself, else the longest folder entry over it. */
function keyFor(entries: Record<string, unknown>, path: string): string | null {
  if (path in entries) return path;
  const folders = Object.keys(entries).filter((key) => key.endsWith('/') && path.startsWith(key)).sort((a, b) => b.length - a.length);
  return folders[0] ?? null;
}

/** Per allowlist key (a file or a folder entry), the sites `found` holds; unlisted files by path. */
function tally(guard: GuardId, found: Map<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [path, n] of found) {
    const key = keyFor(PRESENTATION_ALLOWLIST[guard], path) ?? path;
    totals.set(key, (totals.get(key) ?? 0) + n);
  }
  return totals;
}

const read = (dir: string): Source[] => repoFiles(dir).map((path) => ({ path, text: sourceText(join(REPO, path)) }));
const TREE: Source[] = [...read('src/ui'), ...['src/io', 'src/tools', 'src/pipelines'].flatMap(read).filter(({ path }) => isFact(path))];
const found = scan(TREE);

describe('presentation guard', () => {
  it.each(GUARDS)('finds no %s site beyond the allowlist', (guard) => {
    const allowed = PRESENTATION_ALLOWLIST[guard];
    const over = [...tally(guard, found[guard])].filter(([key, n]) => n > (allowed[key]?.count ?? 0))
      .map(([key, n]) => `${key}: ${n} > ${allowed[key]?.count ?? 0}`);
    expect(over).toEqual([]);
  });

  it.each(GUARDS)('keeps the %s allowlist exact, so a moved site comes off it', (guard) => {
    const totals = tally(guard, found[guard]);
    const stale = Object.entries(PRESENTATION_ALLOWLIST[guard]).filter(([key, { count }]) => (totals.get(key) ?? 0) !== count)
      .map(([key, { count }]) => `${key}: listed ${count}, found ${totals.get(key) ?? 0}`);
    expect(stale).toEqual([]);
  });

  it('lists only paths that exist, each with its reason', () => {
    const entries = GUARDS.flatMap((guard) => Object.entries(PRESENTATION_ALLOWLIST[guard]));
    expect(entries.filter(([key]) => !existsSync(join(REPO, key))).map(([key]) => key)).toEqual([]);
    expect(entries.filter(([, entry]) => entry.reason.trim() === '').map(([key]) => key)).toEqual([]);
  });

  it('names only bindings a ui file imports', () => {
    const used = new Set<string>();
    for (const { path, text } of TREE.filter((s) => s.path.startsWith('src/ui/'))) {
      for (const edge of importEdges(path, text)) {
        const to = !edge.typeOnly && target(path, edge.spec);
        for (const name of (to && importedNames(edge)) || []) used.add(`${to}:${name}`);
      }
    }
    expect(Object.keys(NAMED).filter((key) => !used.has(key))).toEqual([]);
  });
});

describe('each guard catches a planted site', () => {
  const plant = (text: string, path = 'src/ui/shell/planted.tsx') => scan([{ path, text }]);
  const count = (guard: GuardId, text: string, path?: string) => plant(text, path)[guard].get(path ?? 'src/ui/shell/planted.tsx') ?? 0;

  it('lowerImport: a workflow module, static or dynamic, and not a fact, a type or a named helper', () => {
    expect(count('lowerImport', "import { createAutosave } from '../../io/storage/autosave';")).toBe(1);
    expect(count('lowerImport', "export { createAutosave } from '../../io/storage/autosave';")).toBe(1);
    expect(count('lowerImport', "const run = () => import('../../pipelines/moderation');")).toBe(1);
    expect(count('lowerImport', "import { hasAutosave } from '../../io/storage/facts';")).toBe(0);
    expect(count('lowerImport', "import type { Autosave } from '../../io/storage/autosave';")).toBe(0);
    expect(count('lowerImport', "import { autosave } from '../../editor/session/autosave';")).toBe(0);
    const [named] = Object.keys(NAMED);
    if (named) {
      const [module, binding] = named.split(':') as [string, string];
      const spec = `../../${module.replace(/^src\//, '').replace(/(?:\/index)?\.tsx?$/, '')}`;
      expect(count('lowerImport', `import { ${binding} } from '${spec}';`)).toBe(0);
    }
  });

  it('storeSetState: on every store', () => {
    expect(count('storeSetState', 'useEditorStore.setState({ whatsThis: true });')).toBe(1);
    expect(count('storeSetState', 'useAgentConnection.setState({ providerPinned: true });')).toBe(1);
    expect(count('storeSetState', 'useKeybinds.setState({ overrides: {} });')).toBe(1);
  });

  it('multiAction: two distinct actions however they are reached, each function on its own', () => {
    expect(count('multiAction', "const f = () => { useEditorStore.getState().setModal('help', true); useEditorStore.getState().setWhatsThis(false); };")).toBe(1);
    expect(count('multiAction', "function f() { const s = useEditorStore.getState(); s.setModal('help', true); s.setWhatsThis(false); }")).toBe(1);
    expect(count('multiAction', "function C() { const open = useEditorStore((s) => s.setModal); const pick = useEditorStore((s) => s.setWhatsThis); return () => { open('help', true); pick(false); }; }")).toBe(1);
    expect(count('multiAction', "function f() { const { setModal, setWhatsThis } = useEditorStore.getState(); setModal('help', true); setWhatsThis(false); }")).toBe(1);
    expect(count('multiAction', "const s = () => useEditorStore.getState();\nconst f = () => { s().setModal('help', true); s().setWhatsThis(false); };")).toBe(1);
    expect(count('multiAction', "function f() { useEditorStore.getState().setModal('help', true); useEditorStore.getState().setModal('about', false); }")).toBe(0);
    expect(count('multiAction', "function C() { const settings = useAgentConnection(); return () => { settings.pinProvider('custom'); settings.clearProviderPin(); }; }")).toBe(1);
    expect(count('multiAction', "function C() { const rebind = useKeybinds((s) => s.rebind); const clear = useKeybinds((s) => s.clear); return (id) => (id ? rebind(id, 'a') : clear(id)); }")).toBe(1);
    expect(count('multiAction', "const f = () => { useAgentSession.getState().hydrate(); useEditorStore.getState().setWhatsThis(false); };")).toBe(1);
    expect(count('multiAction', "function f() { useEditorStore.getState().setModal('help', true); return () => useEditorStore.getState().setWhatsThis(false); }")).toBe(0);
  });

  it('storeSubscribe, mapEditListen and mapRevision belong to ui/session', () => {
    const subscribe = 'const off = useEditorStore.subscribe(() => {});';
    const listen = "bus.on('cells-changed', f); onMapEdited(bus, f);";
    const revision = 'const r = `${grid.cellsVersion}`; const { objectsVersion } = grid; const k = mapRevisionOf(grid);';
    expect(count('storeSubscribe', subscribe)).toBe(1);
    expect(count('storeSubscribe', 'const off = useKeybinds.subscribe(() => {});')).toBe(1);
    expect(count('mapEditListen', listen)).toBe(2);
    expect(count('mapRevision', revision)).toBe(3);
    const session = 'src/ui/session/planted.ts';
    expect(count('storeSubscribe', subscribe, session)).toBe(0);
    expect(count('mapEditListen', listen, session)).toBe(0);
    expect(count('mapRevision', revision, session)).toBe(0);
  });

  it('executorCall: on the store field or a binding of it, never the depth read', () => {
    expect(count('executorCall', 'useEditorStore.getState().commandExecutor?.undo();')).toBe(1);
    expect(count('executorCall', 'const ex = useEditorStore.getState().commandExecutor; ex!.execute(cmd);')).toBe(1);
    expect(count('executorCall', 'const { commandExecutor } = useEditorStore.getState(); commandExecutor?.getUndoEntries();')).toBe(1);
    expect(count('executorCall', 'function C() { const ex = useEditorStore((s) => s.commandExecutor); ex?.redo(); }')).toBe(1);
    expect(count('executorCall', 'function C() { return useEditorStore((s) => s.commandExecutor)?.getRegistry(); }')).toBe(1);
    expect(count('executorCall', 'world.executor.execute(cmd);')).toBe(1);
    expect(count('executorCall', 'useEditorStore.getState().commandExecutor?.historyDepth();')).toBe(0);
  });

  it('moduleSideEffect: a top-level call of a lower-layer binding', () => {
    expect(count('moduleSideEffect', "import { installStencilBrowser } from '../../tools/generation/stencil';\ninstallStencilBrowser(DOM);")).toBe(1);
    expect(count('moduleSideEffect', "import { setToolFacts, TOOL_FACTS } from '../../agent/panel-runtime';\nsetToolFacts(TOOL_FACTS);")).toBe(1);
    expect(count('moduleSideEffect', "import { host } from '../../editor/host/host';\nexport const go = () => host.camera.get2d();\nconsole.info(1);")).toBe(0);
  });

  it('factPurity: a fact module that imports the store, editor or React, or reads a DOM global', () => {
    const fact = 'src/io/storage/planted-facts.ts';
    expect(count('factPurity', "import { useEditorStore } from '../../state/store';", fact)).toBe(1);
    expect(count('factPurity', "import { host } from '../../editor/host/host';", fact)).toBe(1);
    expect(count('factPurity', "import { useState } from 'react';", fact)).toBe(1);
    expect(count('factPurity', 'export const wide = () => window.innerWidth > 900;', fact)).toBe(1);
    expect(count('factPurity', 'export const AUTOSAVE_DEBOUNCE_MS = 2000; export const at = (o: { window: number }) => o.window;', fact)).toBe(0);
  });
});
