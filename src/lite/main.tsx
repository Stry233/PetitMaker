import { installLiteLandscape } from '../ui/lite/landscape';
import { APP_FONT_FAMILY } from '../assets/fonts/family';
import '../ui/design/animations.css';
import '../ui/design/cursors/cursors.css';
import LiteApp from '../ui/lite/LiteApp';
import { mountApp } from '../ui/app/boot';
import { useEditorStore } from '../state/store';
import { publishCursorPreference } from '../ui/design/cursors/cursor-vars';
import { brandName } from '../i18n/brand';

installLiteLandscape();
publishCursorPreference();
document.documentElement.style.fontFamily = APP_FONT_FAMILY;
document.title = brandName(useEditorStore.getState().locale);
mountApp(document.getElementById('root')!, <LiteApp />);
