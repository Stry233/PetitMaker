// @vitest-environment jsdom
/**
 * The dialect wire, over a scripted `fetch`: one shared error-shape table (the agent error-zoo
 * pattern, `agent/providers/error-zoo.test.ts` — a row states the shape, its class, and a
 * near-miss that must not match), plus per-dialect request assertions for the wire placement each
 * dialect's own convention demands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { geminiDialect } from '../../../../pipelines/stylize/dialects/gemini';
import { modelscopeImagesDialect } from '../../../../pipelines/stylize/dialects/modelscope-images';
import { openaiCompatibleDialect } from '../../../../pipelines/stylize/dialects/openai-compatible';
import { openaiImagesDialect } from '../../../../pipelines/stylize/dialects/openai-images';
import { stepfunImagesDialect } from '../../../../pipelines/stylize/dialects/stepfun-images';
import { arkImagesDialect } from '../../../../pipelines/stylize/dialects/ark-images';
import { classify, scrub, toStylizeStatus } from '../../../../pipelines/stylize/dialects/errors';
import { DIALECTS } from '../../../../pipelines/stylize/dialects/index';
import { listModelIds } from '../../../../pipelines/stylize/dialects/http';
import { STYLIZE_PROVIDERS } from '../../../../pipelines/stylize/providers';
import { StylizeError, type DialectConfig, type StylizeDialect, type StylizeImage } from '../../../../pipelines/stylize/dialects/types';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGP8z0AaYCJRPcOoBmIAE1GqkMCoBmIAyRoAQC4BH1m1rqAAAAAASUVORK5CYII=';
const SOURCE_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;
const STYLE_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;
const LAYOUT_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;
// Distinguishable bytes from the fixture above, so a test can prove which role's blob was sent
// rather than merely that a blob of the right length arrived.
const OTHER_B64 = 'AAECAwQFBgcICQ==';
const OTHER_STYLE_DATA_URL = `data:image/png;base64,${OTHER_B64}`;

function threeRoleImages(): StylizeImage[] {
  return [
    { role: 'source', dataUrl: SOURCE_DATA_URL },
    { role: 'style', dataUrl: STYLE_DATA_URL },
    { role: 'layout', dataUrl: LAYOUT_DATA_URL },
  ];
}

function cfg(overrides: Partial<DialectConfig> = {}): DialectConfig {
  return { key: 'test-key', baseUrl: '', model: 'test-model', ...overrides };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** jsdom's `Blob`/`File` carry no `arrayBuffer`/`text`/`stream` method (only `FileReader` reads
 *  them back in this environment), so a test asserting on multipart bytes goes through it. */
function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── the error-shape table, driven through every dialect ─────────────────── */

interface Row {
  what: string;
  status: number;
  body: unknown;
  status_: 'bad_key' | 'refused' | 'network' | 'bad_response';
}

const ROWS: Row[] = [
  { what: '401 unauthenticated', status: 401, body: { error: { message: 'invalid api key' } }, status_: 'bad_key' },
  { what: '403 forbidden', status: 403, body: { error: { message: 'forbidden' } }, status_: 'bad_key' },
  // Near miss: a 400 is not a credential status, whatever its body says; with no model/moderation/
  // content wording it is an address/shape problem, not a decline.
  { what: '400 that merely resembles a credential complaint', status: 400, body: { error: { message: 'invalid api key shape' } }, status_: 'bad_response' },

  { what: '400 naming the model', status: 400, body: { error: { message: "the model `gpt-nope` does not exist" } }, status_: 'refused' },
  { what: '400 naming moderation', status: 400, body: { error: { message: 'blocked by moderation policy' } }, status_: 'refused' },
  { what: '400 naming content', body: { error: { message: 'the content violates our policy' } }, status: 400, status_: 'refused' },
  // Near miss: a 400 with no refusal wording is an address/shape problem, not a decline.
  { what: '400 with unrelated wording', status: 400, body: { error: { message: "invalid value for 'temperature'" } }, status_: 'bad_response' },

  { what: '429 rate limited', status: 429, body: { error: { message: 'quota exceeded' } }, status_: 'refused' },
  // An account that may not spend: the key is accepted, so the request is declined rather than the key rejected.
  { what: '402 payment required', status: 402, body: { error: { message: 'Insufficient balance' } }, status_: 'refused' },
  { what: '403 overdue account', status: 403, body: { error: { code: 'AccountOverdueError', message: 'The request failed because your account has an overdue balance.' } }, status_: 'refused' },
  { what: '403 exhausted quota', status: 403, body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }, status_: 'refused' },
  // Near miss: a 403 about permissions or credentials is still the key.
  { what: '403 insufficient permissions', status: 403, body: { error: { message: 'Insufficient permissions for this key' } }, status_: 'bad_key' },
  { what: '403 invalid credentials', status: 403, body: { error: { message: 'Invalid credentials' } }, status_: 'bad_key' },
  // Near miss: 500 is a server fault, not a quota refusal.
  { what: '500 server error', status: 500, body: { error: { message: 'internal error' } }, status_: 'bad_response' },
];

