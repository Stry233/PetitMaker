/**
 * A sentence is one key with params, never translated pieces glued with fixed punctuation or word
 * order: `${t('a')}: ${x}` reads in English order in every locale, and its colon, comma or space is
 * wrong in Chinese, Japanese and Thai. So no source that words copy (the interface, the assistant and
 * the editor's notices) joins a `t()` or `translate()` result with other text in a template, with `+`,
 * or through `[...].join()`; a list of names goes through `locale-info.ts:joinList`.
 * `composed-copy-allowlist.json` lists the few joins that are not sentences, each with its reason.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { parseSource, repoFiles, sourceText } from '../_support/source-graph';
import ALLOWLIST from './composed-copy-allowlist.json';

/** file -> the joining expression as written -> why it is not a sentence. */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = ALLOWLIST;

/** The translators a source words copy through. */
const TRANSLATORS: ReadonlySet<string> = new Set(['t', 'translate']);

const isTranslation = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TRANSLATORS.has(node.expression.text);

const isText = (node: ts.Node): boolean =>
  ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || isTranslation(node);

/** Each expression in `text` (default: the file's) that joins a translation with other text, as written. */
function joins(path: string, text: string = sourceText(path)): string[] {
  const file = parseSource(path, text);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      const alone = node.head.text === '' && node.templateSpans.length === 1 && node.templateSpans[0]!.literal.text === '';
      if (!alone && node.templateSpans.some((span) => isTranslation(span.expression))) out.push(node.getText(file));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const { left, right } = node;
      if ((isTranslation(left) && isText(right)) || (isTranslation(right) && isText(left))) out.push(node.getText(file));
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
      let target: ts.Expression = node.expression.expression;
      while (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression)) target = target.expression.expression;
      if (ts.isArrayLiteralExpression(target) && target.elements.some(isTranslation)) out.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const SOURCES = ['src/ui', 'src/lite', 'src/agent', 'src/editor'].flatMap((dir) => repoFiles(dir));

describe('composed copy', () => {
  it('no interface source glues a translation to other text', () => {
    const found = SOURCES.flatMap((path) => joins(path)
      .filter((text) => ALLOWED[path]?.[text] === undefined)
      .map((text) => `${path}: ${text}`));
    expect(found, 'give the sentence its own key with params').toEqual([]);
  });

  it('allows only joins that are still there', () => {
    const stale = Object.entries(ALLOWED).flatMap(([path, entries]) => {
      const present = new Set(joins(path));
      return Object.keys(entries).filter((text) => !present.has(text)).map((text) => `${path}: ${text}`);
    });
    expect(stale).toEqual([]);
  });

  it('reads each joining form and leaves a lone translation or a built key alone', () => {
    const planted = [
      "const a = `${t('x')}: ${n}`;",
      "const b = t('x') + ', ';",
      "const c = [t('x'), n].filter(Boolean).join(', ');",
      "const d = `${t('x')}`;",
      "const e = t(`context.rotate_${o}`);",
      "const f = `${translate('x')}: ${n}`;",
      "const g = translate('x', { n });",
    ].join('\n');
    expect(joins('src/ui/planted.ts', planted)).toEqual([
      "`${t('x')}: ${n}`", "t('x') + ', '", "[t('x'), n].filter(Boolean).join(', ')", "`${translate('x')}: ${n}`",
    ]);
    expect(SOURCES.length).toBeGreaterThan(100);
  });
});
