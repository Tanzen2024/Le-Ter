import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { fontOf, tablePalette as palette, useTableFonts } from '../../components/table/TableDecor';
import { StatusBadge as SalonStatusBadge } from '../../components/ui/SalonParts';
import { gameTheme, salon, type SalonTone } from '../../constants/theme';
import { useLobbyMetrics } from '../lobby/lobby-metrics';
import type { ComplaintStatus } from '../../types/complaint';

/** Briques visuelles d'« Aide et réclamations », sur la palette de la table (D-114). */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const m = useLobbyMetrics();
  return <View style={[styles.card, { padding: m.gap, gap: m.gap * 0.5 }, style]}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <Text
      accessibilityRole="header"
      style={[styles.heading, fontOf(fonts.button), { fontSize: m.bodySize * 1.1 }]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const m = useLobbyMetrics();
  return (
    <Text
      style={[
        styles.body,
        muted && styles.muted,
        { fontSize: m.smallSize * 1.05, lineHeight: m.smallSize * 1.5 },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  multiline,
  maxLength,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  maxLength: number;
  accessibilityLabel: string;
}) {
  const m = useLobbyMetrics();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(247, 241, 225, 0.45)"
      multiline={multiline}
      maxLength={maxLength}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.input,
        {
          fontSize: m.smallSize * 1.05,
          minHeight: multiline ? m.controlHeight * 2 : m.controlHeight,
        },
        multiline && styles.multiline,
      ]}
    />
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const m = useLobbyMetrics();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected, { paddingHorizontal: m.gap * 0.7 }]}
    >
      <Text
        style={[styles.chipText, selected && styles.chipTextSelected, { fontSize: m.smallSize }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Ton du statut RÉEL d'une réclamation (présentation seule) : laiton quand le joueur doit
 * répondre, jade une fois résolue, rouge si rejetée, bleu tant qu'elle est traitée.
 */
const STATUS_TONE: Record<ComplaintStatus, SalonTone> = {
  OPEN: 'info',
  AI_ANALYSIS: 'info',
  WAITING_FOR_PLAYER: 'attention',
  IN_REVIEW: 'info',
  RESOLVED: 'positive',
  REJECTED: 'critical',
  CLOSED: 'neutral',
};

export function StatusBadge({ status, label }: { status: ComplaintStatus; label: string }) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  return (
    <SalonStatusBadge
      label={label}
      tone={STATUS_TONE[status]}
      size={Math.round(m.smallSize * 0.9)}
      fontFamily={fonts.button}
    />
  );
}

export function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  card: {
    borderRadius: salon.radius.card,
    borderWidth: 1,
    borderColor: salon.surface.border,
    backgroundColor: salon.surface.fill,
    experimental_backgroundImage: salon.surface.gradient,
    boxShadow: gameTheme.shadow.plate,
  },
  heading: { color: salon.brass.text, letterSpacing: 0.4 },
  body: { color: salon.text },
  muted: { color: salon.textSoft },
  input: {
    color: salon.text,
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  multiline: { textAlignVertical: 'top' },
  chip: {
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    marginRight: 6,
    marginBottom: 6,
  },
  chipSelected: {
    borderColor: salon.brass.border,
    backgroundColor: salon.brass.fill,
    experimental_backgroundImage: salon.brass.gradient,
  },
  chipText: { color: salon.textSoft },
  chipTextSelected: { color: salon.ink, fontWeight: '700' },
});
