import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { HELP_PAGES } from '../../../ui/chrome/modals/help/catalog';
import type { HelpPageId } from '../../../ui/chrome/modals/help/page-schema';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : []);
}

describe('context help coverage', () => {
  it('requires a topic on every application dialog and resolves literal section targets', () => {
    const failures: string[] = [];
    const check = (file: string, page: string, anchor?: string) => {
      const content = HELP_PAGES[page as HelpPageId];
      if (!content || (anchor && !content.sections.some(section => 'anchor' in section && section.anchor === anchor))) failures.push(`${file}: ${page}/${anchor ?? ''}`);
    };
    for (const file of sources('src/ui')) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          if (node.tagName.getText(source) === 'ModalShell' && !node.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'helpTarget')) failures.push(`${file}: dialog missing helpTarget`);
        }
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'helpTargetAttr') {
          const [page, anchor] = node.arguments;
          if (page && ts.isStringLiteral(page)) check(file, page.text, anchor && ts.isStringLiteral(anchor) ? anchor.text : undefined);
        }
        if (ts.isJsxAttribute(node) && node.name.getText(source) === 'helpTarget' && node.initializer && ts.isJsxExpression(node.initializer)) {
          const value = node.initializer.expression;
          if (value && ts.isObjectLiteralExpression(value)) {
            const fields = Object.fromEntries(value.properties.flatMap(p => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer) ? [[p.name.getText(source), p.initializer.text]] : []));
            if (fields.page) check(file, fields.page, fields.anchor);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(failures).toEqual([]);
  });
});
