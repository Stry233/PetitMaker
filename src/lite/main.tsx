import { installLiteSafeArea } from '../ui/lite/safe-area';
import { installArtRecovery } from '../platform/async/art-recovery';
import { APP_FONT_FAMILY } from '../assets/fonts/family';
import '../ui/design/animations.css';
import '../ui/design/cursors/cursors.css';
import LiteApp from '../ui/lite/LiteApp';
import { mountApp } from '../ui/app/boot';
import { publishCursorPreference } from '../ui/design/cursors/cursor-vars';

installLiteSafeArea();
installArtRecovery();
publishCursorPreference();
document.documentElement.style.fontFamily = APP_FONT_FAMILY;
mountApp(document.getElementById('root')!, <LiteApp />);
