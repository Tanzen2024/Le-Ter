import { createContext, useContext, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  tablePalette as palette,
  titleShadow,
  useTableFonts,
} from '../../components/table/TableDecor';
import { useLandscapeViewport, type LandscapeViewport } from '../../hooks/use-landscape-viewport';
import { gameTheme, salon } from '../../constants/theme';
import { playSound } from '../../services/audio-service';
import { LeterCards, LoginBackdropDecor } from './LoginDecor';

/**
 * Écrans de connexion et d'inscription épurés : la pièce vert nuit du salon, un seul panneau de
 * laque centré à filet de laiton, marque « LE TER » puis le titre. Aucune décoration sans fonction
 * (ni cartes, ni feutre). Dimensionné depuis la surface paysage sûre : sur un téléphone en
 * paysage (~350 dp utiles), la connexion tient sans défiler ; le panneau défile si le clavier ou
 * l'inscription demandent plus de hauteur.
 *
 * `decorated` (Connexion et Inscription seulement) : 5 cartes L E T E R posées sur le haut du
 * panneau au lieu de la marque texte, titre gravé doré, et fond décoré (`LoginDecor`).
 */

export interface LoginMetrics {
  panelWidth: number;
  padding: number;
  /** Hauteur des champs et du bouton (jamais sous 44, taille tactile minimale). */
  controlHeight: number;
  inputFontSize: number;
  smallFontSize: number;
  brandSize: number;
  titleSize: number;
  /** Écran décoré : hauteur des cartes L E T E R et taille du titre gravé. */
  leterCardHeight: number;
  engravedTitleSize: number;
  gap: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `wide` : panneau à deux colonnes de champs (inscription). */
export function computeLoginMetrics(
  { width, height, safe }: LandscapeViewport,
  wide = false,
): LoginMetrics {
  const availableWidth = width - safe.left - safe.right;
  const availableHeight = height - safe.top - safe.bottom;
  return {
    // Assez large pour le filigrane « 695 122 301 ou votre adresse e-mail » après l'indicatif.
    panelWidth: Math.round(
      Math.min(availableWidth, wide ? 680 : clamp(availableHeight * 1.25, 420, 480)),
    ),
    padding: Math.round(clamp(availableHeight * 0.045, 14, 32)),
    controlHeight: Math.round(clamp(availableHeight * 0.12, 44, 54)),
    inputFontSize: Math.round(clamp(availableHeight * 0.042, 15, 16)),
    smallFontSize: Math.round(clamp(availableHeight * 0.036, 13, 15)),
    brandSize: Math.round(clamp(availableHeight * 0.05, 16, 24)),
    titleSize: Math.round(clamp(availableHeight * 0.06, 20, 30)),
    leterCardHeight: Math.round(clamp(availableHeight * 0.1, 36, 96)),
    engravedTitleSize: Math.round(clamp(availableHeight * 0.06, 21, 40)),
    gap: Math.round(clamp(availableHeight * 0.02, 6, 14)),
  };
}

const MetricsContext = createContext<LoginMetrics | null>(null);

/** Hauteur, police et espacement des champs, alignés sur le bouton. */
export function useLoginMetrics(): LoginMetrics {
  const value = useContext(MetricsContext);
  if (!value) throw new Error('Composant à utiliser dans <LoginLayout>.');
  return value;
}

/** Part des cartes L E T E R qui dépasse au-dessus du panneau (le reste le chevauche). */
const LETER_OVERHANG = 0.55;

export function LoginLayout({
  title,
  wide = false,
  decorated = false,
  children,
}: {
  title: string;
  wide?: boolean;
  decorated?: boolean;
  children: ReactNode;
}) {
  const viewport = useLandscapeViewport();
  const metrics = computeLoginMetrics(viewport, wide);
  const fonts = useTableFonts();
  const { safe } = viewport;
  const leterOverlap = metrics.leterCardHeight * 1.14 * (1 - LETER_OVERHANG);

  return (
    <MetricsContext.Provider value={metrics}>
      <View style={styles.root}>
        {decorated ? (
          <LoginBackdropDecor
            width={viewport.width}
            height={viewport.height}
            panelWidth={metrics.panelWidth}
            fontFamily={fonts.title}
          />
        ) : null}
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: safe.top,
              paddingBottom: safe.bottom,
              paddingLeft: safe.left,
              paddingRight: safe.right,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {decorated ? (
            // Au premier plan, à cheval sur le bord haut du panneau.
            <View style={[styles.leter, { marginBottom: -leterOverlap }]}>
              <LeterCards cardHeight={metrics.leterCardHeight} fontFamily={fonts.title} />
            </View>
          ) : null}
          <View
            style={[
              styles.panel,
              { width: metrics.panelWidth, padding: metrics.padding },
              decorated && { paddingTop: leterOverlap + metrics.gap / 2 },
            ]}
          >
            {decorated ? null : (
              <Text
                allowFontScaling={false}
                accessibilityRole="image"
                accessibilityLabel="Le Ter"
                style={[styles.brand, fontOf(fonts.title), { fontSize: metrics.brandSize }]}
              >
                LE TER
              </Text>
            )}
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.title,
                decorated && [styles.engraved, fontOf(fonts.title)],
                {
                  fontSize: decorated ? metrics.engravedTitleSize : metrics.titleSize,
                  marginBottom: metrics.gap * 1.5,
                },
              ]}
            >
              {title}
            </Text>
            {children}
          </View>
        </ScrollView>
      </View>
    </MetricsContext.Provider>
  );
}

