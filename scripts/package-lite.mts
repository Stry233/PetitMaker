import { readFileSync } from 'node:fs';
import { resolveBuildInfo, resolveVersion } from './build-info-core.mts';
import { collectLiteFiles, createLiteArchive, writeLiteArchive } from './lite-package-core.mts';

const archive = createLiteArchive(collectLiteFiles('dist-lite'));
for (const advisory of archive.advisories) console.warn(`Lite size advisory: ${advisory}`);
const { info } = resolveBuildInfo({ readStamp: () => readFileSync('build-info.json', 'utf8') });
const version = resolveVersion({
  pkgVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
  buildNumber: info.buildNumber, release: info.release, lastRelease: info.lastRelease,
}).replace(/-dev$/, '') + '-lite';
const path = writeLiteArchive('artifacts/lite', archive, { version, buildNumber: info.buildNumber, source: info.sha });
console.log(`PetitMaker Lite: ${archive.files} files, ${(archive.zip.length / 1048576).toFixed(2)} MiB → ${path}`);
