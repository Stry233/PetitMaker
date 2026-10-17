import logo from '../../assets/console-logo.svg?raw';
import { LEGAL } from '../../legal/config';
import { APP_VERSION } from '../../platform/build/build-info';
import { APP_NAME } from '../../i18n/terms/brand';
import { MAP_INK, MAP_TEXT } from '../../assets/brand-palette';
import { ACTIVE } from '../design/tokens';

export function printConsoleBanner(): void {
  if (typeof window === 'undefined') return;
  // The alias preserves this deliberate console output when production strips direct console calls.
  const out = globalThis.console;
  // The SVG inherits the console's color scheme and keeps its proportions independently of text metrics.
  const image = `data:image/svg+xml;base64,${btoa(logo)}`;
  out.log(
    '%c ',
    `display:inline-block; font-size:0; line-height:0; padding:40px 140px; background:url("${image}") center / contain no-repeat;`,
  );
  out.log(
    `%c ${APP_NAME} %c v${APP_VERSION} %c  Like poking at how things work? The whole editor is open source. Come build with us: ${LEGAL.repoUrl}`,
    `background:${ACTIVE}; color:${MAP_INK}; font-weight:bold; padding:2px 6px; border-radius:3px 0 0 3px;`,
    `background:${MAP_INK}; color:${MAP_TEXT}; padding:2px 6px; border-radius:0 3px 3px 0;`,
    'color:inherit;',
  );
}
