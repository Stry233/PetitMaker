/**
 * The third-party licence texts the repository keeps in `licenses/`, each by its path under that
 * folder. An edition that cannot link out to a licence bundles them; every other edition bundles none.
 */
import { BUNDLES_LICENSE_TEXTS } from '../platform/build/edition';

const FOLDER = '../../licenses/';

const texts = BUNDLES_LICENSE_TEXTS
  ? import.meta.glob<string>('../../licenses/**/*', { query: '?raw', import: 'default', eager: true })
  : {};

export const BUNDLED_LICENSES: readonly { name: string; body: string }[] = Object.entries(texts)
  .map(([path, body]) => ({ name: path.slice(FOLDER.length), body }));
