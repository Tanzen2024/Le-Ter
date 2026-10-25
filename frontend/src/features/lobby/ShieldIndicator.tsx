import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { salon } from '../../constants/theme';
import { tablePalette as palette } from '../../components/table/TableDecor';

/** Libellés de la bulle d'information (et du lecteur d'écran). */
export const SHIELD_LABELS = {
  on: 'Détection anti-collusion activée',
  off: 'Détection anti-collusion désactivée',
} as const;

const TOOLTIP_MS = 2500;

/** Bouclier seul : vif avec un point doré quand le réglage est actif, estompé sinon. */
export function ShieldGlyph({ enabled, size }: { enabled: boolean; size: number }) {
  return (
    <View style={{ width: size * 1.25, height: size * 1.25 }} importantForAccessibility="no">
      <Text
        allowFontScaling={false}
        style={[
          styles.glyph,
          !enabled && styles.glyphOff,
          { fontSize: size, lineHeight: size * 1.25 },
        ]}
      >
        🛡️
      </Text>
      {enabled ? (
        <View
          style={[
            styles.dot,
            { width: size * 0.38, height: size * 0.38, borderRadius: size * 0.19 },
          ]}
        />
      ) : null}
    </View>
  );
}

/**
 * Indicateur du réglage « détection anti-collusion » d'une partie (D-043), tel que le serveur
 * le renvoie : une icône, sans Oui/Non. Un appui affiche brièvement une bulle d'information
 * (« … activée » / « … désactivée »), qui ne remplace pas l'icône. Discret : il décrit la
 * partie, il ne désigne aucun joueur.
 */
export function ShieldIndicator({
  enabled,
  size,
  fontSize,
}: {
  enabled: boolean;
  size: number;
  fontSize: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [open]);
  const label = enabled ? SHIELD_LABELS.on : SHIELD_LABELS.off;
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="image"
      accessibilityLabel={label}
      hitSlop={8}
      style={styles.anchor}
    >
      <ShieldGlyph enabled={enabled} size={size} />
      {open ? (
        <View style={[styles.tooltip, { bottom: size * 1.4 }]}>
          <Text numberOfLines={1} style={[styles.tooltipText, { fontSize }]}>
            {label}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  anchor: { alignItems: 'center', justifyContent: 'center' },
  glyph: { textAlign: 'center', includeFontPadding: false },
  glyphOff: { opacity: 0.3 },
  dot: {
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: palette.gold,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.35)',
    boxShadow: '0 0 6px rgba(242, 196, 81, 0.7)',
  },
  tooltip: {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: salon.surface.border,
    backgroundColor: salon.surface.fill,
    boxShadow: salon.surface.shadow,
  },
  tooltipText: { color: salon.text, fontWeight: '600' },
});
