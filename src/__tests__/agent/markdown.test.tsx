import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '../../ui/menu/agent/Markdown';

describe('agent chat markdown renderer', () => {
  it('renders bold, italic and inline code as elements (no raw markers)', () => {
    const { container } = render(<Markdown text={'I will **build a lake** with *flowers* and `paint_terrain`.'} />);
    expect(container.querySelector('strong')?.textContent).toBe('build a lake');
    expect(container.querySelector('em')?.textContent).toBe('flowers');
    expect(container.querySelector('code')?.textContent).toBe('paint_terrain');
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('`');
  });

  it('renders bullet and numbered lists', () => {
    const { container } = render(<Markdown text={'Plan:\n- pond\n- pavilion\n1. first\n2. second'} />);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders headings and fenced code monospace', () => {
    const { container } = render(<Markdown text={'## Plan\n```\n..33..\n..33..\n```\ndone'} />);
    expect(container.textContent).toContain('Plan');
    expect(container.textContent).not.toContain('##');
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('..33..');
  });

  it('emits no duplicate React keys when a list is followed by a paragraph or heading', () => {
    // The flushList() that terminates a list must NOT reuse the same line-derived
    // key as the paragraph/heading block on that line (both are `b{ci}-{li}`),
    // or React warns "two children with the same key" and may drop a block.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Markdown text={'- pond\n- pavilion\n- shore\n- ring\n- edge\nAll done.'} />);
    render(<Markdown text={'1. one\n2. two\n## Recap'} />);
    const dupKeyWarn = err.mock.calls.some((c) => String(c[0]).includes('same key'));
    expect(dupKeyWarn).toBe(false);
    err.mockRestore();
  });

  it('survives mid-stream partial markdown without throwing', () => {
    expect(() => render(<Markdown text={'partial **bo'} />)).not.toThrow();
    expect(() => render(<Markdown text={'open fence\n```\n..1'} />)).not.toThrow();
  });
});

describe('extended markdown (tables, rules, quotes)', () => {
  it('renders pipe tables without raw pipes', () => {
    const { container } = render(<Markdown text={'| item | count |\n|---|---|\n| trees | 5 |\n| flowers | 12 |'} />);
    const rows = container.querySelectorAll('tr');
    expect(rows).toHaveLength(3); // header + 2 body rows (separator skipped)
    expect(container.textContent).toContain('flowers');
    expect(container.textContent).not.toContain('|');
  });

  it('renders horizontal rules and blockquotes', () => {
    const { container } = render(<Markdown text={'above\n---\n> note from the agent\nbelow'} />);
    expect(container.textContent).toContain('note from the agent');
    expect(container.textContent).not.toContain('---');
    expect(container.textContent).not.toContain('>');
  });
});
