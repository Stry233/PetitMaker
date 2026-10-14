/**
 * The repository's files and import graph as every guard reads them: one directory walker, one
 * syntax-tree parse per file and one definition of an import edge.
 *
 * An edge is a module specifier a file names in an `import` or `export ... from` statement, a bare
 * side-effect `import '…'`, a dynamic `import('…')` or an `import('…')` type. It is type-only when the
 * compiler erases it: an `import type`/`export type` statement, a named clause whose every binding is
 * marked `type`, or an `import('…')` type. Type-only edges express a contract rather than runtime
 * coupling: the layer guard lists the upward ones instead of refusing them, and inside core they
 * count as edges. A dynamic import is runtime coupling (it is how lazy chunks load) but is not
 * evaluated with the module, so a static-graph walk stops at it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import ts from 'typescript';

/** Absolute path of `src/`. */
export const SRC: string = resolve(__dirname, '../..');
/** Absolute path of the repository root. */
export const REPO: string = resolve(SRC, '..');

/** Folders no walk enters: installed packages and version control. */
const NEVER_ENTERED: ReadonlySet<string> = new Set(['node_modules', '.git']);

export interface WalkOptions {
  /** File names to keep. Defaults to TypeScript sources, `.d.ts` included. */
  readonly accept?: RegExp | ((name: string) => boolean);
  /** Folders not entered, besides `node_modules` and `.git`: a bare name skips every folder so
   *  named, a slashed path (`i18n/locales`) only the folder whose path ends with it. */
  readonly skip?: readonly string[];
}

/** Every file under `dir` whose name `accept` matches, as absolute paths in directory order; an
 *  absent `dir` holds none. */
export function walkFiles(dir: string, { accept = /\.tsx?$/, skip = [] }: WalkOptions = {}): string[] {
  const out: string[] = [];
  const visit = (at: string): void => {
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(at, name);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue; // removed or a dangling link while the walk ran
      }
      if (isDirectory) {
        const skipped = skip.some((s) => (s.includes('/') ? posix(full).endsWith(`/${s}`) : name === s));
        if (!NEVER_ENTERED.has(name) && !skipped) visit(full);
      } else if (typeof accept === 'function' ? accept(name) : accept.test(name)) {
        out.push(full);
      }
    }
  };
  visit(dir);
  return out;
}

/** Every file under the repository folder `dir` (repo-relative) that `walkFiles` keeps, as
 *  repo-relative paths with forward slashes. */
export const repoFiles = (dir: string, options?: WalkOptions): string[] => walkFiles(join(REPO, dir), options).map(repoRelative);

/** The names of the folders directly under `dir`. */
export const subfolders = (dir: string): string[] => readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());

/** Every `.ts`/`.tsx` file under `dir` (default `src/`), tests excluded. */
export const sourceFiles = (dir: string = SRC): string[] => walkFiles(dir, { skip: ['__tests__'] });

/** Every `*.test.ts(x)` file under `dir`. */
export const testFiles = (dir: string): string[] => walkFiles(dir, { accept: /\.test\.tsx?$/ });

/** `path` with forward slashes. */
export const posix = (path: string): string => path.replace(/\\/g, '/');
/** `file` relative to `src/`, with forward slashes. */
export const srcRelative = (file: string): string => posix(relative(SRC, file));
/** `file` relative to the repository root, with forward slashes. */
export const repoRelative = (file: string): string => posix(relative(REPO, file));

/** The contents of `file`. */
export const sourceText = (file: string): string => readFileSync(file, 'utf8');

/** Syntax trees keyed by path, kept while the text they were parsed from stays the same. */
const trees = new Map<string, { text: string; source: ts.SourceFile }>();

/** The syntax tree of `text` (default: the file's contents), parsed as TSX or JSX when the extension
 *  says so, with parent links set. */
export function parseSource(path: string, text: string = sourceText(path)): ts.SourceFile {
  const hit = trees.get(path);
  if (hit?.text === text) return hit.source;
  const kind = /\.[cm]?tsx$/.test(path) ? ts.ScriptKind.TSX
    : /\.[cm]?jsx$/.test(path) ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  trees.set(path, { text, source });
  return source;
}

export interface ImportEdge {
  /** The specifier as written. */
  readonly spec: string;
  /** Erased by the compiler: no runtime coupling. */
  readonly typeOnly: boolean;
  /** Loaded by `import('…')`, so not evaluated with the importing module. */
  readonly dynamic: boolean;
  /** The binding clause as written (`{ a, b }`, `X`, `* as y`), empty for a side-effect import, a
   *  re-export of everything and a dynamic import. */
  readonly clause: string;
  /** 1-based line of the specifier. */
  readonly line: number;
}

const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** A named import or export clause marked `type` on each element, with no default or namespace
 *  binding beside it, is erased exactly like `import type`. */
function everyBindingTyped(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const named = clause.namedBindings;
    return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
  }
  if (node.isTypeOnly) return true;
  const named = node.exportClause;
  return !!named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
}

