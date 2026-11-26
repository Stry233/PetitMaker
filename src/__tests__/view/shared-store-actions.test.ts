/**
 * The code both views share (the root of `view/`, `interaction/` and `shared/`) asks the store only for
 * what any feature's map asks: an action a feature's own slice declares (every slice but the shared
 * engine, edit, shell and prefs slices) is that feature's to call, so a press never runs one feature's
 * rule from the shared machine.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { SRC, sourceFiles, sourceText, srcRelative } from '../_support/source-graph';

/** The slices every feature's map shares; any other slice in `state/slices/` is a feature's own. */
const SHARED_SLICES: ReadonlySet<string> = new Set(['engine', 'edit', 'shell', 'prefs']);

/** The actions the `*Slice` interfaces of `text` declare: its methods and function-typed members. */
function sliceActions(text: string): string[] {
  const source = ts.createSourceFile('slice.ts', text, ts.ScriptTarget.Latest, true);
  return source.statements.flatMap((statement) => {
    if (!ts.isInterfaceDeclaration(statement) || !statement.name.text.endsWith('Slice')) return [];
    return statement.members.flatMap((m) => (
      ts.isMethodSignature(m) || (ts.isPropertySignature(m) && m.type && ts.isFunctionTypeNode(m.type)) ? [m.name.getText(source)] : []
    ));
  });
}

/** The names of `names` that `text` calls as a member (`store.name(...)`, `s().name(...)`). */
function memberCalls(text: string, names: ReadonlySet<string>): string[] {
  const source = ts.createSourceFile('module.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && names.has(node.expression.name.text)) {
      found.push(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const SLICES = join(SRC, 'state', 'slices');
const featureActions = new Map<string, string>(
  readdirSync(SLICES).filter((f) => f.endsWith('.ts') && !SHARED_SLICES.has(f.replace(/\.ts$/, '')))
    .flatMap((f) => sliceActions(sourceText(join(SLICES, f))).map((name): [string, string] => [name, f.replace(/\.ts$/, '')])),
);

const VIEW = join(SRC, 'view');
const sharedViewFiles = (): string[] => [
  ...readdirSync(VIEW).filter((f) => /\.tsx?$/.test(f)).map((f) => join(VIEW, f)),
  ...sourceFiles(join(VIEW, 'interaction')),
  ...sourceFiles(join(VIEW, 'shared')),
];

describe('shared view code and feature actions', () => {
  it('finds the feature slices\' actions to look for', () => {
    expect(featureActions.size).toBeGreaterThan(0);
  });

  it('never calls an action a feature\'s own slice declares', () => {
    const names = new Set(featureActions.keys());
    const offenders = sharedViewFiles().flatMap((file) => (
      memberCalls(sourceText(file), names).map((name) => `${srcRelative(file)} calls ${name} (state/slices/${featureActions.get(name)}.ts)`)
    ));
    expect(offenders).toEqual([]);
  });

  it('reads member calls, not a mention or a bare function of the same name', () => {
    const text = '// store.foldThing() in a comment\nfoldThing();\nuseEditorStore.getState().foldThing();\nconst f = s.foldThing;';
    expect(memberCalls(text, new Set(['foldThing']))).toEqual(['foldThing']);
  });
});
