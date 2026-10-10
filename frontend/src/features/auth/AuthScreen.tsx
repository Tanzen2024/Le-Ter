import { useState, type ReactNode } from 'react';
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
import {
  BRAND_INITIAL,
  fontOf,
  TableBackdrop,
  tablePalette,
  TatamiCard,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
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

/** Part de la largeur utile laissée à la colonne de présentation en paysage. */
const SIDE_SHARE = 0.35;
/** En deçà, la marque, le titre et les étapes ne sont plus lisibles. */
const SIDE_MIN_WIDTH = 200;

/**
 * Largeur du volet formulaire en paysage, à partir de la largeur RÉELLEMENT disponible
 * (marges de sécurité et barre de navigation déjà déduites) : 65 % quand l'écran est assez
 * large ; sur un paysage étroit, la présentation garde sa largeur minimale lisible.
 */
export function formPaneWidth(available: number): number {
  const side = Math.min(available / 2, Math.max(available * SIDE_SHARE, SIDE_MIN_WIDTH));
  return Math.round(available - side);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Tailles de la colonne de présentation, proportionnelles à sa largeur réelle. */
export function sideMetrics(sideWidth: number) {
  return {
    monogram: Math.round(clamp(sideWidth * 0.17, 40, 64)),
    brand: Math.round(clamp(sideWidth * 0.055, 14, 20)),
    title: Math.round(clamp(sideWidth * 0.09, 22, 36)),
    subtitle: Math.round(clamp(sideWidth * 0.058, 15, 19)),
    stepDot: Math.round(clamp(sideWidth * 0.1, 28, 36)),
    stepLabel: Math.round(clamp(sideWidth * 0.055, 14, 18)),
  };
}

/** Palette douce de l'inscription : panneau crème posé sur la table, neutres chauds. */
export const authPalette = {
  card: '#FBFAF6',
  cardBorder: 'rgba(14, 59, 46, 0.08)',
  ink: '#13201B',
  muted: '#5B6B63',
  goldSoft: 'rgba(227, 179, 65, 0.16)',
  track: '#E6EBE7',
} as const;

/**
 * Gabarit des écrans d'authentification, conçu pour le paysage (D-028) et habillé comme la
 * connexion (fond « table de jeu », or, police Cinzel, dos de cartes Le Ter) : marque, titre,
 * étapes et éventail de cartes à gauche (≈ 35 %), carte du formulaire à droite (≈ 65 %). La
 * hauteur étant rare, seul le formulaire défile et le clavier laisse visibles le champ actif et
 * le bouton (padding sur iOS ; Android redimensionne déjà la fenêtre).
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
  const window = useWindowDimensions();
  const fonts = useTableFonts();
  const [rowWidth, setRowWidth] = useState(0);
  // Paysage mesuré : présentation ≈ 35 %, formulaire ≈ 65 %. Sinon (portrait, avant la
  // mesure) : partage flex d'origine.
  const formWidth =
    window.width > window.height && rowWidth > 0 ? formPaneWidth(rowWidth) : undefined;
  const m = sideMetrics(
    formWidth !== undefined ? rowWidth - formWidth : (rowWidth || window.width) * 0.4,
  );
  return (
    <TableBackdrop>
      <Screen style={styles.screen}>
        <KeyboardAvoidingView
          style={styles.row}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          <View style={[styles.side, formWidth !== undefined && styles.sideMeasured]}>
            <View style={styles.brandRow}>
              <View
                style={[
                  styles.monogram,
                  { width: m.monogram, height: m.monogram, borderRadius: m.monogram / 2 },
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[styles.monogramText, fontOf(fonts.title), { fontSize: m.monogram * 0.5 }]}
                >
                  {BRAND_INITIAL}
                </Text>
              </View>
              <Text style={[styles.brand, fontOf(fonts.title), { fontSize: m.brand }]}>LE TER</Text>
            </View>
            <Text
              style={[
                styles.title,
                fontOf(fonts.title),
                { fontSize: m.title, lineHeight: Math.round(m.title * 1.2) },
                dense && styles.titleDense,
              ]}
              accessibilityRole="header"
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[
                  styles.subtitle,
                  { fontSize: m.subtitle, lineHeight: Math.round(m.subtitle * 1.35) },
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
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
                          { width: m.stepDot, height: m.stepDot, borderRadius: m.stepDot / 2 },
                          done && styles.stepDotDone,
                          current && styles.stepDotCurrent,
                        ]}
                      >
                        <Text
                          style={[
                            styles.stepDotText,
                            { fontSize: m.stepDot * 0.45 },
                            (done || current) && styles.stepDotTextOn,
                          ]}
                        >
                          {done ? '✓' : number}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.stepLabel,
                          { fontSize: m.stepLabel },
                          current && styles.stepLabelCurrent,
                        ]}
                      >
                        {label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
            <CardFan fontFamily={fonts.title} />
          </View>
          <ScrollView
            style={
              formWidth !== undefined
                ? [styles.formPaneFixed, { width: formWidth }]
                : styles.formPane
            }
            contentContainerStyle={[styles.formContent, dense && styles.formContentDense]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.card,
                formWidth !== undefined && styles.cardWide,
                dense && styles.cardDense,
              ]}
            >
              {formTitle ? (
                <Text style={[styles.formTitle, dense && styles.formTitleDense]}>{formTitle}</Text>
              ) : null}
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </TableBackdrop>
  );
}

/** Éventail de dos de cartes : la carte du centre, légèrement relevée, passe devant. */
const SIDE_FAN = [
  { shift: -0.55, rotate: -14, lift: 0 },
  { shift: 0.55, rotate: 14, lift: 0 },
  { shift: 0, rotate: 0, lift: 0.08 },
] as const;
/** Sous cette largeur de carte, le décor est omis plutôt que réduit à une miniature. */
const FAN_MIN_CARD_WIDTH = 36;

/**
 * Décor de cartes Le Ter (mêmes dos que la connexion) dans l'espace libre SOUS les étapes :
 * il est mesuré, donc les cartes ne recouvrent jamais la marque, le titre ni les étapes, et
 * n'interceptent aucun geste.
 */
function CardFan({ fontFamily }: { fontFamily?: string }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const cardWidth = Math.min((box.height * 0.82) / 1.36, box.width * 0.3, 120);
  const cardHeight = cardWidth * 1.36;
  const base = (box.height - cardHeight * 1.08) / 2;
  return (
    <View
      style={styles.fan}
      onLayout={(e) => setBox(e.nativeEvent.layout)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {cardWidth >= FAN_MIN_CARD_WIDTH
        ? SIDE_FAN.map(({ shift, rotate, lift }) => (
            <TatamiCard
              key={shift}
              width={cardWidth}
              fontFamily={fontFamily}
              style={{
                left: box.width / 2 - cardWidth / 2 + shift * cardWidth,
                bottom: base + lift * cardHeight,
                transform: [{ rotate: `${rotate}deg` }],
              }}
            />
          ))
        : null}
    </View>
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
  screen: { backgroundColor: 'transparent' },
  row: { flex: 1, flexDirection: 'row' },
  side: {
    flex: 2,
    minWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sideMeasured: { flex: 1, paddingRight: spacing.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Médaillon des dos de cartes Le Ter (TatamiCard) : cuivre, anneau et lettre or.
  monogram: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: tablePalette.goldDeep,
    backgroundColor: '#6E3218',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45)',
  },
  monogramText: { color: tablePalette.gold, includeFontPadding: false },
  brand: { color: tablePalette.gold, letterSpacing: 5, ...titleShadow },
  title: { color: tablePalette.cream, marginTop: spacing.md, ...titleShadow },
  titleDense: { marginTop: spacing.sm },
  subtitle: { color: tablePalette.cream, opacity: 0.85, marginTop: spacing.xs },
  steps: { marginTop: spacing.lg, gap: spacing.sm },
  stepsDense: { marginTop: spacing.md },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepDot: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(247, 241, 225, 0.45)',
  },
  stepDotCurrent: { backgroundColor: tablePalette.gold, borderColor: tablePalette.gold },
  stepDotDone: {
    backgroundColor: 'rgba(242, 196, 81, 0.22)',
    borderColor: tablePalette.gold,
  },
  stepDotText: { color: 'rgba(247, 241, 225, 0.8)', fontWeight: '700' },
  stepDotTextOn: { color: tablePalette.backdrop },
  stepLabel: { flexShrink: 1, color: 'rgba(247, 241, 225, 0.75)', fontWeight: '600' },
  stepLabelCurrent: { color: tablePalette.cream },
  fan: { flex: 1, minHeight: 0, marginTop: spacing.sm, pointerEvents: 'none' },
  formPane: { flex: 3, minWidth: 0 },
  formPaneFixed: { flexGrow: 0, flexShrink: 0 },
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
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.4)',
  },
  // Volet à 65 % : la carte suit sa largeur (plafond seulement pour les très grands écrans).
  cardWide: { maxWidth: 820 },
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
