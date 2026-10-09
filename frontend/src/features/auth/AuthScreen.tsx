import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Screen } from '../../components/Screen';
import { BRAND_INITIAL } from '../../components/table/TableDecor';
import { Button } from '../../components/ui/Button';
import { colors, radius, spacing } from '../../constants/theme';

interface AuthScreenProps {
  title: string;
  subtitle?: string;
  /** Titre affiché en tête du formulaire (ex. « Inscription »). */
  formTitle?: string;
  /** Étapes du parcours, rappelées sous le titre (colonne de gauche). */
  steps?: readonly string[];
  /** Étape en cours, à partir de 1. */
  currentStep?: number;
  children: ReactNode;
}

/**
 * Un smartphone en paysage n'offre qu'environ 320 à 420 dp de hauteur : en dessous de ce
 * seuil, le gabarit et les champs se resserrent pour que le formulaire tienne sans défiler.
 */
const DENSE_MAX_HEIGHT = 500;

export function useDenseAuthLayout(): boolean {
  return useWindowDimensions().height < DENSE_MAX_HEIGHT;
}

/** Palette douce de l'inscription : vert du tapis, or discret, neutres chauds. */
export const authPalette = {
  card: '#FBFAF6',
  cardBorder: 'rgba(14, 59, 46, 0.08)',
  ink: '#13201B',
  muted: '#5B6B63',
  goldSoft: 'rgba(227, 179, 65, 0.16)',
  track: '#E6EBE7',
} as const;

/**
 * Gabarit des écrans d'authentification, conçu pour le paysage (D-028) : marque, titre et
 * étapes à gauche, carte du formulaire à droite. La hauteur étant rare, seul le formulaire
 * défile et le clavier laisse visibles le champ actif et le bouton (padding sur iOS ; Android
 * redimensionne déjà la fenêtre).
 */
export function AuthScreen({
  title,
  subtitle,
  formTitle,
  steps,
  currentStep = 1,
  children,
}: AuthScreenProps) {
  const dense = useDenseAuthLayout();
  return (
    <Screen style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.row}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.side}>
          <View style={styles.brandRow}>
            <View style={[styles.monogram, dense && styles.monogramDense]}>
              <Text style={[styles.monogramText, dense && styles.monogramTextDense]}>
                {BRAND_INITIAL}
              </Text>
            </View>
            <Text style={styles.brand}>LE TER</Text>
          </View>
          <Text style={[styles.title, dense && styles.titleDense]} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {steps && steps.length > 1 ? (
            <View style={[styles.steps, dense && styles.stepsDense]}>
              {steps.map((label, index) => {
                const number = index + 1;
                const done = number < currentStep;
                const current = number === currentStep;
                return (
                  <View
                    key={label}
                    style={styles.stepItem}
                    accessible
                    accessibilityLabel={`Étape ${number} : ${label}${
                      done ? ', terminée' : current ? ', en cours' : ''
                    }`}
                  >
                    <View
                      style={[
                        styles.stepDot,
                        done && styles.stepDotDone,
                        current && styles.stepDotCurrent,
                      ]}
                    >
                      <Text style={[styles.stepDotText, (done || current) && styles.stepDotTextOn]}>
                        {done ? '✓' : number}
                      </Text>
                    </View>
                    <Text style={[styles.stepLabel, current && styles.stepLabelCurrent]}>
                      {label}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
        <ScrollView
          style={styles.formPane}
          contentContainerStyle={[styles.formContent, dense && styles.formContentDense]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, dense && styles.cardDense]}>
            {formTitle ? (
              <Text style={[styles.formTitle, dense && styles.formTitleDense]}>{formTitle}</Text>
            ) : null}
            {children}
          </View>
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

/** Lien de bas de formulaire vers l'autre écran d'authentification. */
export function AuthFooter({
  prompt,
  linkTitle,
  onPress,
  disabled,
}: {
  prompt: string;
  linkTitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>{prompt}</Text>
      <Button title={linkTitle} variant="link" disabled={disabled} onPress={onPress} />
    </View>
  );
}

/** Bandeau d'erreur ou de succès au-dessus du formulaire. */
export function FormBanner({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const error = tone === 'error';
  return (
    <View
      style={[styles.banner, error ? styles.bannerError : styles.bannerSuccess]}
      accessible
      accessibilityLabel={message}
      accessibilityLiveRegion="assertive"
      accessibilityRole={error ? 'alert' : undefined}
    >
      <View style={[styles.bannerIcon, error ? styles.bannerIconError : styles.bannerIconSuccess]}>
        <Text style={styles.bannerIconText}>{error ? '!' : '✓'}</Text>
      </View>
      <Text style={[styles.bannerText, error ? styles.bannerErrorText : styles.bannerSuccessText]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.felt,
    experimental_backgroundImage:
      'radial-gradient(circle at 22% 30%, rgba(31, 110, 80, 0.55) 0%, rgba(14, 59, 46, 0) 55%), linear-gradient(160deg, #11463A 0%, #0E3B2E 55%, #0A2C22 100%)',
  },
  row: { flex: 1, flexDirection: 'row' },
  side: {
    flex: 2,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  monogram: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(227, 179, 65, 0.6)',
    backgroundColor: 'rgba(227, 179, 65, 0.12)',
  },
  monogramDense: { width: 28, height: 28, borderRadius: 14 },
  monogramText: { color: colors.gold, fontWeight: '800', fontSize: 17 },
  monogramTextDense: { fontSize: 14 },
  brand: {
    color: colors.gold,
    fontWeight: '700',
    letterSpacing: 4,
    fontSize: 12,
  },
  title: {
    color: colors.textOnFelt,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: spacing.md,
  },
  titleDense: { fontSize: 24, marginTop: spacing.sm },
  subtitle: {
    color: colors.textOnFelt,
    opacity: 0.78,
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  steps: { marginTop: spacing.lg, gap: spacing.sm },
  stepsDense: { marginTop: spacing.md, gap: 6 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 241, 230, 0.35)',
  },
  stepDotCurrent: { backgroundColor: colors.gold, borderColor: colors.gold },
  stepDotDone: {
    backgroundColor: 'rgba(227, 179, 65, 0.22)',
    borderColor: colors.gold,
  },
  stepDotText: {
    color: 'rgba(244, 241, 230, 0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
  stepDotTextOn: { color: colors.felt },
  stepLabel: {
    color: 'rgba(244, 241, 230, 0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  stepLabelCurrent: { color: colors.textOnFelt },
  formPane: { flex: 3, minWidth: 0 },
  formContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.md },
  formContentDense: { paddingVertical: spacing.sm },
  card: {
    backgroundColor: authPalette.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: authPalette.cardBorder,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.22)',
  },
  cardDense: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 20 },
  formTitle: {
    color: authPalette.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: spacing.sm,
  },
  formTitleDense: { fontSize: 19, marginBottom: 6 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.xs,
    marginTop: spacing.xs,
  },
  footerText: { color: authPalette.muted, fontSize: 15 },
  fieldRow: { flexDirection: 'row', gap: spacing.md },
  fieldColumn: { flex: 1, minWidth: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  bannerError: {
    backgroundColor: colors.dangerBg,
    borderColor: 'rgba(179, 38, 30, 0.18)',
  },
  bannerSuccess: {
    backgroundColor: colors.successBg,
    borderColor: 'rgba(30, 122, 76, 0.18)',
  },
  bannerIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerIconError: { backgroundColor: colors.danger },
  bannerIconSuccess: { backgroundColor: colors.success },
  bannerIconText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 19 },
  bannerErrorText: { color: colors.danger },
  bannerSuccessText: { color: colors.success },
});
