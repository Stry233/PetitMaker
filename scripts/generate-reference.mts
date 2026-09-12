// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, writeFileSync } from 'node:fs';
import { referenceBlocks, rewriteReferenceDoc } from './generate-reference-core.mts';

declare const process: { argv: string[]; exitCode?: number };

const path = 'docs/ARCHITECTURE.md';
const read = (file: string): string => readFileSync(file, 'utf8');
try {
  const current = read(path);
  const next = rewriteReferenceDoc(current, referenceBlocks(read));
  if (current !== next && process.argv.includes('--check')) {
    console.error(`${path} is out of date. Run npm run docs:generate.`);
    process.exitCode = 1;
  } else if (current !== next) {
    writeFileSync(path, next);
    console.log(`Updated generated sections in ${path}.`);
  } else {
    console.log(`${path} generated sections are current.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
