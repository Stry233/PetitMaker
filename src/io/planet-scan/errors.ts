/** Why a scan cannot become a planet. */
export type ScanFailure =
  /** No frame shows the map view and the picture's shape is neither the game's view nor a
   *  16:9 screen: the recording is cropped or shows more than the game. */
  | 'framing'
  /** Too few frames show the map view. */
  | 'not-map-view'
  /** The still runs show no animated chunk lines: the region load display was off. */
  | 'region-load-off'
  /** The recording used another zoom than the map view's, read from the zoom slider or the
   *  chunk lines' period. */
  | 'different-zoom'
  /** The scan covers too little of a planet to read. */
  | 'too-little'
  /** The scan has more distinct frames than one import reads: it went over the same ground many
   *  times or ran much longer than a planet needs. */
  | 'too-long'
  /** The camera jumped further than tracking can follow and no revisit placed the jump. */
  | 'too-fast'
  /** The chunk lines are too soft to place the cells: the recording is blurred, downscaled or
   *  compressed. */
  | 'blurry'
  /** The scanned area is wider than the largest planet and its overscan. */
  | 'too-large'
  /** No grass was read anywhere in the scan. */
  | 'no-ground';

/** Every failure, in the order the import checks them. */
export const SCAN_FAILURES: readonly ScanFailure[] = [
  'framing', 'not-map-view', 'different-zoom', 'region-load-off', 'too-little', 'too-long', 'too-fast', 'blurry', 'too-large', 'no-ground',
];

/** A scan refused for a reason the import reports to the person. */
export class ScanError extends Error {
  constructor(readonly reason: ScanFailure) {
    super(`planet scan failed: ${reason}`);
    this.name = 'ScanError';
  }
}

export function isScanFailure(value: unknown): value is ScanFailure {
  return typeof value === 'string' && (SCAN_FAILURES as readonly string[]).includes(value);
}
