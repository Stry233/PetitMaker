/*
 * Markdown.tsx — minimal markdown renderer for agent chat bubbles. Covers what
 * LLMs actually emit in chat (code fences, inline code, bold/italic, headings,
 * bullet/numbered lists, paragraphs) with plain React elements — no
 * dangerouslySetInnerHTML, no dependency. Token-grid snippets ride in code
 * fences and render monospace, which keeps map snapshots column-aligned.
 */
import { Fragment, useRef, type ReactNode } from 'react';
import { inkTint } from '../design/styles';
import { useScrollFade } from '../primitives/scroll-fade';

/** Inline spans: `code`, **bold**, *italic*. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // tokenize by code first so bold/italic never match inside backticks
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part, pi) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(
        <code key={`${keyBase}-c${pi}`} style={{ fontFamily: 'ui-monospace, monospace', background: inkTint(0.08), borderRadius: '0.25em', padding: '0 0.3em', fontSize: '0.92em' }}>
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    const segs = part.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
    segs.forEach((seg, si) => {
      const key = `${keyBase}-${pi}-${si}`;
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
        out.push(<strong key={key}>{seg.slice(2, -2)}</strong>);
      } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
        out.push(<em key={key}>{seg.slice(1, -1)}</em>);
      } else if (seg) {
        out.push(<Fragment key={key}>{seg}</Fragment>);
      }
    });
  });
  return out;
}

/** A fenced code block's own component, rather than the `<pre>` `chunks.forEach` used to push
 *  directly: `forEach` runs a plain callback, so a hook call in it would fire a variable number of
 *  times per `Markdown` render (once per fence in the message) and break the rules of hooks. A real
 *  component sidesteps that, the same move `LegalMarkdown.tsx`'s `TableWrap` makes. */
function CodeBlock({ children }: { children: string }): ReactNode {
  const ref = useRef<HTMLPreElement>(null);
  const fade = useScrollFade(ref, 'x');
  return (
    <pre ref={ref} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82em', lineHeight: 1.35, background: inkTint(0.07), borderRadius: '0.4em', padding: '0.5em 0.7em', overflowX: 'auto', margin: '0.3em 0', whiteSpace: 'pre', ...fade }}>
      {children}
    </pre>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  // split out fenced code blocks first
  const chunks = text.split(/```(?:[a-z]*\n)?/);
  chunks.forEach((chunk, ci) => {
    if (ci % 2 === 1) {
      blocks.push(<CodeBlock key={`f${ci}`}>{chunk.replace(/\n$/, '')}</CodeBlock>);
      return;
    }
    // group plain lines into paragraphs / lists / headings / tables
    const lines = chunk.split('\n');
    let list: { ordered: boolean; items: string[] } | null = null;
    let table: string[][] | null = null;
    const flushTable = (key: string) => {
      if (!table || table.length === 0) {
        table = null;
        return;
      }
      blocks.push(
        <table key={key} style={{ borderCollapse: 'collapse', margin: '0.3em 0', fontSize: '0.92em' }}>
          <tbody>
            {table.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: `1px solid ${inkTint(0.25)}`, padding: '0.15em 0.5em', fontWeight: ri === 0 ? 800 : 600 }}>
                    {inline(cell, `${key}-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      table = null;
    };
    const flushList = (key: string) => {
      if (!list) return;
      const items = list.items.map((item, ii) => <li key={ii} style={{ margin: '0.1em 0' }}>{inline(item, `${key}-li${ii}`)}</li>);
      blocks.push(
        list.ordered
          ? <ol key={key} style={{ margin: '0.2em 0', paddingInlineStart: '1.4em' }}>{items}</ol>
          : <ul key={key} style={{ margin: '0.2em 0', paddingInlineStart: '1.3em' }}>{items}</ul>,
      );
      list = null;
    };
    lines.forEach((line, li) => {
      const key = `b${ci}-${li}`;
      // tables: | a | b | rows; the |---|---| separator row is skipped
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushList(`${key}-pre`);
        if (!/^\s*\|[\s\-:|]+\|\s*$/.test(line)) {
          const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
          table = table ?? [];
          table.push(cells);
        }
        return;
      }
      flushTable(`${key}-tbl`);
      // horizontal rule
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushList(`${key}-pre`);
        blocks.push(<div key={key} style={{ borderTop: `1px solid ${inkTint(0.2)}`, margin: '0.45em 0' }} />);
        return;
      }
      // blockquote
      const quote = line.match(/^\s*>\s?(.*)/);
      if (quote) {
        flushList(`${key}-pre`);
        blocks.push(
          <div key={key} style={{ borderLeft: `3px solid ${inkTint(0.25)}`, paddingLeft: '0.6em', opacity: 0.85, margin: '0.15em 0' }}>
            {inline(quote[1]!, key)}
          </div>,
        );
        return;
      }
      const bullet = line.match(/^\s*[-*]\s+(.*)/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
      const heading = line.match(/^(#{1,4})\s+(.*)/);
      if (bullet || numbered) {
        const ordered = Boolean(numbered);
        if (!list || list.ordered !== ordered) {
          flushList(`${key}-pre`);
          list = { ordered, items: [] };
        }
        list.items.push((bullet ?? numbered)![1]!);
        return;
      }
      flushList(`${key}-list`); // distinct from the heading/paragraph block below, which reuses `key`
      if (heading) {
        blocks.push(
          <div key={key} style={{ fontWeight: 900, fontSize: heading[1]!.length === 1 ? '1.12em' : '1.05em', margin: '0.35em 0 0.1em' }}>
            {inline(heading[2]!, key)}
          </div>,
        );
      } else if (line.trim()) {
        blocks.push(<div key={key} style={{ margin: '0.1em 0' }}>{inline(line, key)}</div>);
      } else if (li > 0 && li < lines.length - 1) {
        blocks.push(<div key={key} style={{ height: '0.45em' }} />);
      }
    });
    flushList(`b${ci}-end`);
    flushTable(`b${ci}-endtbl`);
  });
  return <>{blocks}</>;
}
