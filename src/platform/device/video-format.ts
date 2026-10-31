/** Whether this engine's `<video>` plays `type` (a MIME type, with its codecs where they matter), as
 *  a `<source type>` asks it, so a prefetch can fetch the file the element will pick. */
export function playsVideo(type: string): boolean {
  try { return typeof document !== 'undefined' && document.createElement('video').canPlayType(type) !== ''; } catch { return false; }
}
