import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing } from '../../constants/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'link';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && variant === 'primary' && styles.primaryPressed,
        pressed && variant !== 'primary' && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.felt : colors.feltLight} />
      ) : (
        <Text style={[styles.text, variant === 'link' ? styles.linkText : null]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.gold },
  primaryPressed: { backgroundColor: colors.goldPressed },
  secondary: { borderWidth: 1.5, borderColor: colors.feltLight, backgroundColor: 'transparent' },
  link: { minHeight: 40, paddingHorizontal: 0 },
  pressed: { opacity: 0.7 },
  inactive: { opacity: 0.55 },
  text: { fontSize: 16, fontWeight: '700', color: colors.felt },
  linkText: { color: colors.feltLight, fontWeight: '600', fontSize: 15 },
});
