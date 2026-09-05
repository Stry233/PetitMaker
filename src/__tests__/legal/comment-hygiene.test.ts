import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, readFileSync, readdirSync } from 'node:fs';

interface Entry {
  name: string;
  isDirectory(): boolean;
}

interface Comment {
  line: number;
  text: string;
}

const FORBIDDEN = [
  { label: 'private path', pattern: /(?:docs|scripts)\/internal\/|\.(?:claude|superpowers)\//i },
  { label: 'private instruction file', pattern: /\b(?:AGENTS|CLAUDE)\.md\b/ },
  { label: 'private design shorthand', pattern: /\bnormative (?:prototype|artifact)\b/i },
  { label: 'numbered private specification', pattern: /\bspec(?:ification)?\s*(?:§\s*|v?\d+\.)?\d/i },
  { label: 'request narration', pattern: /\b(?:as|per) requested\b/i },
  { label: 'work-item narration', pattern: /\b(?:finding|task|wave)\s+#?\d+\b/i },
  { label: 'hard-coded provider count', pattern: /\b(?:\d+|eight|nine|ten|eleven|twelve)\s+(?:built-in\s+)?(?:agent\s+)?(?:providers?|platforms?)\b/i },
] as const;

const COMMENT_FORBIDDEN = [
  ...FORBIDDEN,
  { label: 'incident narration', pattern: /\bregression\b/i },
  { label: 'issue narration', pattern: /\bissue\s*#\s*\d/i },
  { label: 'live-run anecdote', pattern: /\blive runs?\b[^\n]*(?:burned|cleared|failed|pushed|dropped|handed)/i },
  {
    label: 'past-behavior narration',
    pattern: /\b(?:used to be|(?:was|were|had|did) previously|previously (?:was|were|had|did|fell|showed|rendered|returned|allowed|prevented|wrote|held|carried|counted|published|shipped))\b/i,
  },
  { label: 'defensive narration', pattern: /\b(?:safe here because|this is fine (?:because|since))\b/i },
  { label: 'retired-surface narration', pattern: /\b(?:legacy|retired)\s+(?:site log|ui|panel|surface)\b/i },
  { label: 'incident-specific narration', pattern: /\b(?:reported broken|once slipped|user(?:'s|’s)\s+[^\n.]{0,40}\bbug)\b/i },
] as const;

const PUBLIC_CODE_FILES = [
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.setup.ts',
  'scripts/build-legal-pages.mts',
  'scripts/legal-pages-core.mts',
  'scripts/license-audit.mts',
  'scripts/license-audit-core.mts',
  'scripts/generate-headers.mts',
  'scripts/generate-headers-core.mts',
  'scripts/stamp-build.mts',
  'scripts/build-info-core.mts',
  'scripts/validate-legal-release.mts',
  'scripts/export-public-repo.mts',
  'scripts/export-public-repo-core.mts',
] as const;

function sourceFiles(dir: string): string[] {
  return (readdirSync(dir, { withFileTypes: true }) as Entry[]).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name.includes('.internal.')) return [];
    return [path];
  });
}

function markdownFiles(dir: string): string[] {
  return (readdirSync(dir, { withFileTypes: true }) as Entry[]).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (path === 'docs/internal') return [];
      return markdownFiles(path);
    }
    if (!entry.name.endsWith('.md') || /^(?:AGENTS|CLAUDE)\.md$/.test(entry.name)) return [];
    return [path];
  });
}

function filesWithSuffix(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { withFileTypes: true }) as Entry[]).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesWithSuffix(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

function publicMarkdownFiles(): string[] {
  const root = (readdirSync('.', { withFileTypes: true }) as Entry[])
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md') && !/^(?:AGENTS|CLAUDE)\.md$/.test(entry.name))
    .map((entry) => entry.name);
  return [...root, ...markdownFiles('docs'), ...markdownFiles('src')];
}

function publicSourceFiles(): string[] {
  return [
    ...sourceFiles('src'),
    ...sourceFiles('security'),
    ...PUBLIC_CODE_FILES.filter((path) => existsSync(path)),
  ];
}

function publicTextArtifacts(): string[] {
  return [
    'index.html',
    ...filesWithSuffix('docs/media', '.svg'),
  ].filter((path) => existsSync(path));
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function comments(path: string, text: string): Comment[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const found: Comment[] = [];
  const seen = new Set<number>();
  const add = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      found.push({ line: lineAt(text, range.pos), text: text.slice(range.pos, range.end) });
    }
  };
  const visit = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe('public source comment hygiene', () => {
  it('states current facts without private pointers or development-work narration', () => {
    const violations: string[] = [];
    for (const path of publicSourceFiles()) {
      const text = readFileSync(path, 'utf8') as string;
      for (const comment of comments(path, text)) {
        for (const rule of COMMENT_FORBIDDEN) {
          if (rule.pattern.test(comment.text)) violations.push(`${path}:${comment.line}: ${rule.label}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps public test prose free of issue-tracker narration', () => {
    const violations: string[] = [];
    for (const path of publicSourceFiles()) {
      if (!path.includes('/__tests__/') || path.endsWith('/comment-hygiene.test.ts')) continue;
      const text = readFileSync(path, 'utf8') as string;
      for (const match of text.matchAll(/\bissue\s*#\s*\d/gi)) {
        violations.push(`${path}:${lineAt(text, match.index)}: issue narration`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps public Markdown free of private pointers and development-work narration', () => {
    const violations: string[] = [];
    for (const path of publicMarkdownFiles()) {
      const text = readFileSync(path, 'utf8') as string;
      for (const rule of FORBIDDEN) {
        for (const match of text.matchAll(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`))) {
          violations.push(`${path}:${lineAt(text, match.index)}: ${rule.label}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps public text artifacts free of private pointers and development-work narration', () => {
    const violations: string[] = [];
    for (const path of publicTextArtifacts()) {
      const body = readFileSync(path, 'utf8') as string;
      for (const rule of FORBIDDEN) {
        for (const match of body.matchAll(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`))) {
          violations.push(`${path}:${lineAt(body, match.index)}: ${rule.label}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
