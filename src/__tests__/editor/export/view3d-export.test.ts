// @vitest-environment jsdom
/** The 3D preview's still through its verb: the notice before the download, and which picture of
 *  the view it downloads. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { exportView3d } from '../../../editor/export/files';
import { readBlob } from '../../../io/import/read-blob';

vi.mock('../../../io/export/download', async (orig) => ({ ...(await orig<typeof import('../../../io/export/download')>()), downloadBlob: vi.fn() }));
import { downloadBlob } from '../../../io/export/download';

const png = (text: string): string => `data:image/png;base64,${btoa(text)}`;
/** A view whose whole picture and framed slice can be told apart. */
const view = () => ({ captureImage: vi.fn(() => png('whole')), captureFramed: vi.fn(() => png('framed')) });
const downloaded = async (): Promise<string[]> =>
  Promise.all(vi.mocked(downloadBlob).mock.calls.map(([blob]) => readBlob(blob, 'text') as Promise<string>));

beforeEach(() => {
  resetStore();
  vi.mocked(downloadBlob).mockClear();
});

describe('exportView3d', () => {
  spec('FILE-31', 'downloads the 3D still only after the notice is confirmed', async () => {
    const declined = vi.fn(async () => false);
    expect(await exportView3d(view(), { confirmNotice: declined })).toBe(false);
    expect(declined).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob)).not.toHaveBeenCalled();

    expect(await exportView3d(view(), { confirmNotice: async () => true })).toBe(true);
    expect(await downloaded()).toEqual(['whole']);
    expect(vi.mocked(downloadBlob).mock.calls[0]![1]).toMatch(/3d.*\.png$/);
  });

  it('downloads the framed slice while a shot is being set, the picture taken when it was asked', async () => {
    setStoreState({ preview3DEdit: { index: 0, angle: { az: 0, el: 40, dist: 0.9 } } });
    const shot = view();
    const confirmNotice = vi.fn(async () => {
      expect(shot.captureFramed).toHaveBeenCalledTimes(1);
      return true;
    });
    expect(await exportView3d(shot, { confirmNotice })).toBe(true);
    expect(shot.captureImage).not.toHaveBeenCalled();
    expect(await downloaded()).toEqual(['framed']);
  });

  it('asks nothing and downloads nothing when the view has no picture to give', async () => {
    const confirmNotice = vi.fn(async () => true);
    expect(await exportView3d({ captureImage: () => '', captureFramed: () => '' }, { confirmNotice })).toBe(false);
    expect(confirmNotice).not.toHaveBeenCalled();
    expect(vi.mocked(downloadBlob)).not.toHaveBeenCalled();
  });
});
