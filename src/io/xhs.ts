/** The container injects this SDK; media never goes through an external endpoint. */
interface MiniTool {
  writeTempFile(options: { data: string }): Promise<{ filePath: string; errMsg: string }>;
  saveImageToPhotosAlbum(options: { filePath: string }): Promise<{ errMsg: string }>;
  postNote(options: { mediaInfo: { image_resources: { url: string }[] } }): Promise<{ errMsg: string }>;
}

declare global {
  interface Window { xhs?: { miniTool?: Partial<MiniTool> } }
}

export type XhsImageAction = 'save' | 'note';

export function xhsImageActionAvailable(action: XhsImageAction): boolean {
  const sdk = window.xhs?.miniTool;
  return typeof (action === 'save' ? sdk?.saveImageToPhotosAlbum : sdk?.postNote) === 'function';
}

/** Called only by an explicit export action. Temporary paths are consumed once and never saved. */
export async function sendXhsImage(dataUrl: string, action: XhsImageAction): Promise<void> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) throw new Error('Invalid image');
  const sdk = window.xhs?.miniTool;
  if (!sdk || !xhsImageActionAvailable(action)) throw new Error('XHS image API unavailable');
  if (action === 'note') {
    await sdk.postNote!({ mediaInfo: { image_resources: [{ url: dataUrl }] } });
    return;
  }
  const filePath = sdk.writeTempFile ? (await sdk.writeTempFile({ data: dataUrl })).filePath : dataUrl;
  if (!filePath || /^https?:/i.test(filePath)) throw new Error('Invalid temporary image');
  await sdk.saveImageToPhotosAlbum!({ filePath });
}
