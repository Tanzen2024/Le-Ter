import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, gameTheme, radius, salon, spacing } from '../../constants/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'link';
  /**
   * `light` (défaut) : écrans clairs (administration). `salon` : écrans sombres autour du jeu
   * (laiton plein, filet de laiton, lien de laiton), lisibles sur la laque.
   */
  appearance?: 'light' | 'salon';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  appearance = 'light',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const inactive = disabled || loading;
  const dark = appearance === 'salon';
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        dark && salonStyles[variant],
        pressed && variant === 'primary' && (dark ? styles.pressed : styles.primaryPressed),
        pressed && variant !== 'primary' && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            dark
              ? variant === 'primary'
                ? salon.ink
                : salon.brass.text
              : variant === 'primary'
                ? colors.felt
                : colors.feltLight
          }
        />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'link' ? styles.linkText : null,
            dark && (variant === 'primary' ? salonStyles.primaryText : salonStyles.text),
          ]}
        >
          {title}
        </Text>
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

const salonStyles = StyleSheet.create({
  primary: {
    borderRadius: salon.radius.control,
    borderWidth: 1,
    borderColor: salon.brass.border,
    backgroundColor: salon.brass.fill,
    experimental_backgroundImage: salon.brass.gradient,
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 244, 205, 0.55)',
  },
  secondary: {
    borderRadius: salon.radius.control,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(214, 178, 94, 0.08)',
  },
  link: {},
  primaryText: { color: salon.ink, letterSpacing: 0.3 },
  text: { color: salon.brass.text },
});
