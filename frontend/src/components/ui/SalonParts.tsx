import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { salon, type SalonTone } from '../../constants/theme';
import { fontOf } from '../table/TableDecor';

/**
 * Pièces communes des écrans autour du jeu (« salon », constants/theme) : badge d'état,
 * titre de section et état vide. Purement visuelles : elles affichent ce qu'on leur donne,
 * jamais une donnée de leur cru. Les tailles viennent de l'écran (mesures de son gabarit).
 */

/**
 * Badge d'état : pastille et libellé. La couleur n'est jamais seule porteuse de sens, le
 * libellé (fourni par l'écran, issu de l'état réel) l'est toujours. `live` : point plein pour
 * ce qui se déroule en ce moment.
 */
export function StatusBadge({
  label,
  tone = 'neutral',
  size,
  fontFamily,
  live = false,
  fit = false,
  testID,
  style,
}: {
  label: string;
  tone?: SalonTone;
  /** Taille du texte. */
  size: number;
  fontFamily?: string;
  live?: boolean;
  /** Place trop étroite : le texte rétrécit pour rester entier, jamais tronqué. */
  fit?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = salon.status[tone];
  const dot = Math.max(5, Math.round(size * 0.42));
  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        {
          borderColor: colors.border,
          backgroundColor: colors.fill,
          paddingHorizontal: Math.round(size * 0.6),
          gap: Math.round(size * 0.4),
        },
        style,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.dot,
          { width: dot, height: dot, borderRadius: dot / 2, borderColor: colors.text },
          live && { backgroundColor: colors.text, boxShadow: `0 0 6px ${colors.text}` },
        ]}
      />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit={fit}
        minimumFontScale={fit ? 0.6 : undefined}
        style={[styles.badgeText, fontOf(fontFamily), { color: colors.text, fontSize: size }]}
      >
        {label}
      </Text>
    </View>
  );
}

/** Titre de section : capitales espacées en laiton, suivies d'un filet qui s'efface. */
export function SectionTitle({
  children,
  size,
  fontFamily,
  trailing,
}: {
  children: string;
  size: number;
  fontFamily?: string;
  /** Élément à droite du filet (compteur, lien). */
  trailing?: ReactNode;
}) {
  return (
    <View style={[styles.section, { gap: Math.round(size * 0.7) }]}>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.sectionText, fontOf(fontFamily), { fontSize: size }]}
      >
        {children}
      </Text>
      <View style={styles.sectionRule} accessibilityElementsHidden importantForAccessibility="no" />
      {trailing}
    </View>
  );
}

/**
 * État vide : médaillon de laiton, titre, explication et, s'il y en a une, l'action réelle
 * qui permet d'en sortir (créer, réessayer…). Jamais de contenu factice pour combler.
 */
export function EmptyState({
  glyph,
  title,
  message,
  action,
  size,
  fontFamily,
  testID,
  style,
}: {
  glyph: string;
  title: string;
  message?: string;
  action?: ReactNode;
  /** Taille du texte courant. */
  size: number;
  fontFamily?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const medallion = Math.round(size * 3.2);
  return (
    <View
      testID={testID}
      style={[styles.empty, { padding: Math.round(size * 1.3), gap: Math.round(size * 0.55) }, style]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.medallion,
          { width: medallion, height: medallion, borderRadius: medallion / 2 },
        ]}
      >
        <Text allowFontScaling={false} style={{ fontSize: Math.round(medallion * 0.46) }}>
          {glyph}
        </Text>
      </View>
      <Text style={[styles.emptyTitle, fontOf(fontFamily), { fontSize: Math.round(size * 1.12) }]}>
        {title}
      </Text>
      {message ? (
        <Text style={[styles.emptyMessage, { fontSize: Math.round(size * 0.92) }]}>{message}</Text>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: { borderWidth: 1.5 },
  badgeText: { flexShrink: 1, letterSpacing: 0.3 },
  section: { flexDirection: 'row', alignItems: 'center' },
  sectionText: {
    color: salon.brass.text,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  sectionRule: {
    flex: 1,
    height: 1,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(214, 178, 94, 0.5) 0%, rgba(214, 178, 94, 0) 100%)',
  },
  empty: {
    alignItems: 'center',
    borderRadius: salon.radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: salon.surface.border,
    backgroundColor: salon.surface.well,
  },
  medallion: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: salon.highlight,
    backgroundColor: 'rgba(214, 178, 94, 0.08)',
    boxShadow: 'inset 0 0 12px rgba(214, 178, 94, 0.12)',
  },
  emptyTitle: { color: salon.text, textAlign: 'center' },
  emptyMessage: { color: salon.textSoft, textAlign: 'center', lineHeight: 20, maxWidth: 420 },
  emptyAction: { marginTop: 4, alignSelf: 'stretch', alignItems: 'center' },
});