/** Every import edge of `text` (default: the file's contents), in source order. */
export function importEdges(path: string, text?: string): ImportEdge[] {
  const source = parseSource(path, text);
  const out: ImportEdge[] = [];
  const add = (literal: ts.Node, typeOnly: boolean, dynamic: boolean, clause: string): void => {
    const spec = literalText(literal);
    if (spec === null) return;
    const line = source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1;
    out.push({ spec, typeOnly, dynamic, clause, line });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      add(node.moduleSpecifier, everyBindingTyped(node), false, clause ? clause.getText(source).replace(/^type\s+/, '') : '');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, everyBindingTyped(node), false, node.exportClause?.getText(source) ?? '');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, true, true, '');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]!, false, true, '');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The `vi` calls that name a module for the test runner to load or replace. */
const MOCK_CALLS: ReadonlySet<string> = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);

/** Every module specifier `text` hands a loader: its import edges, `require('…')` calls and the
 *  `vi.mock` family's first argument. Paths a test passes to its runner are not import edges, but a
 *  move must still update them. */
export function loadedSpecifiers(path: string, text?: string): string[] {
  const source = parseSource(path, text);
  const out = importEdges(path, text).map((e) => e.spec);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const loads = (ts.isIdentifier(callee) && callee.text === 'require')
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi' && MOCK_CALLS.has(callee.name.text));
      const spec = loads ? literalText(node.arguments[0]) : null;
      if (spec !== null) out.push(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The specifiers `file` imports at runtime, dynamic imports included. */
export const runtimeSpecifiers = (file: string): string[] => importEdges(file).filter((e) => !e.typeOnly).map((e) => e.spec);

/** The specifiers `file` evaluates with itself: runtime edges that are not dynamic imports. */
export const staticSpecifiers = (file: string): string[] =>
  importEdges(file).filter((e) => !e.typeOnly && !e.dynamic).map((e) => e.spec);

/** Every specifier `file` names, type-only ones included. */
export const allSpecifiers = (file: string): string[] => importEdges(file).map((e) => e.spec);

/** A relative specifier's src-relative path as written (no extension added), or null when it names
 *  a package. */
export function resolveSpec(fromFile: string, spec: string): string | null {
  return spec.startsWith('.') ? srcRelative(resolve(dirname(fromFile), spec)) : null;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * The paths `path` may name, in the order a loader tries them: as written (a trailing slash
 * dropped), a `.js` or `.mjs` spelling read as its TypeScript source (unless `sources` is false, as
 * for a document, which names a file as it is), each of `extensions` appended, then each of
 * `indexes` (`/index.ts`) under it as a folder. Every resolver below reads this one list.
 */
export function pathCandidates(
  path: string, extensions: readonly string[], indexes: readonly string[] = [], { sources: readsSources = true } = {},
): string[] {
  const bare = path.replace(/\/$/, '');
  const js = readsSources ? /\.(m?)js$/.exec(bare) : null;
  const stem = js ? bare.slice(0, -js[0].length) : '';
  const sources = !js ? [] : js[1] ? [`${stem}.mts`] : [`${stem}.ts`, `${stem}.tsx`];
  return [...new Set([bare, ...sources, ...extensions.map((ext) => bare + ext), ...indexes.map((index) => bare + index)])];
}

/** Whether `path` names a member of `has` under `pathCandidates`. */
export function resolvesIn(path: string, has: (path: string) => boolean, extensions: readonly string[], indexes: readonly string[] = []): boolean {
  return pathCandidates(path, extensions, indexes).some(has);
}

/** Source extensions an app import tries, and the index files it reads a folder by. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SOURCE_INDEXES = SOURCE_EXTENSIONS.map((ext) => `/index${ext}`);

/** The absolute source file a relative specifier loads, trying the module extensions and index
 *  files; null for a package, an asset or a missing module. */
export function resolveModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec.replace(/[?#].*$/, ''));
  return pathCandidates(base, SOURCE_EXTENSIONS, SOURCE_INDEXES).find((c) => /\.tsx?$/.test(c) && isFile(c)) ?? null;
}

/** Script extensions a bare specifier tries, in order. */
const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];
const SCRIPT_INDEXES = SCRIPT_EXTENSIONS.map((ext) => `/index${ext}`);

/** The absolute script a specifier loads, for any script extension (a `.js` specifier standing for
 *  its `.ts` source): a relative one, or a path the dev server serves from the repository root, as
 *  code a harness runs in the page imports; null for a package, an asset or a missing module. */
export function resolveScript(fromFile: string, spec: string): string | null {
  const served = spec.startsWith('/src/');
  if (!spec.startsWith('.') && !served) return null;
  const base = served ? join(REPO, spec.replace(/[?#].*$/, '')) : resolve(dirname(fromFile), spec.replace(/[?#].*$/, ''));
  return pathCandidates(base, SCRIPT_EXTENSIONS, SCRIPT_INDEXES).find((c) => /\.(tsx?|mts|m?js)$/.test(c) && isFile(c)) ?? null;
}

/** Where a document's repository path is read from. */
export interface DocPathScope {
  /** The folders a path is tried under, nearest first, each `''` or ending in `/`. */
  readonly bases: readonly string[];
  /** Every tracked path and folder. */
  readonly tracked: ReadonlySet<string>;
  /** The extensions a path is tried with. */
  readonly extensions: readonly string[];
  /** The document's own folder, `''` or ending in `/`: a tail its own files share names them all. */
  readonly home: string;
}

/**
 * The tracked file or folder a document's `ref` names: under a base, or else as the tail of tracked
 * paths, preferring the document's own folder and then sources over test mirrors. Empty when it
 * names none; every candidate, and `ambiguous`, when the tail names several.
 */
export function resolveDocPath(ref: string, { bases, tracked, extensions, home }: DocPathScope): { hits: string[]; ambiguous: boolean } {
  for (const base of bases) {
    const hit = pathCandidates(base + ref, extensions, [], { sources: false }).find((p) => tracked.has(p));
    if (hit) return { hits: [hit], ambiguous: false };
  }
  const all = [...tracked];
  for (const tail of pathCandidates(ref, extensions, [], { sources: false })) {
    const hits = all.filter((p) => p.endsWith(`/${tail}`));
    if (!hits.length) continue;
    // A module file names its own files by their tail, and a name its files share (each pipeline's
    // `facts.ts`) names all of them; a test mirror of a source folder is no rival.
    const own = home ? hits.filter((p) => p.startsWith(home) && !p.startsWith('src/__tests__/')) : [];
    if (own.length) return { hits: own, ambiguous: false };
    const sources = hits.filter((p) => !p.startsWith('src/__tests__/'));
    const named = sources.length ? sources : hits;
    return { hits: named, ambiguous: named.length > 1 };
  }
  return { hits: [], ambiguous: false };
}

/** What a file takes from one module. */
export interface ModuleUse {
  /** The specifier as written. */
  readonly spec: string;
  /** The imported names (`a` of `{ a as b }`, `default` for a default binding), or null when the
   *  file reaches the module whole: a namespace binding, a dynamic import, an `import('…')` type, a
   *  `require` or a `vi.mock` family call. */
  readonly names: readonly string[] | null;
  /** A loader hands the module on (`() => import('…')`, `return import('…')`): the top-level
   *  binding that holds the loader, whose callers reach the module's names; `*` when no top-level
   *  binding holds it, null when the module does not escape. */
  readonly via: string | null;
}

/** `export { name as as } from spec`; `name` and `as` are `*` for `export * from spec`. */
export interface ReExport {
  readonly spec: string;
  readonly name: string;
  readonly as: string;
}

/** A served-path dynamic import written inside a string. */
const SERVED_IMPORT = /\bimport\(\s*['"`](\/src\/[^'"`]+)['"`]\s*\)/g;

/** The name of the top-level variable or function `node` sits in, or `*`. */
function holder(node: ts.Node): string {
  let at: ts.Node = node;
  while (at.parent && !ts.isSourceFile(at.parent)) at = at.parent;
  if (ts.isVariableStatement(at)) {
    const name = at.declarationList.declarations[0]?.name;
    if (name && ts.isIdentifier(name)) return name.text;
  }
  if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
  return '*';
}

/** The module uses and re-exports of `text` (default: the file's contents). A re-export is no use by
 *  the re-exporting file: the name's users are the files that import it from there. */
export function moduleBindings(path: string, text?: string): { uses: ModuleUse[]; reexports: ReExport[] } {
  const source = parseSource(path, text);
  const uses: ModuleUse[] = [];
  const reexports: ReExport[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = literalText(node.moduleSpecifier);
      const clause = node.importClause;
      const named = clause?.namedBindings;
      if (spec === null || !clause) {
        // A side-effect import evaluates the module and takes no name.
      } else if (named && ts.isNamespaceImport(named)) {
        uses.push({ spec, names: null, via: null });
      } else {
        const names = named ? named.elements.map((e) => (e.propertyName ?? e.name).text) : [];
        uses.push({ spec, names: clause.name ? [...names, 'default'] : names, via: null });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const spec = literalText(node.moduleSpecifier);
      const clause = node.exportClause;
      if (spec === null) {
        // Not a literal specifier.
      } else if (!clause) {
        reexports.push({ spec, name: '*', as: '*' });
      } else if (ts.isNamespaceExport(clause)) {
        uses.push({ spec, names: null, via: null });
      } else {
        for (const e of clause.elements) reexports.push({ spec, name: (e.propertyName ?? e.name).text, as: e.name.text });
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = literalText(node.argument.literal);
      if (spec !== null) uses.push({ spec, names: null, via: null });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const loads = callee.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(callee) && callee.text === 'require')
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi' && MOCK_CALLS.has(callee.name.text));
      const spec = loads ? literalText(node.arguments[0]) : null;
      const parent = node.parent;
      const escapes = callee.kind === ts.SyntaxKind.ImportKeyword && (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === node));
      if (spec !== null) uses.push({ spec, names: null, via: escapes ? holder(node) : null });
    } else if (ts.isTemplateLiteralToken(node) || ts.isStringLiteral(node)) {
      // Code a harness hands the page as text imports through the dev server.
      for (const m of node.text.matchAll(SERVED_IMPORT)) uses.push({ spec: m[1]!, names: null, via: null });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { uses, reexports };
}
