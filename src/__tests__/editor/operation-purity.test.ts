/**
 * An operation that speaks to the user can only ever have one caller. These modules run below the
 * layer that knows what a toast is, and the import check is what keeps it that way: it resolves
 * each import edge to the module it loads, so a renamed binding or a moved module cannot slip past.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, importEdges, resolveModule, sourceText, srcRelative, walkFiles } from '../_support/source-graph';

/** What an operation's text must not do. */
const FORBIDDEN = [
  { pattern: /\bshowToast\s*\(/,              why: 'shows a toast' },
  { pattern: /\btranslate\w*\s*\(/,           why: 'localizes its own message' },
  { pattern: /\bwindow\./,                    why: 'reaches for the window' },
  { pattern: /\bdocument\./,                  why: 'reaches for the document' },
];

/** The modules an operation must not load at runtime, src-relative without extension. */
const FORBIDDEN_MODULES: readonly { test: (module: string) => boolean; why: string }[] = [
  { test: (m) => m === 'platform/channels/toast-bus' || m === 'ui/chrome/floating/Toast', why: 'shows a toast' },
  { test: (m) => m.startsWith('i18n/'), why: 'localizes its own message' },
  { test: (m) => m.startsWith('ui/'), why: 'reaches into the UI' },
];
/** Packages an operation must not import. */
const FORBIDDEN_PACKAGES = [{ test: (spec: string) => spec === 'react' || spec.startsWith('react/') || spec === 'react-dom', why: 'imports React' }];

const filesUnder = (dir: string): string[] => walkFiles(dir);

/** The src-relative module, without extension, a relative specifier of `file` loads. */
const moduleOf = (file: string, spec: string): string | null => {
  const target = resolveModule(file, spec);
  return target ? srcRelative(target).replace(/\.tsx?$/, '').replace(/\/index$/, '') : null;
};
/** The modules `file` loads at runtime, dynamic imports included. */
const runtimeModules = (file: string): string[] =>
  importEdges(file).filter((e) => !e.typeOnly).flatMap((e) => moduleOf(file, e.spec) ?? []);

/** The pointer binding receives ToolContext and reports outcomes; macro bodies stay silent. */
const isToolBinding = (file: string): boolean => ['pointer/macros/macro-tool.ts', 'pointer/macros/drag-tool.ts', 'pointer/macros/spray-tool.ts'].some(binding => file.endsWith(binding));

describe('operations stay silent', () => {
  it('never narrates its own result', () => {
    const roots = [join(SRC, 'editor/operations'), join(SRC, 'tools/generation/run'), join(SRC, 'tools/macros'), join(SRC, 'tools/objects')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of filesUnder(root)) {
        if (isToolBinding(file)) continue;
        const text = sourceText(file);
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(text)) offenders.push(`${srcRelative(file)} ${why}`);
        }
        const modules = runtimeModules(file);
        for (const { test, why } of FORBIDDEN_MODULES) {
          if (modules.some(test)) offenders.push(`${srcRelative(file)} ${why}`);
        }
        const specs = importEdges(file).map((e) => e.spec);
        for (const { test, why } of FORBIDDEN_PACKAGES) {
          if (specs.some(test)) offenders.push(`${srcRelative(file)} ${why}`);
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('takes the editor as a port, never the live context itself (editor/operations)', () => {
    const offenders = filesUnder(join(SRC, 'editor/operations')).filter((file) => runtimeModules(file).includes('editor/session/context'));
    expect(offenders.map(srcRelative)).toEqual([]);
  });

  // The broader tool-store boundary is enforced by repo/import-direction.test.ts.
  it('never imports the store at runtime (editor/operations, the generation run and tools/macros)', () => {
    const roots = [join(SRC, 'editor/operations'), join(SRC, 'tools/generation/run'), join(SRC, 'tools/macros')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of filesUnder(root)) {
        if (isToolBinding(file)) continue;
        if (runtimeModules(file).includes('state/store')) offenders.push(srcRelative(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves what an edge loads, whatever the binding is called', () => {
    const file = join(SRC, 'editor/operations/example.ts');
    const text = [
      "import { batchStore as run } from '../../state/store';",
      "import { showToast as say } from '../../platform/channels/toast-bus';",
      "import type { I18nKey } from '../../i18n/keys';",
      "const t = () => import('../../i18n/context');",
    ].join('\n');
    const loaded = importEdges(file, text).filter((e) => !e.typeOnly).flatMap((e) => moduleOf(file, e.spec) ?? []);
    expect(loaded).toEqual(['state/store', 'platform/channels/toast-bus', 'i18n/context']);
  });
});