describe('classify: the error table', () => {
  it.each(ROWS)('$what -> $status_', ({ status, body, status_ }) => {
    const err = classify(status, body);
    expect(err.status).toBe(status_);
    expect(err).toBeInstanceOf(StylizeError);
  });

  it('scrubs a planted gemini-shaped key out of the detail', () => {
    const err = classify(401, { error: { message: 'bad key: AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    expect(err.message).not.toContain('AIzaSy');
  });

  it('scrubs a planted openai-shaped key out of the detail', () => {
    const err = classify(401, { error: { message: 'bad key: sk-abcdef0123456789abcdef' } });
    expect(err.message).not.toContain('sk-abcdef0123456789abcdef');
  });
});

describe('scrub', () => {
  it('replaces a Google-shaped key', () => {
    expect(scrub('key AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA leaked')).not.toContain('AIzaSy');
  });
  it('replaces an OpenAI-shaped key', () => {
    expect(scrub('key sk-abcdef0123456789abcdef leaked')).not.toContain('sk-abcdef0123456789abcdef');
  });
  it('leaves ordinary text untouched', () => {
    expect(scrub('the model gpt-nope does not exist')).toBe('the model gpt-nope does not exist');
  });
});

/* ── every dialect surfaces the table's own statuses over its real generate() call ────────────── */

describe('every dialect classifies its own generate() failures the same way', () => {
  const cases: Array<{ id: string; dialect: StylizeDialect }> = [
    { id: 'gemini', dialect: geminiDialect },
    { id: 'openai-images', dialect: openaiImagesDialect },
    { id: 'openai-compatible', dialect: openaiCompatibleDialect },
    { id: 'stepfun-images', dialect: stepfunImagesDialect },
    { id: 'ark-images', dialect: arkImagesDialect },
    { id: 'modelscope-images', dialect: modelscopeImagesDialect },
  ];

  for (const { id, dialect } of cases) {
    it.each(ROWS)(`${id}: $what -> $status_`, async ({ status, body }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, body)));
      await expect(
        dialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'draw it', system: 'trust', aspectId: '1:1' }),
      ).rejects.toMatchObject({ status: ROWS.find((r) => r.status === status && r.body === body)!.status_ });
    });

    it(`${id}: a rejected fetch classifies as network`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(
        dialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'draw it', system: 'trust', aspectId: '1:1' }),
      ).rejects.toMatchObject({ status: 'network' });
    });

    it(`${id}: a cancelled call rejects with the abort itself, not a network status`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
      const failure = await dialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'draw it', system: 'trust', aspectId: '1:1' })
        .catch((err: unknown) => err);
      expect(failure).toMatchObject({ name: 'AbortError' });
      expect(toStylizeStatus(failure)).toBeNull();
    });

    it(`${id}: a 2xx with no usable image field is bad_response`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})));
      await expect(
        dialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'draw it', system: 'trust', aspectId: '1:1' }),
      ).rejects.toMatchObject({ status: 'bad_response' });
    });
  }
});

/* ── the dialect barrel ────────────────────────────────────────────────────── */

