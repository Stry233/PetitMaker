import { afterEach, describe, expect, it, vi } from 'vitest';
import { liteHostById } from '../../../platform/build/lite-hosts';

type Edition = typeof import('../../../platform/build/edition');

/** The edition module as a build with these defines evaluates it. */
async function edition(lite: boolean, host?: string): Promise<Edition> {
  vi.resetModules();
  vi.stubGlobal('__PETIT_LITE__', lite);
  vi.stubGlobal('__PETIT_LITE_HOST__', host);
  // Where the bundle names no host, Node tools read the environment's.
  vi.stubEnv('PETIT_LITE_HOST', '');
  return import('../../../platform/build/edition');
}

const capabilities = (module: Edition) => Object.fromEntries(Object.entries(module).filter(([name]) => /^(?:SUPPORTS|BUNDLES|WRAPS)_/.test(name)));

/** Every capability of the Xiaohongshu build, which every Lite build shares apart from its host's differences. */
const OFFLINE = {
  SUPPORTS_ASSISTANT: false, SUPPORTS_JSON_FILES: false, SUPPORTS_CLIPBOARD: false, SUPPORTS_EXTERNAL_LINKS: false,
  SUPPORTS_WORKERS: false, SUPPORTS_FULLSCREEN: false, SUPPORTS_DOWNLOADS: false, SUPPORTS_TOUR_REELS: false,
  SUPPORTS_VIDEO_IMPORT: false, BUNDLES_LICENSE_TEXTS: true, SUPPORTS_CSS_MIN: false, WRAPS_EXPORT_OPTION_LABELS: true,
  SUPPORTS_PICTURE_IMPORT: true, SUPPORTS_LETTER_GENERATION: true, SUPPORTS_TYPED_AUTHOR: true, SUPPORTS_PICTURE_GENERATION: true,
  SUPPORTS_PICTURE_DOWNLOAD: false,
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('[UI-25] what each Lite host offers', () => {
  it('gives the Xiaohongshu build picture import and Letter and Picture generation', async () => {
    expect(capabilities(await edition(true, 'xhs'))).toEqual(OFFLINE);
  });

  it('builds for Xiaohongshu where no host is named', async () => {
    expect(capabilities(await edition(true))).toEqual(OFFLINE);
  });

  it('gives the Bilibili build Letter and Picture generation, picture downloads, no picture import and no typed author', async () => {
    expect(capabilities(await edition(true, 'bilibili'))).toEqual({
      ...OFFLINE, SUPPORTS_PICTURE_IMPORT: false, SUPPORTS_TYPED_AUTHOR: false, SUPPORTS_PICTURE_DOWNLOAD: true,
    });
  });

  it('promises that a picture reopens the map only where the build reads pictures back', async () => {
    const hint = async (host: string) => (await edition(true, host)).EDITION_COPY.saveHint;
    expect(await hint('xhs')).toBe('lite.save_hint');
    expect(await hint('bilibili')).toBe('lite.save_hint_device');
  });

  it('leaves the web edition every capability whatever host is named', async () => {
    const web = capabilities(await edition(false, 'bilibili'));
    expect(Object.entries(web).filter(([name, value]) => value !== !/^(?:BUNDLES|WRAPS)_/.test(name))).toEqual([]);
  });

  it('refuses a host it does not know', () => {
    expect(() => liteHostById('bilbili')).toThrow('Unknown Lite host');
  });
});

describe('[UI-25] a record that differs between Lite hosts', () => {
  type Row = { id: string; label: string };
  const ROWS = [
    { id: 'maze', label: 'Maze' },
    { id: 'letter', label: 'Letter', needs: 'letterGeneration' },
    { id: 'picture', label: 'Picture', needs: 'pictureGeneration' },
    { id: 'import', label: 'Import', needs: 'pictureImport', lite: { label: 'Choose a map picture' } },
    { id: 'files', label: 'Files', lite: false },
  ] as const;
  const offered = async (lite: boolean, host?: string) => (await edition(lite, host)).forEdition<Row>(ROWS);

  it('offers each host the records its capabilities allow, with the Lite replacements applied', async () => {
    const generation = [{ id: 'maze', label: 'Maze' }, { id: 'letter', label: 'Letter' }, { id: 'picture', label: 'Picture' }];
    expect(await offered(true, 'xhs')).toEqual([...generation, { id: 'import', label: 'Choose a map picture' }]);
    expect(await offered(true, 'bilibili')).toEqual(generation);
  });

  it('offers the web edition every record unchanged', async () => {
    expect(await offered(false)).toEqual(ROWS.map(({ id, label }) => ({ id, label })));
  });
});
