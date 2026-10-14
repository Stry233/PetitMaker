// The share picture's delivery inside the Xiaohongshu (RedNote) container (`io/export/xiaohongshu-share.ts`).
import { sendXiaohongshuImage, xiaohongshuImageActionAvailable, type XiaohongshuImageAction } from '../../io/export/xiaohongshu-share';

export type { XiaohongshuImageAction };
export { xiaohongshuImageActionAvailable };

/** Sends the exported picture to the album or a new note. */
export function deliverToXiaohongshu(image: Blob, action: XiaohongshuImageAction): Promise<void> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(image);
  }).then(data => sendXiaohongshuImage(data, action));
}
