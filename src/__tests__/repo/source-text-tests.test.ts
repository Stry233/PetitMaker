/**
 * A test pins behaviour by running the code, not by reading its text: a test that matches a
 * production file's source breaks on a rename and passes when the behaviour breaks. Repository guards
 * that read the source on purpose (layering, literals, comment and naming rules) are the exception.
 * A test names a production source file when one of its strings, outside imports, mocks and test
 * names, resolves to a `.ts`, `.tsx`, `.mts` or `.css` file under `src/` outside the tests, or when it
 * imports one with `?raw`. Internal tests are withheld from the public tree and not read.
 * `source-text-allowlist.json` lists each such test under `guard`, with its reason: it reads source
 * by design (a layering, literal or naming rule, or a stylesheet the test environment does not
 * apply), or names a path as data or as what it loads. A behaviour is pinned by running the code.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ALLOWLIST from './source-text-allowlist.json';
import { parseSource, repoFiles } from '../_support/source-graph';

const allowed = ALLOWLIST as { guard: Record<string, string> };

const walk = (dir: string): string[] => repoFiles(dir, { accept: /\.[cm]?[jt]sx?$/ });

const CODE = /\.(?:tsx?|mts|css)$/;
const TEST_CALLEES = new Set(['describe', 'it', 'test', 'bench']);
const isProductionSource = (path: string) => path.startsWith('src/') && !path.startsWith('src/__tests__/') && CODE.test(path) && existsSync(path);

/** The production source file a string names, read from the repository root, the test's folder,
 *  `src/`, or a folder another string of the test names (`src/ui/shell/` beside `'Shell.tsx'`). */
function namedSource(testPath: string, text: string, folders: readonly string[]): string | null {
  const value = text.split('?')[0]!;
  if (!CODE.test(value) || /^[a-z]+:/i.test(value)) return null;
  const rooted = value.replace(/^\/+/, '');
  const candidates = [
    ...(value.includes('/') ? [rooted, join(dirname(testPath), value), join('src', rooted)] : []),
    ...folders.map((folder) => join(folder, rooted)),
  ].map((p) => normalize(p).replace(/\\/g, '/'));
  return candidates.find(isProductionSource) ?? null;
}

/** Whether a string node is an import or mock specifier, or a test's name. */
function isExempt(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return !ts.isStringLiteral(node) || !node.text.includes('?raw');
  if (ts.isCallExpression(parent)) {
    let callee: ts.Expression = parent.expression;
    if ((callee.kind as ts.SyntaxKind) === ts.SyntaxKind.ImportKeyword) return !(ts.isStringLiteral(node) && node.text.includes('?raw'));
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi') return true;
    while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) callee = callee.expression;
    if (ts.isIdentifier(callee) && TEST_CALLEES.has(callee.text) && parent.arguments[0] === node) return true;
  }
  return false;
}

/** The production source files a test names. */
function sourcesNamed(path: string, text: string): string[] {
  const file = parseSource(path, text);
  const strings: string[] = [];
  const visit = (node: ts.Node) => {
    const parts = ts.isStringLiteralLike(node) ? [node.text]
      : ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)] : [];
    if (parts.length > 0 && !isExempt(node)) strings.push(...parts);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const folders = strings.filter((part) => /^src\/[\w./-]*\/$/.test(part));
  return [...new Set(strings.map((part) => namedSource(path, part, folders)).filter((p): p is string => p !== null))];
}

const readers = walk('src/__tests__').filter((path) => !path.includes('.internal.') && sourcesNamed(path, readFileSync(path, 'utf8') as string).length > 0).sort();

describe('tests that read production source text', () => {
  it('are each listed as a source guard', () => {
    expect(readers.filter((path) => !(path in allowed.guard)),
      'assert on the running code, or list a guard that reads source by design under guard').toEqual([]);
  });

  it('keeps the allowlist exact, so a rewritten test comes off it', () => {
    const listed = Object.keys(allowed.guard);
    expect(listed.filter((path) => !readers.includes(path))).toEqual([]);
  });

  it('reads a named source file, and leaves imports, fixtures and test names alone', () => {
    const planted = [
      "import { x } from '../../ui/design/styles';",
      "import raw from '../../ui/design/styles.ts?raw';",
      "vi.mock('../../ui/design/styles.ts', () => ({}));",
      "it('src/ui/design/styles.ts holds the tokens', () => {});",
      "const fixture = readFileSync('src/__tests__/fixtures/a.json', 'utf8');",
      "const text = readFileSync(`${ROOT}/src/ui/design/styles.ts`, 'utf8');",
    ].join('\n');
    const listed = "['styles.ts', 'tokens.ts'].map((f) => readFileSync(`src/ui/design/${f}`, 'utf8'));";
    expect(sourcesNamed('src/__tests__/ui/x.test.ts', listed)).toEqual(['src/ui/design/styles.ts', 'src/ui/design/tokens.ts']);
    expect(sourcesNamed('src/__tests__/ui/x.test.ts', planted)).toEqual(['src/ui/design/styles.ts']);
    expect(sourcesNamed('src/__tests__/ui/x.test.ts', planted.split('\n').slice(0, 5).join('\n'))).toEqual(['src/ui/design/styles.ts']);
    expect(sourcesNamed('src/__tests__/ui/x.test.ts', planted.split('\n').filter((_, i) => i !== 1 && i !== 5).join('\n'))).toEqual([]);
  });
});
