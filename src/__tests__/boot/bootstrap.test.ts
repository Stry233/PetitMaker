import { afterEach, expect, it, vi } from 'vitest';

const format = vi.hoisted(() => ({ prepareImageFormat: vi.fn() }));
vi.mock('../../assets/image-format', () => format);
afterEach(() => { vi.resetModules(); vi.resetAllMocks(); vi.doUnmock('../../main'); });

it('imports the app only after the artwork format settles', async () => {
  const mount = vi.fn();
  vi.doMock('../../main', () => { mount(); return {}; });
  let finish!: () => void;
  format.prepareImageFormat.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  await import('../../bootstrap');
  expect(mount).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
});

it('reports a failed dynamic entry through the classic boot guard', async () => {
  format.prepareImageFormat.mockResolvedValue(undefined);
  vi.doMock('../../main', () => { throw new Error('Entry unavailable'); });
  const failed = vi.fn();
  window.addEventListener('petit:boot-failed', failed);
  try {
    await import('../../bootstrap');
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  } finally { window.removeEventListener('petit:boot-failed', failed); }
});
