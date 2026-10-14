/**
 * The comments of a TypeScript or JavaScript source as the comment guards read them, from the syntax
 * tree `source-graph.ts` parses once per text and keeps by path.
 */
import * as ts from 'typescript';
import { parseSource } from './source-graph';

export interface Comment {
  /** 1-based line the comment starts on. */
  line: number;
  /** 1-based line the comment ends on. */
  endLine: number;
  /** Offset of the comment's first character. */
  pos: number;
  /** Offset just past the comment. */
  end: number;
  text: string;
}

/** Offsets of every `\n` in a text, ascending; the last text asked about is kept. */
let newlines: { text: string; at: number[] } | null = null;

/** 1-based line of `offset`, counting `\n` only. */
export function lineAt(text: string, offset: number): number {
  if (newlines?.text !== text) {
    const at: number[] = [];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) at.push(i);
    newlines = { text, at };
  }
  const { at } = newlines;
  let lo = 0, hi = at.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid]! < offset) lo = mid + 1; else hi = mid; }
  return lo + 1;
}

/** Comments found per path, kept while the syntax tree they were read from stays current. */
const cached = new Map<string, { source: ts.SourceFile; comments: Comment[] }>();

/** The file's syntax tree. */
export const parse = (path: string, text: string): ts.SourceFile => parseSource(path, text);

/** Every comment in the file in source order, including those before a closing brace or inside an
 *  empty JSX expression: the walk visits punctuation tokens too, whose leading trivia holds them. */
export function comments(path: string, text: string, source = parse(path, text)): Comment[] {
  const entry = cached.get(path);
  if (entry?.source === source) return entry.comments;
  const found: Comment[] = [];
  const seen = new Set<number>();
  const add = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      found.push(
        { line: lineAt(text, range.pos), endLine: lineAt(text, range.end - 1), pos: range.pos, end: range.end, text: text.slice(range.pos, range.end) },
      );
    }
  };
  const visit = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(source)) {
      if (child.kind !== ts.SyntaxKind.JsxText) visit(child);
    }
  };
  visit(source);
  found.sort((a, b) => a.pos - b.pos);
  cached.set(path, { source, comments: found });
  return found;
}
