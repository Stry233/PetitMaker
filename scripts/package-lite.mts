import { readFileSync } from 'node:fs';
import { STAMP_PATH, resolveBuildInfo, resolveVersion } from './build-info-core.mts';
import { collectLiteFiles, createLiteArchive, liteArtifactFolder, liteBuildFolder, writeLiteArchive } from './lite-package-core.mts';
import { activeLiteHost } from '../src/platform/build/lite-hosts.ts';

// PETIT_LITE_HOST names the host whose build this packages, as it named the one `vite build --mode lite` built.
const host = activeLiteHost().id;
const archive = createLiteArchive(collectLiteFiles(liteBuildFolder(host)), host);
for (const advisory of archive.advisories) console.warn(`Lite size advisory: ${advisory}`);
const { info } = resolveBuildInfo({ readStamp: () => readFileSync(STAMP_PATH, 'utf8') });
const version = resolveVersion({
  pkgVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
  buildNumber: info.buildNumber, release: info.release, lastRelease: info.lastRelease,
}).replace(/-dev$/, '') + '-lite';
const path = writeLiteArchive(liteArtifactFolder(host), archive, { version, buildNumber: info.buildNumber, source: info.sha });
console.log(`PetitMaker Lite (${host}): ${archive.files} files, ${(archive.zip.length / 1048576).toFixed(2)} MiB → ${path}`);
