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

const STATUS_COLORS: Record<ComplaintStatus, string> = {
  OPEN: palette.teal,
  AI_ANALYSIS: palette.teal,
  WAITING_FOR_PLAYER: palette.goldDeep,
  IN_REVIEW: palette.teal,
  RESOLVED: '#3FD06A',
  REJECTED: palette.danger,
  CLOSED: '#7A7065',
};

export function StatusBadge({ status, label }: { status: ComplaintStatus; label: string }) {
  const m = useLobbyMetrics();
  return (
    <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] }]}>
      <Text style={[styles.badgeText, { fontSize: m.smallSize * 0.9 }]}>{label}</Text>
    </View>
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    backgroundColor: palette.panel,
  },
  heading: { color: palette.gold },
  body: { color: palette.cream },
  muted: { opacity: 0.7 },
  input: {
    color: palette.cream,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
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
  chipSelected: { backgroundColor: palette.jade, borderColor: palette.gold },
  chipText: { color: palette.cream },
  chipTextSelected: { color: palette.gold, fontWeight: '700' },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700' },
});