describe('DIALECTS', () => {
  it('names all six dialects', () => {
    expect(Object.keys(DIALECTS).sort()).toEqual([
      'ark-images', 'gemini', 'modelscope-images', 'openai-compatible', 'openai-images', 'stepfun-images',
    ]);
  });
});

describe.each(Object.entries(DIALECTS).filter(([id]) => id !== 'ark-images'))('the %s dialect\'s model list', (_id, dialect) => {
  it.each([404, 500])('falls back to null on a %i reply', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, { error: { message: 'no' } })));
    expect(await dialect.listModels(cfg({ baseUrl: 'https://custom.example' }))).toBeNull();
  });

  it.each([401, 403])('rejects the key on a %i reply', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, { error: { message: 'API key not valid' } })));
    await expect(dialect.listModels(cfg({ baseUrl: 'https://custom.example' }))).rejects.toMatchObject({ status: 'bad_key' });
  });

  it('falls back to null when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await dialect.listModels(cfg({ baseUrl: 'https://custom.example' }))).toBeNull();
  });

  it('falls back to null when the endpoint answers nothing before the deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      })));
      const listed = dialect.listModels(cfg({ baseUrl: 'https://custom.example' }));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await listed).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([{ data: {} }, { models: {} }, [null], 'not json'])('reads a malformed list reply %j as no list', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));
    expect(await dialect.listModels(cfg({ baseUrl: 'https://custom.example' }))).toBeNull();
  });
});

/* ── gemini: request shape, wire placement, listModels, judge ────────────────────────────────── */

describe.each([
  ['openai-images', openaiImagesDialect],
  ['openai-compatible', openaiCompatibleDialect],
  ['ark-images', arkImagesDialect],
  ['stepfun-images', stepfunImagesDialect],
] as const)('the %s dialect\'s reply', (_name, dialect) => {
  it('accepts a url reply and re-encodes it to a data URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ url: 'https://cdn.example/out.png' }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await dialect.generate(
      cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' },
    );
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('gemini dialect', () => {
  it('POSTs generateContent with the key header, source LAST among the image parts, and the prompt verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'RESULT_B64' } }] } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await geminiDialect.generate(
      cfg({ baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-image' }),
      { images: threeRoleImages(), prompt: 'redraw this map', system: 'trust', aspectId: '4:3' },
    );

    expect(result).toBe('data:image/png;base64,RESULT_B64');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-image:generateContent');
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('test-key');

    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    // style, then layout, then source last; the trailing part is the text prompt.
    expect(parts[0]).toEqual({ inline_data: { mimeType: 'image/png', data: TINY_PNG_B64 } });
    expect(parts).toHaveLength(4);
    expect(parts[2]).toEqual({ inline_data: { mimeType: 'image/png', data: TINY_PNG_B64 } });
    expect(parts[3]).toEqual({ text: 'redraw this map' });
    expect(body.generationConfig.imageConfig.aspectRatio).toBe('4:3');
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
  });

  it('calls the configured base URL, which the provider row supplies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'X' } }] } }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const row = STYLIZE_PROVIDERS.find((p) => p.dialect === 'gemini')!;
    await geminiDialect.generate(cfg({ baseUrl: row.baseUrl }), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    expect((fetchMock.mock.calls[0]![0] as string)).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
  });

  it('a parts array carrying only text reads as refused, the model\'s own decline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: 'I cannot redraw this image.' }] } }],
    })));
    await expect(
      geminiDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' }),
    ).rejects.toMatchObject({ status: 'refused' });
  });

  it('an empty parts array is a malformed reply, not a decline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      candidates: [{ content: { parts: [] } }],
    })));
    await expect(
      geminiDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' }),
    ).rejects.toMatchObject({ status: 'bad_response' });
  });

  it('listModels keeps names containing "image", strips the models/ prefix, newest first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      models: [
        { name: 'models/gemini-1.5-image-preview' },
        { name: 'models/gemini-2.5-image' },
        { name: 'models/gemini-1.5-flash' },
      ],
    })));
    const models = await geminiDialect.listModels(cfg());
    expect(models).toEqual(['gemini-2.5-image', 'gemini-1.5-image-preview']);
  });

  it('judge parses correction clauses line by line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: 'Move the bridge to the river.\nRestore the missing road.' }] } }],
    })));
    const clauses = await geminiDialect.judge!(cfg(), { source: SOURCE_DATA_URL, output: SOURCE_DATA_URL, scene: ['a river runs north to south'], instructions: 'judge' });
    expect(clauses).toEqual(['Move the bridge to the river.', 'Restore the missing road.']);
  });

  it('judge returns [] on an all-clear reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: 'all clear' }] } }],
    })));
    const clauses = await geminiDialect.judge!(cfg(), { source: SOURCE_DATA_URL, output: SOURCE_DATA_URL, scene: [], instructions: 'judge' });
    expect(clauses).toEqual([]);
  });
});

