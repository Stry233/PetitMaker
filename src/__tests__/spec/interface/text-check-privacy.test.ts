// @vitest-environment jsdom
/**
 * The text check stays on the device: every way a page can reach the network is watched while the
 * real check answers, and the page's storage is compared before and after.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { reviewText, type TextPart } from '../../../pipelines/moderation';
import { reviewCustomTags } from '../../../editor/review/background';
import { textVerdict } from '../../../state/text-verdicts';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';

const APPROVED = 'Willow garden by the north pier';
const REFUSED = 'willow-garden-north.example.com';

/** Everything the page tried to send, as text. */
let outbound: string[] = [];
let databasesOpened: string[] = [];

function watchTheNetwork(): void {
  outbound = [];
  databasesOpened = [];
  const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value));
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    outbound.push(asText(input), asText(init?.body));
    return new Response('');
  }));
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(function (_method: string, url: string | URL) { outbound.push(String(url)); });
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (body) { outbound.push(asText(body)); });
  vi.stubGlobal('WebSocket', vi.fn(function (url: string) {
    outbound.push(String(url));
    return { send: (data: unknown) => outbound.push(asText(data)), close: () => undefined, addEventListener: () => undefined };
  }));
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn((url: string, data?: unknown) => { outbound.push(url, asText(data)); return true; }),
  });
  vi.stubGlobal('indexedDB', { open: vi.fn((name: string) => { databasesOpened.push(name); throw new Error('no storage'); }) });
}

function storageSnapshot(): string {
  const dump = (storage: Storage) => Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map((k) => [k, storage.getItem(k)]));
  return JSON.stringify({ local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie });
}

const check = (parts: TextPart[]) => reviewText(parts, new AbortController().signal, () => undefined);

describe('the text check keeps what it reads on the device', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('unrelated', 'kept');
    watchTheNetwork();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  spec('UI-19', 'approves and refuses export text without sending it anywhere or saving it or its verdict', async () => {
    const before = storageSnapshot();
    await expect(check([{ field: 'title', text: APPROVED }, { field: 'description', text: APPROVED }])).resolves.toEqual({ allowed: true });
    await expect(check([{ field: 'title', text: APPROVED }, { field: 'footer', text: REFUSED, segments: [REFUSED] }]))
      .resolves.toMatchObject({ allowed: false, fields: ['footer'] });
    expect(outbound.filter((sent) => sent.includes(APPROVED) || sent.includes(REFUSED))).toEqual([]);
    expect(databasesOpened).toEqual([]);
    expect(storageSnapshot()).toBe(before);
  });

  spec('UI-19', 'answers custom tags for this page only, sending nothing and saving no tag text or verdict', async () => {
    const state = makeState(8, 8);
    state.annotations = {
      items: [], visible: true, locked: false,
      customTags: [{ id: 'custom:a', text: APPROVED }, { id: 'custom:b', text: REFUSED }],
    };
    useEditorStore.setState({ gridState: state });
    const before = storageSnapshot();
    await reviewCustomTags();
    expect(textVerdict(APPROVED)).toBe('approved');
    expect(textVerdict(REFUSED)).toBe('refused');
    expect(outbound.filter((sent) => sent.includes(APPROVED) || sent.includes(REFUSED))).toEqual([]);
    expect(databasesOpened).toEqual([]);
    expect(storageSnapshot()).toBe(before);
  });
});
