import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendXhsImage, xhsImageActionAvailable } from '../../io/xhs';

const image = 'data:image/png;base64,aGVsbG8=';
afterEach(() => { delete window.xhs; });

describe('Xiaohongshu image delivery', () => {
  it('offers only APIs present in the injected SDK', () => {
    expect(xhsImageActionAvailable('save')).toBe(false);
    window.xhs = { miniTool: { saveImageToPhotosAlbum: vi.fn() } };
    expect(xhsImageActionAvailable('save')).toBe(true);
    expect(xhsImageActionAvailable('note')).toBe(false);
  });
  it('writes a fresh temporary image before saving it', async () => {
    const writeTempFile = vi.fn().mockResolvedValue({ filePath: '/tmp/map.png' });
    const saveImageToPhotosAlbum = vi.fn().mockResolvedValue({ errMsg: 'saveImageToPhotosAlbum:ok' });
    window.xhs = { miniTool: { writeTempFile, saveImageToPhotosAlbum } };
    await sendXhsImage(image, 'save');
    expect(writeTempFile).toHaveBeenCalledWith({ data: image });
    expect(saveImageToPhotosAlbum).toHaveBeenCalledWith({ filePath: '/tmp/map.png' });
  });
  it('opens the note composer with media and no prefilled promotional content', async () => {
    const postNote = vi.fn().mockResolvedValue({ errMsg: 'postNote:ok' });
    const writeTempFile = vi.fn();
    window.xhs = { miniTool: { postNote, writeTempFile } };
    await sendXhsImage(image, 'note');
    expect(writeTempFile).not.toHaveBeenCalled();
    expect(postNote).toHaveBeenCalledWith({ mediaInfo: { image_resources: [{ url: image }] } });
  });
  it('propagates album permission refusals without downloading a file', async () => {
    const refusal = { errMsg: 'saveImageToPhotosAlbum:fail denied' };
    window.xhs = { miniTool: { saveImageToPhotosAlbum: vi.fn().mockRejectedValue(refusal) } };
    await expect(sendXhsImage(image, 'save')).rejects.toEqual(refusal);
  });
  it('rejects network resources and missing SDKs', async () => {
    await expect(sendXhsImage('https://example.com/map.png', 'save')).rejects.toThrow('Invalid image');
    await expect(sendXhsImage(image, 'save')).rejects.toThrow('unavailable');
  });
  it('does not send media after a temporary-file failure', async () => {
    const save = vi.fn();
    window.xhs = { miniTool: { writeTempFile: vi.fn().mockRejectedValue(new Error('full')), saveImageToPhotosAlbum: save } };
    await expect(sendXhsImage(image, 'save')).rejects.toThrow('full');
    expect(save).not.toHaveBeenCalled();
  });
});
