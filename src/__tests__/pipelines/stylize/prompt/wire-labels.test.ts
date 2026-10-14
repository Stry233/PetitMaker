// @vitest-environment jsdom
/**
 * The prompt's image labels against each real dialect's wire: every image a dialect places on the
 * request is named by its position in the prompt compiled from that dialect's declared order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIALECTS } from '../../../../pipelines/stylize/dialects/index';
import type { DialectConfig, StylizeImage } from '../../../../pipelines/stylize/dialects/types';
import { compilePrompt } from '../../../../pipelines/stylize/prompt/compile';

type Role = StylizeImage['role'];
const PAYLOAD: Record<Role, string> = { style: 'U1RZTEU=', layout: 'TEFZT1VU', source: 'U09VUkNF' };
const ROLE_OF_PAYLOAD = new Map(Object.entries(PAYLOAD).map(([role, b64]) => [b64, role as Role]));
const LABEL: Record<Role, string> = { style: 'is a style sample', layout: 'is a flat-color layout legend', source: 'is the planning map to redraw' };

function cfg(): DialectConfig {
  return { key: 'test-key', baseUrl: 'https://provider.example', model: 'test-model' };
}

/** jsdom's `Blob` has no `arrayBuffer`; `FileReader` is its one reader. */
function blobBase64(value: FormDataEntryValue): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf(',') + 1)); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(value as Blob);
  });
}

/** The roles a captured request carries, in the order the provider reads them. */
async function wireRoles(init: RequestInit): Promise<Role[]> {
  const payloads: string[] = [];
  if (init.body instanceof FormData) {
    for (const key of ['image[]', 'image']) for (const v of init.body.getAll(key)) payloads.push(await blobBase64(v));
  } else {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const strip = (url: string) => url.slice(url.indexOf(',') + 1);
    if (Array.isArray(body.contents)) {
      const parts = (body.contents as Array<{ parts: Array<{ inline_data?: { data: string } }> }>)[0]!.parts;
      for (const p of parts) if (p.inline_data) payloads.push(p.inline_data.data);
    } else if (Array.isArray(body.images)) {
      for (const url of body.images as string[]) payloads.push(strip(url));
    } else {
      const image = body.image;
      for (const url of Array.isArray(image) ? image as string[] : [image as string]) payloads.push(strip(url));
      for (const key of ['image2', 'image3']) if (typeof body[key] === 'string') payloads.push(strip(body[key] as string));
    }
  }
  return payloads.map((b64) => ROLE_OF_PAYLOAD.get(b64)!);
}

afterEach(() => vi.unstubAllGlobals());

describe.each(Object.entries(DIALECTS))('the %s dialect', (_id, dialect) => {
  it('sends its images in the order the prompt labels them', async () => {
    const roles: Role[] = (['style', 'layout', 'source'] as const).filter((r) => r === 'source' || dialect.maxImages >= 3 || (r === 'style' && dialect.maxImages >= 2));
    const images = roles.map((role) => ({ role, dataUrl: `data:image/png;base64,${PAYLOAD[role]}` }));
    let captured: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { captured = init; throw new TypeError('Failed to fetch'); }));
    await dialect.generate(cfg(), { images, prompt: 'draw it', system: 'trust', aspectId: '1:1' }).catch(() => undefined);
    const wire = await wireRoles(captured!);

    const prompt = compilePrompt({
      direction: 'watercolor', scene: [], presentCategories: new Set(),
      images: { style: roles.includes('style') ? 'pack' : false, layout: roles.includes('layout'), order: dialect.imageOrder },
    }).text;

    expect(wire.length).toBeGreaterThan(0);
    wire.forEach((role, i) => expect(prompt).toContain(`Image ${i + 1} ${LABEL[role]}`));
    expect(prompt).not.toContain(`Image ${wire.length + 1} `);
  });
});
