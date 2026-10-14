/**
 * The first video track of a recording, by the container its first bytes show rather than its
 * name: Matroska and WebM (`mkv.ts`) start with the EBML magic, anything else is read as ISO base
 * media (`mp4.ts`), which refuses what it does not recognise.
 */
import type { ByteSource, TrackReadOptions, VideoTrack } from './container';
import { EBML_MAGIC, opensEbml } from './container';
import { readMkvVideoTrack } from './mkv';
import { readMp4VideoTrack } from './mp4';

export async function readVideoTrack(src: ByteSource, options: TrackReadOptions): Promise<VideoTrack> {
  const head = await src.read(0, Math.min(EBML_MAGIC.length, src.size));
  return opensEbml(head) ? readMkvVideoTrack(src, options) : readMp4VideoTrack(src, options);
}
