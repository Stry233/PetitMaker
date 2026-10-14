/** Which of the repository's files the public snapshot carries, as the comment guards read them. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicPath, parseManifest } from '../../../scripts/export-public-repo-core.mts';
import { REPO, repoFiles } from './source-graph';

/** The export manifest: which tracked paths the public snapshot carries. */
const MANIFEST = 'docs/internal/deployment/public-repo-manifest.md';
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** The shipped code outside `src/` and `security/`: the root config files and the public scripts.
 *  The private tree asks the export manifest; the public snapshot holds only what shipped. */
export function publicScriptFiles(): string[] {
  const root = readdirSync(REPO).filter((name) => CODE_FILE.test(name) && statSync(join(REPO, name)).isFile());
  const candidates = [...root, ...repoFiles('scripts', { accept: CODE_FILE })];
  const manifestPath = join(REPO, MANIFEST);
  if (!existsSync(manifestPath)) return candidates;
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  return candidates.filter((path) => isPublicPath(path, manifest));
}
