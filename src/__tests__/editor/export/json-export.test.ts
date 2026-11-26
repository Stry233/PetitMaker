// @vitest-environment jsdom
/** The save file's export through its verb: the notice, the map check, a run overtaken by a change,
 *  the words' check and the write, and the one rule both export windows grey Export by. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { makeState } from '../../_support/map-state';
import { resetStore, setStoreState } from '../../_support/store';
import { exportJson, initialSections } from '../../../editor/export/json-export';
import { exportUnavailable } from '../../../editor/export/availability';
import type { MapReview } from '../../../editor/review/map-review';
import type { ReviewResult } from '../../../editor/review/text-review';

vi.mock('../../../io/export/download', async (orig) => ({ ...(await orig<typeof import('../../../io/export/download')>()), downloadJSON: vi.fn() }));
import { downloadJSON } from '../../../io/export/download';

const available = { generation: false, provenance: false };
const sections = { ...initialSections(available), notes: true };
const notes = { title: 'Garden', description: '' };

function hooks(over: { notice?: boolean; map?: MapReview; words?: ReviewResult } = {}) {
  return {
    checkMap: vi.fn(async () => over.map ?? { status: 'clear' } as MapReview),
    cancelMapCheck: vi.fn(),
    checkText: vi.fn(async () => over.words ?? { allowed: true } as ReviewResult),
    confirmNotice: vi.fn(async () => over.notice ?? true),
    begin: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  resetStore();
  vi.mocked(downloadJSON).mockClear();
  const state = makeState(8, 8);
  setStoreState({ gridState: state, commandExecutor: createExecutor(state, createDefaultRegistry()), locale: 'en', exportedAt: null });
});

describe('exportJson', () => {
  it('writes the file once the notice is confirmed and the map check passes, and marks the map exported', async () => {
    const h = hooks();
    const outcome = await exportJson({ sections, notes }, { ...h, signal: new AbortController().signal });
    expect(outcome.status).toBe('done');
    expect(h.checkText).toHaveBeenCalledWith([{ field: 'title', text: 'Garden' }]);
    expect(vi.mocked(downloadJSON)).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(downloadJSON).mock.calls[0]![0]).notes).toMatchObject({ title: 'Garden' });
    expect(useEditorStore.getState().exportedAt).not.toBeNull();
  });

  it('writes nothing when the notice is declined, the map check refuses, the words are refused or a change overtakes it', async () => {
    const declined = hooks({ notice: false });
    expect((await exportJson({ sections, notes }, { ...declined, signal: new AbortController().signal })).status).toBe('stopped');
    expect(declined.cancelMapCheck).toHaveBeenCalled();

    const blocked = hooks({ map: { status: 'blocked', kind: 'image' } });
    expect((await exportJson({ sections, notes }, { ...blocked, signal: new AbortController().signal })).status).toBe('stopped');

    const refused = hooks({ words: { allowed: false, fields: ['title'] } as ReviewResult });
    expect((await exportJson({ sections, notes }, { ...refused, signal: new AbortController().signal })).status).toBe('held');

    const run = new AbortController();
    const overtaken = hooks();
    overtaken.begin.mockImplementation(async () => { run.abort(); });
    expect((await exportJson({ sections, notes }, { ...overtaken, signal: run.signal })).status).toBe('stopped');

    expect(vi.mocked(downloadJSON)).not.toHaveBeenCalled();
    expect(useEditorStore.getState().exportedAt).toBeNull();
  });
});

describe('when Export is unavailable', () => {
  const standing = { exporting: false, composing: false, map: { pending: false, blocked: false }, words: 'approved' as const };

  it('is the same rule for both windows, apart from words the export checks itself', () => {
    expect(exportUnavailable(standing, true)).toBe(false);
    for (const over of [{ exporting: true }, { composing: true }, { map: { pending: true, blocked: false } }, { map: { pending: false, blocked: true } }, { words: 'refused' as const }]) {
      expect(exportUnavailable({ ...standing, ...over }, true), JSON.stringify(over)).toBe(true);
      expect(exportUnavailable({ ...standing, ...over }, false), JSON.stringify(over)).toBe(true);
    }
    expect(exportUnavailable({ ...standing, words: 'unsettled' }, true)).toBe(false);
    expect(exportUnavailable({ ...standing, words: 'unsettled' }, false)).toBe(true);
  });
});
