// Image delivery inside the Xiaohongshu (RedNote) mini-program container, through the SDK it injects as `window.xhs`.
import { parseRasterDataUrl } from '../../platform/remote/data-url';

/** The container injects this SDK; media never goes through an external endpoint. */
interface MiniTool {
  writeTempFile(options: { data: string }): Promise<{ filePath: string; errMsg: string }>;
  saveImageToPhotosAlbum(options: { filePath: string }): Promise<{ errMsg: string }>;
  postNote(options: { mediaInfo: { image_resources: { url: string }[] } }): Promise<{ errMsg: string }>;
}

declare global {
  interface Window { xhs?: { miniTool?: Partial<MiniTool> } }
}

export type XiaohongshuImageAction = 'save' | 'note';

export function xiaohongshuImageActionAvailable(action: XiaohongshuImageAction): boolean {
  const sdk = window.xhs?.miniTool;
  return typeof (action === 'save' ? sdk?.saveImageToPhotosAlbum : sdk?.postNote) === 'function';
}

/** Called only by an explicit export action. Temporary paths are consumed once and never saved. */
export async function sendXiaohongshuImage(dataUrl: string, action: XiaohongshuImageAction): Promise<void> {
  if (!parseRasterDataUrl(dataUrl)) throw new Error('Invalid image');
  const sdk = window.xhs?.miniTool;
  if (!sdk || !xiaohongshuImageActionAvailable(action)) throw new Error('XHS image API unavailable');
  if (action === 'note') {
    await sdk.postNote!({ mediaInfo: { image_resources: [{ url: dataUrl }] } });
    return;
  }
  const filePath = sdk.writeTempFile ? (await sdk.writeTempFile({ data: dataUrl })).filePath : dataUrl;
  if (!filePath || /^https?:/i.test(filePath)) throw new Error('Invalid temporary image');
  await sdk.saveImageToPhotosAlbum!({ filePath });
}
