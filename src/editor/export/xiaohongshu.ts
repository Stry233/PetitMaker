// The share picture's delivery inside the Xiaohongshu (RedNote) container (`io/export/xiaohongshu-share.ts`).
import { blobToDataUrl } from '../../platform/remote/data-url';
import { sendXiaohongshuImage, xiaohongshuImageActionAvailable, type XiaohongshuImageAction } from '../../io/export/xiaohongshu-share';

export { xiaohongshuImageActionAvailable };

/** Sends the exported picture to the album or a new note. */
export function deliverToXiaohongshu(image: Blob, action: XiaohongshuImageAction): Promise<void> {
  return blobToDataUrl(image).then(data => sendXiaohongshuImage(data, action));
}
