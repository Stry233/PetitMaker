/** Every reel file's URL, by its path under `assets/tour/` (`<locale>/<form>/<kind>.<ext>`): URL imports
 *  only, so no reel's bytes enter a script and each file is fetched when a card shows it or the warm
 *  schedule asks. The offline edition carries no reels (`ui/lite/tour-reel-files.ts`). */
const FILES = import.meta.glob<string>('../../../assets/tour/*/*/*.{webm,mp4,jpg,json}', { query: '?url&no-inline', import: 'default', eager: true });

const ROOT = '../../../assets/tour/';

export const REEL_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(ROOT.length), url]),
);