/* ── openai-images: multipart request shape, wire placement, listModels ──────────────────────── */

describe('openai-images dialect', () => {
  it('POSTs images/edits multipart with the source FIRST among image[] entries, and a bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'RESULT_B64' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await openaiImagesDialect.generate(
      cfg({ baseUrl: 'https://api.openai.com', model: 'gpt-image-1' }),
      { images: threeRoleImages(), prompt: 'redraw this map', system: 'trust', aspectId: '1:1' },
    );

    expect(result).toBe('data:image/png;base64,RESULT_B64');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');

    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('redraw this map');
    expect(form.get('size')).toBe('auto');
    expect(form.get('n')).toBe('1');
    const images = form.getAll('image[]') as File[];
    expect(images).toHaveLength(3);
    // the source is the first entry: it is the edit target, decoded back to the same bytes sent in.
    const firstBuf = await readBlobBytes(images[0]!);
    const expectedBuf = Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0));
    expect(firstBuf).toEqual(expectedBuf);
  });

  it('listModels keeps only gpt-image/dall-e ids, newest first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{ id: 'gpt-image-1' }, { id: 'dall-e-3' }, { id: 'gpt-4o' }, { id: 'gpt-image-2' }],
    })));
    const models = await openaiImagesDialect.listModels(cfg());
    expect(models).toEqual(['gpt-image-2', 'gpt-image-1', 'dall-e-3']);
  });

  it('has no judge surface', () => {
    expect(openaiImagesDialect.canJudge).toBe(false);
    expect(openaiImagesDialect.judge).toBeUndefined();
  });
});

/* ── openai-compatible: JSON body mapping, listModels ─────────────────────────────────────────── */

describe('openai-compatible dialect', () => {
  it('POSTs images/generations with source/style/layout mapped to image/image2/image3, and a bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'RESULT_B64' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await openaiCompatibleDialect.generate(
      cfg({ baseUrl: 'https://api.siliconflow.cn', model: 'Qwen/Qwen-Image-Edit-2509' }),
      { images: threeRoleImages(), prompt: 'redraw this map', system: 'trust', aspectId: '1:1' },
    );

    expect(result).toBe('data:image/png;base64,RESULT_B64');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.siliconflow.cn/v1/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('Qwen/Qwen-Image-Edit-2509');
    expect(body.prompt).toBe('redraw this map');
    expect(body.image).toBe(SOURCE_DATA_URL);
    expect(body.image2).toBe(STYLE_DATA_URL);
    expect(body.image3).toBe(LAYOUT_DATA_URL);
  });

  it('omits image2/image3 when those roles are absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'X' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await openaiCompatibleDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect('image2' in body).toBe(false);
    expect('image3' in body).toBe(false);
  });

  it('listModels returns every id the endpoint lists, uncurated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'a' }, { id: 'b' }] })));
    expect(await openaiCompatibleDialect.listModels(cfg({ baseUrl: 'https://api.siliconflow.cn' }))).toEqual(['a', 'b']);
  });

  it('has no judge surface', () => {
    expect(openaiCompatibleDialect.canJudge).toBe(false);
  });
});

/* ── ark-images: one JSON call, source-first image array, preset size, no provider watermark ──── */

