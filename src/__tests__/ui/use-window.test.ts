/**
 * A window the store opens reads its flag and closes through `useWindow`; a window its own surface
 * opens from local state is listed below with that surface. Every window starts from a
 * `WINDOW_SIZES` preset and may override its width and cap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { useEditorStore } from '../../state/store';
import { walkFiles } from '../_support/source-graph';

const UI = resolve('src/ui');

/** Windows opened by their own surface's state rather than a store flag, and that surface. */
const STATE_DRIVEN: Readonly<Record<string, string>> = {
  'primitives/ConfirmationModal.tsx': 'the generic confirmation, opened from its caller\'s state',
  'chrome/modals/export/review/ExportNotice.tsx': 'the export it stands in front of, which awaits its decision',
  'chrome/modals/import/DropImportOverlay.tsx': 'a file dragged over the page',
  'chrome/guards/PortraitGuard.tsx': 'the device held the wrong way',
};

/** Store flags whose surface is not a `ModalShell` window, and what it is instead. */
const NOT_WINDOWS: Readonly<Record<string, string>> = {
  preview3d: 'the 3D preview takes over the screen; its host mounts it while the flag is on',
};

const sources = (dir: string): string[] => walkFiles(dir, { accept: /\.tsx$/ });

const files = sources(UI)
  .map((full) => ({ path: relative(UI, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') }))
  .filter((f) => f.path !== 'primitives/ModalShell.tsx');
const windows = files.filter((f) => f.text.includes('<ModalShell'));

/** The text of each `<ModalShell ...>` opening tag: up to the first `>` outside braces and quotes. */
function openingTags(text: string): string[] {
  const tags: string[] = [];
  for (let at = text.indexOf('<ModalShell'); at !== -1; at = text.indexOf('<ModalShell', at + 1)) {
    let depth = 0;
    let quote: string | null = null;
    let i = at + 1;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(text.slice(at, i + 1));
  }
  return tags;
}

describe('windows', () => {
  it('are found by the walk', () => {
    expect(windows.length).toBeGreaterThanOrEqual(15);
  });

  it('read a store flag through useWindow unless their own surface opens them', () => {
    const unowned = windows.filter((f) => !/\buseWindow\(/.test(f.text) && !(f.path in STATE_DRIVEN)).map((f) => f.path);
    const listedButStored = Object.keys(STATE_DRIVEN).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !file.text.includes('<ModalShell') || /\buseWindow\(/.test(file.text);
    });
    expect({ unowned, listedButStored }).toEqual({ unowned: [], listedButStored: [] });
  });

  it('give every store window flag a window that reads it', () => {
    const read = new Set(files.flatMap((f) => [...f.text.matchAll(/\buseWindow\(\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1]!)));
    const unread = Object.keys(useEditorStore.getInitialState().modals).filter((id) => !read.has(id) && !(id in NOT_WINDOWS));
    const listedButRead = Object.keys(NOT_WINDOWS).filter((id) => read.has(id));
    expect({ unread, listedButRead }).toEqual({ unread: [], listedButRead: [] });
  });

  it('start from a WINDOW_SIZES preset', () => {
    const unsized = windows.flatMap((f) => openingTags(f.text).filter((tag) => !/\bsize="/.test(tag)).map(() => f.path));
    expect(unsized).toEqual([]);
  });
});
