import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { colors, radius, spacing } from '../../constants/theme';

interface AuthScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Gabarit des écrans d'authentification, conçu pour le paysage (D-028) : marque et titre
 * à gauche, formulaire à droite. La hauteur étant rare, seul le formulaire défile et le
 * clavier laisse visibles le champ actif et le bouton (padding sur iOS ; Android
 * redimensionne déjà la fenêtre).
 */
export function AuthScreen({ title, subtitle, children }: AuthScreenProps) {
  return (
    <Screen style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.row}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.side}>
          <Text style={styles.brand}>LE TER</Text>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <ScrollView
          style={styles.formPane}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Deux champs côte à côte (la largeur est abondante en paysage, la hauteur rare). */
export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldRow}>{children}</View>;
}

export function FieldColumn({ children }: { children: ReactNode }) {
  return <View style={styles.fieldColumn}>{children}</View>;
}

/** Bandeau d'erreur ou de succès au-dessus du formulaire. */
export function FormBanner({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  return (
    <View
      style={[styles.banner, tone === 'error' ? styles.bannerError : styles.bannerSuccess]}
      accessibilityLiveRegion="assertive"
    >
      <Text style={tone === 'error' ? styles.bannerErrorText : styles.bannerSuccessText}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.felt },
  row: { flex: 1, flexDirection: 'row' },
  side: {
    flex: 2,
    minWidth: 180,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  brand: { color: colors.gold, fontWeight: '800', letterSpacing: 4, fontSize: 13 },
  title: { color: colors.textOnFelt, fontSize: 28, fontWeight: '800', marginTop: spacing.sm },
  subtitle: { color: colors.textOnFelt, opacity: 0.8, fontSize: 15, marginTop: spacing.xs },
  formPane: { flex: 3 },
  formContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.md },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  fieldRow: { flexDirection: 'row', gap: spacing.md },
  fieldColumn: { flex: 1, minWidth: 0 },
  banner: { borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md },
  bannerError: { backgroundColor: colors.dangerBg },
  bannerSuccess: { backgroundColor: colors.successBg },
  bannerErrorText: { color: colors.danger, fontSize: 14 },
  bannerSuccessText: { color: colors.success, fontSize: 14 },
});