describe('ark-images dialect', () => {
  it('POSTs images/generations JSON with the source first, the 2K preset size, b64_json, and watermark off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'RESULT_B64' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await arkImagesDialect.generate(
      cfg({ baseUrl: 'https://ark.cn-beijing.volces.com', model: 'doubao-seedream-4-0-250828' }),
      {
        images: [{ role: 'style', dataUrl: OTHER_STYLE_DATA_URL }, { role: 'source', dataUrl: SOURCE_DATA_URL }],
        prompt: 'redraw this map',
        system: 'trust',
        aspectId: '3:2',
      },
    );

    expect(result).toBe('data:image/png;base64,RESULT_B64');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('doubao-seedream-4-0-250828');
    expect(body.image).toEqual([SOURCE_DATA_URL, OTHER_STYLE_DATA_URL]);
    expect(body.size).toBe('2496x1664');
    expect(body.response_format).toBe('b64_json');
    expect(body.watermark).toBe(false);
    expect(body.sequential_image_generation).toBe('disabled');
  });

  it('a single source rides as a bare string, not a one-element array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'X' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await arkImagesDialect.generate(
      cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' },
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.image).toBe(SOURCE_DATA_URL);
    expect(body.size).toBe('2048x2048');
  });

  it('listModels answers no list without sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await arkImagesDialect.listModels(cfg({ baseUrl: 'https://ark.cn-beijing.volces.com' }))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies the Ark error envelope by status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'AuthenticationError', message: 'the API key is missing or invalid', type: 'Unauthorized' } })));
    await expect(arkImagesDialect.generate(
      cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' },
    )).rejects.toMatchObject({ status: 'bad_key' });
  });
});

/* ── stepfun-images: single-image multipart, no size field, listModels, capabilities ──────────── */

describe('stepfun-images dialect', () => {
  it('POSTs images/edits multipart with model/image/prompt/response_format, no size field, and a bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'RESULT_B64' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await stepfunImagesDialect.generate(
      cfg({ baseUrl: 'https://api.stepfun.com', model: 'step-image-edit-2' }),
      { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'redraw this map', system: 'trust', aspectId: '1:1' },
    );

    expect(result).toBe('data:image/png;base64,RESULT_B64');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.stepfun.com/v1/images/edits');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');

    const form = init.body as FormData;
    expect(form.get('model')).toBe('step-image-edit-2');
    expect(form.get('prompt')).toBe('redraw this map');
    expect(form.get('response_format')).toBe('b64_json');
    expect(form.get('size')).toBeNull();
    // Exactly one image part, under the singular field name (not the `image[]` OpenAI convention).
    expect(form.getAll('image[]')).toHaveLength(0);
    const images = form.getAll('image') as File[];
    expect(images).toHaveLength(1);
  });

  it('sends the LAST role-tagged image as the source, not an earlier style reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'X' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await stepfunImagesDialect.generate(
      cfg(),
      { images: [{ role: 'style', dataUrl: OTHER_STYLE_DATA_URL }, { role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' },
    );

    const form = fetchMock.mock.calls[0]![1].body as FormData;
    const sent = await readBlobBytes(form.get('image') as Blob);
    const expectedBuf = Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0));
    expect(sent).toEqual(expectedBuf);
  });

  it('listModels keeps ids matching step*(image|1x), newest first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{ id: 'step-1x-turbo' }, { id: 'step-image-edit-3' }, { id: 'step-2-chat' }, { id: 'gpt-4o' }],
    })));
    const models = await stepfunImagesDialect.listModels(cfg());
    expect(models).toEqual(['step-image-edit-3', 'step-1x-turbo']);
  });

  it('declares a single-image capability with no judge surface', () => {
    expect(stepfunImagesDialect.maxImages).toBe(1);
    expect(stepfunImagesDialect.canJudge).toBe(false);
    expect(stepfunImagesDialect.judge).toBeUndefined();
    expect(stepfunImagesDialect.maxEdge).toBe(1408);
    expect(stepfunImagesDialect.aspects.map((a) => a.id)).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16']);
  });
});

