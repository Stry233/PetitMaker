/** The cards a Help demo stands beside its map: the load disc and the built-pieces list. */
import { easingCss, seconds } from '../../design/motion';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { getCatalogItem } from '../../../state/catalog';
import { localizedName, useLocale } from '../../../i18n/context';
import { INK, PLATE } from '../../design/tokens';
import { font, radii, shadows } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { LoadDiscSvg } from '../../shell/controls/LoadMeter';
import { ChecklistItemRow } from '../../chrome/modals/export/BuildChecklist';

/** The load disc: the meter's own drawing. */
export function LoadDisc({ fill }: { fill: number }) {
  return <LoadDiscSvg fill={fill} maskId="help-load-hole" style={{ width: 44, height: 44 }} />;
}

/** The built-pieces card: real localized names, real icons, real counts from the demo world. */
export function BuiltCard({ rows, title }: { rows: Array<{ catalogId: string; count: number }>; title: string }) {
  const locale = useLocale();
  // Imperative entrance (the press pulse's own idiom): the demo box sits under nested presence
  // gates that can hold a framer child at its initial frame, and a card that never reaches
  // opacity 1 is a card that does not exist.
  const enter = (el: HTMLDivElement | null) => {
    if (!el || typeof el.animate !== 'function' || isMotionReduced()) return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(10px) scale(0.95)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: seconds('help.figure.card') * 1000, easing: easingCss('help.figure.card') },
    );
  };
  return (
    <div
      ref={enter}
      style={{
        position: 'relative', background: PLATE, borderRadius: radii.md,
        boxShadow: shadows.s2, padding: '12px 16px', display: 'flex', flexDirection: 'column',
        gap: 6, pointerEvents: 'none',
      }}
    >
      <span style={{ ...roleFont('small'), color: INK, fontFamily: font.family }}>{title}</span>
      {rows.map((row) => {
        const item = getCatalogItem(row.catalogId);
        if (!item) return null;
        return (
          <ChecklistItemRow
            key={row.catalogId}
            icon={item.icon}
            color={item.color}
            name={localizedName(item.name, locale)}
            countText={`x${row.count}`}
          />
        );
      })}
    </div>
  );
}
