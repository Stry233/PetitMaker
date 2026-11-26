/**
 * ui reaches the libraries below it (each module of `tools/`, `io/` and `pipelines/`, and `rules/`
 * and `platform/storage/` whole) only through a facts module (`facts.ts` or `<name>-facts.ts`) or a
 * `loaders.ts` of lazy loaders, so their workings, caching and storage run below ui and a surface
 * needing behaviour asks an `editor/` verb; a type-only import borrows a contract and is exempt.
 * A facts module ui imports states facts and writes nothing: no call in it, and no name it re-exports,
 * is a storage write (a `write*`, `remove*`, `delete*` or `clear*` of `platform/storage/`, or web
 * storage's `setItem`, `removeItem` or `clear`). The check reads the file itself, not what it
 * re-exports from elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import ts from 'typescript';
import { SRC, importEdges, parseSource, resolveModule, resolveSpec, sourceFiles, srcRelative } from '../_support/source-graph';

/** A module path inside one of the libraries ui reads through facts. */
const LIBRARY = /^(?:tools|io|pipelines|rules|platform\/storage)(?:\/|$)/;
/** A module of facts, and a module of lazy loaders: doors that evaluate none of their library's workings. */
const FACTS = /\/(?:[a-z]+-)*facts$/;
const LOADERS = /\/loaders$/;
/** A storage writer's name, as `platform/storage/` exports it. */
const WRITER = /^(?:write|remove|delete|clear)/;
/** Web storage's writes. */
const WEB_WRITES: ReadonlySet<string> = new Set(['setItem', 'removeItem', 'clear']);

/** A resolved target as its module path: no extension, and a folder's index as the folder. */
const modulePath = (target: string): string => target.replace(/\.(?:tsx?|js|json)$/, '').replace(/\/index$/, '');

/** Whether a ui file may import `module` at runtime, by its name. */
const admitted = (module: string): boolean => !LIBRARY.test(module) || FACTS.test(module) || LOADERS.test(module);

/** The storage writes in `path` (default: the file's contents), as `line: name`. */
function storageWrites(path: string, text?: string): string[] {
  const source = parseSource(path, text);
  const writers = new Set<string>();
  const found: string[] = [];
  const at = (node: ts.Node, name: string): void => {
    found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${name}`);
  };
  const fromStorage = (spec: ts.Expression): boolean => ts.isStringLiteral(spec) && /(?:^|\/)platform\/storage\//.test(spec.text);
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && fromStorage(statement.moduleSpecifier)) {
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const e of named.elements) if (WRITER.test((e.propertyName ?? e.name).text)) writers.add(e.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && fromStorage(statement.moduleSpecifier)) {
      const named = statement.exportClause;
      if (!named) at(statement, '*');
      else if (ts.isNamedExports(named)) for (const e of named.elements) if (WRITER.test((e.propertyName ?? e.name).text)) at(e, e.name.text);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && writers.has(callee.text)) at(node, callee.text);
      else if (ts.isPropertyAccessExpression(callee) && WEB_WRITES.has(callee.name.text) && /\b(?:local|session)Storage$/.test(callee.expression.getText(source))) at(node, callee.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every runtime import of a ui file that lands in a library module past its doors, or in a facts
 *  module that writes storage. */
function breaches(): string[] {
  const found: string[] = [];
  const writing = new Map<string, string[]>();
  for (const file of sourceFiles(join(SRC, 'ui'))) {
    for (const edge of importEdges(file)) {
      if (edge.typeOnly) continue;
      const target = resolveSpec(file, edge.spec);
      if (target === null) continue;
      const module = modulePath(target);
      const from = `${srcRelative(file)}:${edge.line} -> ${module}`;
      if (!admitted(module)) found.push(from);
      else if (LIBRARY.test(module) && FACTS.test(module)) {
        const resolved = resolveModule(file, edge.spec);
        if (resolved && !writing.has(resolved)) writing.set(resolved, storageWrites(resolved));
        for (const write of resolved ? writing.get(resolved)! : []) found.push(`${from} (writes ${write})`);
      }
    }
  }
  return found;
}

describe('ui reads lower libraries through their facts', () => {
  it('imports no library module at runtime past its facts or loaders door, and no facts module that writes storage', () => {
    expect(breaches(), 'add the fact to the library\'s facts module, or ask an editor verb').toEqual([]);
  });

  it('tells a door from the workings behind it', () => {
    expect(['tools/macros/facts', 'io/storage/splash-facts', 'pipelines/stylize/loaders', 'rules/facts', 'platform/storage/facts', 'editor/editing/generate-batch'].filter((m) => !admitted(m))).toEqual([]);
    expect(['tools/macros', 'tools/generation/stencil', 'rules', 'rules/layer-lock', 'platform/storage/prefs', 'io/share/codec/catalog-order'].filter(admitted)).toEqual([]);
  });

  it('reads a storage write by call or re-export, not a read', () => {
    const text = [
      `import { readPref, writePref as put } from '../../platform/storage/prefs';`,
      `export { removePref, readStoredPref } from '../../platform/storage/prefs';`,
      `export const seen = (): boolean => readPref('splashDone') !== '';`,
      `export function mark(): void { put('splashDone', 'x'); window.localStorage.setItem('k', 'v'); }`,
    ].join('\n');
    expect(storageWrites('sample.ts', text).map((hit) => hit.replace(/^\d+: /, ''))).toEqual(['removePref', 'put', 'window.localStorage.setItem']);
  });
});
