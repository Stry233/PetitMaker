// Coverage of the behaviour specification in docs/spec/: per area, how many requirements a test
// cites, and which ones none does yet. Reads test files, runs nothing.
//
//   npm run spec:report            per-area table and the uncovered ids
//   npm run spec:report -- --json  the same as JSON
import { AREAS, citations, readCatalogue, type Area } from '../src/__tests__/_support/spec-catalogue.ts';

const { requirements, problems } = readCatalogue();
const cited = citations();
const rows = (Object.keys(AREAS) as Area[]).map((area) => {
  const live = [...requirements.values()].filter((r) => r.area === area && !r.retired);
  const uncovered = live.filter((r) => !cited.has(r.id)).map((r) => r.id);
  return { area, total: live.length, covered: live.length - uncovered.length, uncovered };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, problems }, null, 2));
} else {
  const total = rows.reduce((n, r) => n + r.total, 0);
  const covered = rows.reduce((n, r) => n + r.covered, 0);
  for (const r of rows) console.log(`${r.area.padEnd(11)} ${String(r.covered).padStart(3)} / ${String(r.total).padEnd(3)} ${r.uncovered.length ? `uncovered: ${r.uncovered.join(' ')}` : ''}`);
  console.log(`${'all'.padEnd(11)} ${String(covered).padStart(3)} / ${total} (${total ? Math.round((100 * covered) / total) : 0}%)`);
  for (const p of problems) console.log(`problem: ${p}`);
}
if (problems.length) process.exitCode = 1;