/** Contour visible au focus clavier (web, tablette avec clavier), jamais au simple toucher. */
function useFocusRing() {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    handlers: {
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}

/** Action principale : bouton doré, indicateur et libellé « Connexion… » pendant l'envoi. */
export function LoginButton({
  title,
  busyTitle = title,
  icon,
  onPress,
  loading = false,
  disabled = false,
}: {
  title: string;
  /** Libellé pendant l'envoi (« Connexion… ») ; à défaut, le titre. */
  busyTitle?: string;
  /** Icône décorative devant le titre (masquée pendant l'envoi, remplacée par l'indicateur). */
  icon?: ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { controlHeight } = useLoginMetrics();
  const { focused, handlers } = useFocusRing();
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        onPress();
        playSound('uiClick');
      }}
      {...handlers}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={loading ? busyTitle : title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { height: controlHeight },
        focused && styles.focusRing,
        pressed && styles.buttonPressed,
        disabled && !loading && styles.buttonDisabled,
      ]}
    >
      {loading ? <ActivityIndicator color={BUTTON_TEXT} /> : icon}
      <Text numberOfLines={1} style={styles.buttonText}>
        {loading ? busyTitle : title}
      </Text>
    </Pressable>
  );
}

/** Lien texte doré ; la zone tactile est étendue à ~44 px de haut. */
export function LoginLink({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { smallFontSize } = useLoginMetrics();
  const { focused, handlers } = useFocusRing();
  return (
    <Pressable
      onPress={onPress}
      {...handlers}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.link,
        focused && styles.focusRing,
        (pressed || disabled) && styles.linkPressed,
      ]}
    >
      <Text style={[styles.linkText, { fontSize: smallFontSize }]}>{title}</Text>
    </Pressable>
  );
}

/** « Vous n'avez pas de compte ? S'inscrire », centré sous le bouton. */
export function LoginFooter({
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
  const { smallFontSize, gap } = useLoginMetrics();
  return (
    <View style={[styles.footer, { marginTop: gap }]}>
      <Text style={[styles.footerText, { fontSize: smallFontSize }]}>{prompt}</Text>
      <LoginLink title={linkTitle} onPress={onPress} disabled={disabled} />
    </View>
  );
}

/**
 * Message unique annoncé par les lecteurs d'écran : erreur (validation ou serveur) ou
 * confirmation (`success`, ex. mot de passe modifié).
 */
export function LoginMessage({
  message,
  tone = 'error',
}: {
  message?: string;
  tone?: 'error' | 'success';
}) {
  const { smallFontSize, gap } = useLoginMetrics();
  if (!message) return null;
  return (
    <Text
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      style={[
        styles.message,
        tone === 'success' && styles.success,
        { fontSize: smallFontSize, marginBottom: gap },
      ]}
    >
      {message}
    </Text>
  );
}

/** « Étape 1 sur 2 · Identité » et barre de progression dorée (parcours en plusieurs étapes). */
export function LoginSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  const { gap, smallFontSize } = useLoginMetrics();
  return (
    <View
      style={{ marginBottom: gap }}
      accessible
      accessibilityLabel={`Étape ${current} sur ${steps.length} : ${steps[current - 1]}`}
    >
      <Text style={[styles.step, { fontSize: smallFontSize }]}>
        Étape {current} sur {steps.length} ·{' '}
        <Text style={styles.stepName}>{steps[current - 1]}</Text>
      </Text>
      <View style={styles.progress}>
        {steps.map((label, index) => (
          <View
            key={label}
            style={[styles.progressSegment, index < current && styles.progressSegmentOn]}
          />
        ))}
      </View>
    </View>
  );
}

const BUTTON_TEXT = salon.ink;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: salon.backdrop,
    experimental_backgroundImage: salon.backdropLight,
  },
  fill: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    maxWidth: '100%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: gameTheme.brass.line,
    backgroundColor: 'rgba(10, 18, 16, 0.86)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(27, 41, 36, 0.9) 0%, rgba(8, 15, 13, 0.92) 100%)',
    boxShadow: `${salon.surface.shadow}, inset 0 1px 0 rgba(246, 239, 223, 0.07)`,
  },
  brand: {
    color: palette.gold,
    textAlign: 'center',
    letterSpacing: 4,
    includeFontPadding: false,
  },
  leter: { zIndex: 2, alignItems: 'center' },
  // Titre gravé doré des écrans décorés (police Cinzel, capitales).
  engraved: { color: palette.gold, letterSpacing: 1.5, marginTop: 0, ...titleShadow },
  title: {
    color: palette.cream,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: salon.radius.control,
    borderWidth: 1,
    borderColor: salon.brass.border,
    backgroundColor: salon.brass.fill,
    experimental_backgroundImage: salon.brass.gradient,
    boxShadow: '0 6px 14px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 244, 205, 0.55)',
  },
  buttonPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.45 },
  buttonText: {
    color: BUTTON_TEXT,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  focusRing: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: palette.cream,
    outlineOffset: 2,
  },
  link: { minHeight: 24, justifyContent: 'center', borderRadius: 4 },
  linkPressed: { opacity: 0.6 },
  linkText: { color: salon.brass.text, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 6,
  },
  footerText: { color: palette.cream, opacity: 0.8 },
  message: { color: palette.error, textAlign: 'center', fontWeight: '600' },
  success: { color: salon.status.positive.text },
  step: { color: palette.cream, opacity: 0.75, fontWeight: '600', marginBottom: 8 },
  stepName: { color: palette.gold },
  progress: { flexDirection: 'row', gap: 6 },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(246, 239, 223, 0.14)',
  },
  progressSegmentOn: { experimental_backgroundImage: salon.brass.gradient, backgroundColor: salon.brass.fill },
});