/* ── modelscope-images: JSON images-array convention, tolerant response parse, listModels ───────── */

describe('modelscope-images dialect', () => {
  it('POSTs images/generations with the images array in style-then-source order, no header beyond auth/content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'RESULT_B64' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await modelscopeImagesDialect.generate(
      cfg({ baseUrl: 'https://api-inference.modelscope.cn', model: 'Qwen/Qwen-Image-Edit-2509' }),
      { images: threeRoleImages(), prompt: 'redraw this map', system: 'trust', aspectId: '1:1' },
    );

    expect(result).toBe('data:image/png;base64,RESULT_B64');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api-inference.modelscope.cn/v1/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(Object.keys(init.headers).sort()).toEqual(['Authorization', 'content-type']);

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('Qwen/Qwen-Image-Edit-2509');
    expect(body.prompt).toBe('redraw this map');
    expect(body.images).toEqual([STYLE_DATA_URL, SOURCE_DATA_URL]);
  });

  it('omits the style entry when that role is absent, sending only the source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'X' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await modelscopeImagesDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.images).toEqual([SOURCE_DATA_URL]);
  });

  it('parses data[0].b64_json first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: 'ABC' }] })));
    const result = await modelscopeImagesDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    expect(result).toBe('data:image/png;base64,ABC');
  });

  it('falls back to data[0].url, fetched and re-encoded to a data URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ url: 'https://cdn.example/out.png' }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await modelscopeImagesDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to images[0].url when data is absent, fetched and re-encoded', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { images: [{ url: 'https://cdn.example/out2.png' }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await modelscopeImagesDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to output.images[0].url when both data and images are absent, fetched and re-encoded', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { output: { images: [{ url: 'https://cdn.example/out3.png' }] } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await modelscopeImagesDialect.generate(cfg(), { images: [{ role: 'source', dataUrl: SOURCE_DATA_URL }], prompt: 'p', system: 'trust', aspectId: '1:1' });
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('listModels returns every id the endpoint lists, uncurated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'Qwen/Qwen-Image-Edit-2509' }] })));
    expect(await modelscopeImagesDialect.listModels(cfg({ baseUrl: 'https://api-inference.modelscope.cn' }))).toEqual(['Qwen/Qwen-Image-Edit-2509']);
  });

  it('listModels falls back to null on an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [] })));
    expect(await modelscopeImagesDialect.listModels(cfg())).toBeNull();
  });

  it('declares a two-image capability with no judge surface', () => {
    expect(modelscopeImagesDialect.maxImages).toBe(2);
    expect(modelscopeImagesDialect.canJudge).toBe(false);
    expect(modelscopeImagesDialect.maxEdge).toBe(1408);
    expect(modelscopeImagesDialect.aspects.map((a) => a.id)).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16']);
  });
});

describe('a model list reply', () => {
  const listed = (body: unknown) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));
    return listModelIds(cfg({ baseUrl: 'https://custom.example' }), '/v1/models', { field: 'data', idKey: 'id' });
  };

  it('reads the id of every row that carries a string id and skips the rest', async () => {
    expect(await listed({ data: [{ id: 'a' }, null, { id: 3 }, { name: 'b' }, { id: 'c' }] })).toEqual(['a', 'c']);
  });

  it('is null when the field is not a list', async () => {
    expect(await listed({ data: {} })).toBeNull();
    expect(await listed(null)).toBeNull();
  });
});

describe('toStylizeStatus', () => {
  it('reads a classified failure by its own status', () => {
    expect(toStylizeStatus(new StylizeError('bad_key'))).toBe('bad_key');
    expect(toStylizeStatus(new StylizeError('device'), 'network')).toBe('device');
  });

  it('gives an unclassified failure the fallback, the network by default', () => {
    expect(toStylizeStatus(new TypeError('boom'))).toBe('network');
    expect(toStylizeStatus(new TypeError('boom'), 'device')).toBe('device');
  });

  it('gives a cancelled call no status', () => {
    expect(toStylizeStatus(new DOMException('Cancelled', 'AbortError'), 'device')).toBeNull();
  });
});
