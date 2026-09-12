import ts from 'typescript';
import * as constants from '../src/core/model/constants';
import { createDefaultRegistry } from '../src/rules';

type ReadSource = (path: string) => string;

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function declarations(read: ReadSource, path: string, names: readonly string[]): string {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const selected = names.map((name) => {
    const matches = source.statements.filter((node) => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.name.text === name;
      return ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(source) === name);
    });
    if (matches.length !== 1) throw new Error(`${path}: expected one declaration of ${name}`);
    return printer.printNode(ts.EmitHint.Unspecified, matches[0]!, source).trim();
  });
  return `Source: [${path}](../${path}).\n\n\`\`\`ts\n${selected.join('\n\n')}\n\`\`\``;
}

export function referenceBlocks(read: ReadSource): Record<string, string> {
  const scalarConstants = Object.entries(constants).filter(([, value]) => typeof value !== 'object');
  const rules = createDefaultRegistry().getRules();
  return {
    constants: [
      'Source: [src/core/model/constants.ts](../src/core/model/constants.ts).', '',
      '| Constant | Value |', '|---|---|',
      ...scalarConstants.map(([name, value]) => `| \`${name}\` | \`${JSON.stringify(value)}\` |`),
    ].join('\n'),
    rules: [
      'Source: [src/rules/index.ts](../src/rules/index.ts), through `createDefaultRegistry().getRules()`.', '',
      '| Order | Rule | Phase |', '|---|---|---|',
      ...rules.map((rule, index) => `| ${index + 1} | \`${rule.id}\` | ${rule.phase} |`),
    ].join('\n'),
    tool: declarations(read, 'src/tools/runtime/types.ts', ['Tool']),
    save: declarations(read, 'src/io/save-format/types.ts', ['CURRENT_VERSION', 'SaveObject', 'PersistedCamera', 'SaveFile']),
  };
}

/** Only marked regions are owned by the generator; missing or repeated markers refuse the write. */
export function rewriteReferenceDoc(markdown: string, blocks: Record<string, string>): string {
  let next = markdown;
  for (const [id, body] of Object.entries(blocks)) {
    const start = `<!-- generated:${id}:start -->`;
    const end = `<!-- generated:${id}:end -->`;
    if (next.split(start).length !== 2 || next.split(end).length !== 2) throw new Error(`Expected one marker pair for ${id}`);
    const from = next.indexOf(start) + start.length;
    const to = next.indexOf(end);
    if (from > to) throw new Error(`Reversed markers for ${id}`);
    next = `${next.slice(0, from)}\n\n${body}\n\n${next.slice(to)}`;
  }
  return next;
}
