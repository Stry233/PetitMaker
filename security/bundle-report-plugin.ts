// Vite plugin: collects the shipped module graph's `/node_modules/(@scope/)?name/` package
// boundaries and writes the sorted, de-duplicated package name list to
// `.bundle-packages.json` in the build output's PARENT directory, so the inventory of the
// project's dependencies is never part of the served tree. This is the "shipped bundle" input
// that `scripts/license-audit.mts` reads (when present) to refine the lockfile-derived
// dependency closure — it warns on any mismatch and unions the two sets so the notices file
// never under- or over-reports what actually ships.
//
// The module ids are collected in `buildEnd`, per Rollup's `PluginContext`, the one place
// `this.getModuleIds()` sees a finalized module graph; the file is written in `writeBundle`,
// which runs after every output file is on disk.
//
// Runs only in `build` mode (never during `vite dev`), and only re-walks the already-
// resolved module id list Rollup hands to `buildEnd` — no extra I/O beyond one JSON write.
import type { Plugin, ResolvedConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PACKAGE_BOUNDARY_RE = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//;

export function bundleReportPlugin(): Plugin {
  let outDir = 'dist';
  let packageNames: string[] = [];

  return {
    name: 'petit:bundle-report',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir;
    },
    buildEnd() {
      const names = new Set<string>();
      for (const id of this.getModuleIds()) {
        const match = PACKAGE_BOUNDARY_RE.exec(id);
        if (match) names.add(match[1]);
      }
      packageNames = [...names].sort();
    },
    writeBundle() {
      const outPath = join(outDir, '..', '.bundle-packages.json');
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(packageNames, null, 2)}\n`, 'utf8');
    },
  };
}
