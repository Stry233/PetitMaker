/*
 * The console easter egg: the island in shade characters, for whoever opens devtools.
 *
 * The PRODUCTION build drops every direct `console.*` call (vite.config.ts, esbuild.drop), and the
 * console is exactly where this banner must appear — so it reaches it through an aliased reference
 * the dropper does not rewrite. The one deliberate exception to the drop.
 */
import art from './assets/ascii-logo.txt?raw';
import { LEGAL } from './legal/config';
import { APP_NAME, APP_VERSION } from './version';

export function printConsoleBanner(): void {
  if (typeof window === 'undefined') return;
  const out = globalThis.console;
  // White ink on the drawing's OWN dark plate, so the art reads the same whatever theme the
  // devtools are in — bare white ink vanished on a light console. The plate is painted per line
  // box, so every row is padded to one width or the slab comes out ragged on the right. Sized so
  // the 256-column drawing fits an ordinary pane: past its width a console line soft-wraps, and a
  // wrapped drawing is noise. EVERY OTHER ROW IS DROPPED, because a monospace cell is about twice
  // as tall as it is wide and the console's line box never squeezes below its glyphs — line-height
  // cannot pull the rows together, halving them can (owner-tuned height).
  const rows = art.split('\n').filter((_, i) => i % 2 === 0);
  const width = Math.max(...rows.map((r) => r.length));
  const squashed = rows.map((r) => r.padEnd(width)).join('\n');
  out.log(`%c${squashed}`, 'font-size:6px; line-height:6px; color:#fff; background:#33322f;');
  out.log(
    `%c ${APP_NAME} %c v${APP_VERSION} %c  Like poking at how things work? The whole editor is open source. Come build with us: ${LEGAL.repoUrl}`,
    'background:#FFDA7E; color:#574935; font-weight:bold; padding:2px 6px; border-radius:3px 0 0 3px;',
    'background:#574935; color:#FFFEE3; padding:2px 6px; border-radius:0 3px 3px 0;',
    'color:inherit;',
  );
}
