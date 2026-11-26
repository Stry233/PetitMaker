import { brandName } from '../../i18n/terms/brand';
import { useEffect } from 'react';
import { localeTag } from '../../i18n/locale-info';
import { EditorRoot } from '../app/EditorRoot';
import { MapViews } from '../app/MapViews';
import { NO_DOCK } from '../design/scale';
import { useLocale } from '../../i18n/context';

export default function LiteApp() {
  const locale = useLocale();
  useEffect(() => { document.title = brandName(locale); document.documentElement.lang = localeTag(locale); }, [locale]);
  return (
    <EditorRoot dockRef={NO_DOCK}>
      <MapViews />
    </EditorRoot>
  );
}
