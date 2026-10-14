/**
 * Why a map save, a planet file or a share code could not be read, and what a read that succeeded
 * adjusted on the way. Every reader throws `ImportError`; the import surfaces translate its code.
 */

export type ImportErrorCode =
  | 'malformed'             // a save or planet file whose structure or field values are wrong
  | 'not-an-image'          // bytes are not a recognized or decodable image container
  | 'no-payload'            // a valid image without a share code in it
  | 'future-version'        // written by a newer build than this one reads
  | 'corrupt'               // integrity check failed, or untrusted input exceeded a safety cap
  | 'decode-failed'         // the share code's frame or raster could not be decoded
  | 'incompatible-template'; // the planet is unknown, or the data was made for another one

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** What a successful read reports to the import UI, which translates each kind. */
export type ImportWarning =
  | { kind: 'dropped-section'; section: string }
  /** A built-in planet changed since the share code was made, but the map still lays on it. */
  | { kind: 'template-drift' }
  /** The catalog changed since the share code was made. */
  | { kind: 'catalog-drift' }
  | { kind: 'modified-after-export' }
  /** Objects or terrain the map held where a landmark now stands were taken off. */
  | { kind: 'landmark-cleared'; objects: number; cells: number };

/** Whether a read failed on its input (an `ImportError`, or text that is not JSON) rather than on a
 *  fault in the code, which its caller logs. */
export function isInputRefusal(err: unknown): boolean {
  return err instanceof ImportError || err instanceof SyntaxError;
}
