import { Cinzel_700Bold } from '@expo-google-fonts/cinzel';
import { Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import { useFonts } from 'expo-font';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { playSound } from '../../services/audio-service';

/**
 * Identité visuelle « table de jeu » de Le Ter (écran de connexion, accueil, tournois…) :
 * fond rouge/brun éclairé, cercle de feutre vert cerclé d'or, cartes L décoratives, boutons
 * pilule turquoise. Un seul jeu de couleurs et de formes pour tous les écrans.
 */
export const tablePalette = {
  backdrop: '#2A0705',
  cream: '#F7F1E1',
  gold: '#F2C451',
  goldDeep: '#D9961F',
  teal: '#1F9C9C',
  error: '#FFB3A6',
  /** Boutons secondaires des panneaux (Modifier, Créer, ON…) : vert-turquoise et texte doré. */
  jade: '#17806E',
  /** Bouton de fermeture, Déconnexion, retour. */
  danger: '#D42A33',
  /** Surfaces sombres posées sur le fond (HUD, panneaux). */
  panel: 'rgba(16, 7, 5, 0.86)',
  panelBorder: 'rgba(255, 226, 190, 0.22)',
} as const;

/**
 * Initiale de la marque Le Ter, la SEULE source du monogramme visuel : table en bois, dos de
 * carte, jeton de monnaie, emblèmes. Purement graphique (aucun identifiant, aucune donnée).
 */
export const BRAND_INITIAL = 'L';

export interface TableFonts {
  /** Cinzel : titres « gravés » (Connexion, Choisis ton mode !, pseudo du HUD). */
  title?: string;
  /** Rajdhani : boutons, libellés, titres de panneaux. */
  button?: string;
}

/** Tant que les polices chargent (ou si elles échouent), la police système prend le relais. */
export function useTableFonts(): TableFonts {
  const [fontsLoaded] = useFonts({ Cinzel_700Bold, Rajdhani_700Bold });
  return fontsLoaded ? { title: 'Cinzel_700Bold', button: 'Rajdhani_700Bold' } : {};
}

/** Police et graisse de repli : la graisse n'est forcée que sur la police système. */
export function fontOf(family: string | undefined): TextStyle {
  return { fontFamily: family, fontWeight: family ? undefined : '800' };
}

/** Fond plein écran rouge/brun, éclairé au centre. */
export function TableBackdrop({ children }: { children: ReactNode }) {
  return <View style={styles.root}>{children}</View>;
}

/**
 * Cercle de feutre cerclé d'or.
 * - `classic` : feutre vert profond et anneau épais (connexion) ;
 * - `bright` : feutre vert vif, anneau fin et emblème L gravé (tournois) ;
 * - `deep` : feutre vert profond, anneau fin et emblème L gravé (boutique).
 */
export function FeltCircle({
  diameter,
  ring,
  variant = 'classic',
  fontFamily,
}: {
  diameter: number;
  ring: number;
  variant?: 'classic' | 'bright' | 'deep';
  fontFamily?: string;
}) {
  const felt = diameter - ring * 2;
  const bright = variant === 'bright';
  const emblem = variant !== 'classic';
  const innerLine = Math.round(felt * (emblem ? 0.5 : 0.8));
  return (
    <View
      style={[
        styles.ring,
        emblem && styles.ringBright,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          boxShadow: `0 0 ${Math.round(diameter * 0.09)}px ${Math.round(diameter * 0.025)}px rgba(255, 150, 30, 0.5)`,
        },
      ]}
    >
      <View
        style={[
          styles.felt,
          bright && styles.feltBright,
          { width: felt, height: felt, borderRadius: felt / 2 },
        ]}
      >
        <View
          style={[
            styles.feltLine,
            emblem && [styles.emblem, { borderWidth: Math.max(2, felt * 0.035) }],
            { width: innerLine, height: innerLine, borderRadius: innerLine / 2 },
          ]}
        >
          {emblem ? (
            <Text
              allowFontScaling={false}
              style={[styles.emblemLetter, fontOf(fontFamily), { fontSize: innerLine * 0.62 }]}
            >
              {BRAND_INITIAL}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Éventail de trois cartes de chaque côté, posé sur le bord bas, sans jamais toucher le centre. */
const FAN = [
  { shift: 0.9, rotate: 16, lift: 0.1 },
  { shift: 0.45, rotate: 9, lift: 0.05 },
  { shift: 0, rotate: 4, lift: 0 },
] as const;

/**
 * Cartes décoratives des deux côtés de l'écran. `sideSpace` est la largeur libre entre un bord
 * de l'écran et le contenu central : la carte de devant s'arrête avant lui.
 */
export function DecorativeCards({
  cardWidth,
  sideSpace,
  fontFamily,
}: {
  cardWidth: number;
  sideSpace: number;
  fontFamily?: string;
}) {
  const cardHeight = cardWidth * 1.36;
  // Bord intérieur de la carte de devant, avec un écart au centre qui absorbe sa rotation.
  const front = sideSpace - cardWidth - Math.max(sideSpace * 0.1, 8);
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.passThrough]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {FAN.map(({ shift, rotate, lift }) => {
        const bottom = -cardHeight * 0.14 + cardHeight * lift;
        const offset = front - cardWidth * shift;
        return [
          <TatamiCard
            key={`l${shift}`}
            width={cardWidth}
            fontFamily={fontFamily}
            style={{ left: offset, bottom, transform: [{ rotate: `-${rotate}deg` }] }}
          />,
          <TatamiCard
            key={`r${shift}`}
            width={cardWidth}
            fontFamily={fontFamily}
            style={{ right: offset, bottom, transform: [{ rotate: `${rotate}deg` }] }}
          />,
        ];
      })}
    </View>
  );
}

/** Dos de carte Le Ter (brun cuivré, cadre doré, médaillon L). Positionné en absolu. */
export function TatamiCard({
  width,
  fontFamily,
  style,
}: {
  width: number;
  fontFamily?: string;
  style: StyleProp<ViewStyle>;
}) {
  const radius = width * 0.08;
  const diamond = Math.max(5, width * 0.08);
  const medallion = width * 0.46;
  const diamondStyle = { width: diamond, height: diamond, margin: -diamond / 2 };
  return (
    <View
      style={[
        styles.card,
        {
          width,
          height: width * 1.36,
          borderRadius: radius,
          borderWidth: Math.max(2, width * 0.025),
          padding: width * 0.07,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.cardFrame,
          { borderRadius: radius * 0.6, borderWidth: Math.max(1, width * 0.012) },
        ]}
      >
        <View style={[styles.diamond, diamondStyle, { top: 0, left: '50%' }]} />
        <View style={[styles.diamond, diamondStyle, { bottom: 0, left: '50%' }]} />
        <View style={[styles.diamond, diamondStyle, { left: 0, top: '50%' }]} />
        <View style={[styles.diamond, diamondStyle, { right: 0, top: '50%' }]} />
        <View
          style={[
            styles.medallion,
            {
              width: medallion,
              height: medallion,
              borderRadius: medallion / 2,
              borderWidth: Math.max(1.5, width * 0.025),
            },
          ]}
        >
          <Text
            style={[styles.cardLetter, { fontSize: medallion * 0.62, fontFamily }]}
            allowFontScaling={false}
          >
            {BRAND_INITIAL}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Bouton pilule de la maquette (turquoise par défaut). */
export function PillButton({
  title,
  onPress,
  height,
  fontSize,
  fontFamily,
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  height: number;
  fontSize: number;
  fontFamily?: string;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        onPress();
        playSound('uiClick');
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { height, borderRadius: height / 2 },
        style,
        pressed && styles.buttonPressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tablePalette.cream} />
      ) : (
        <Text numberOfLines={1} style={[styles.buttonText, fontOf(fontFamily), { fontSize }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Ombre portée commune aux titres posés sur le fond. */
export const titleShadow: TextStyle = {
  textShadowColor: 'rgba(0, 0, 0, 0.6)',
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 4,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: tablePalette.backdrop,
    experimental_backgroundImage:
      'radial-gradient(ellipse at center, #C25E14 0%, #8E2512 30%, #5A0E0B 58%, #240504 100%)',
  },
  passThrough: { pointerEvents: 'none' },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2A72E',
    experimental_backgroundImage:
      'linear-gradient(160deg, #F8D873 0%, #E2A72E 30%, #C9861A 55%, #E9B23A 80%, #F6CF5E 100%)',
  },
  ringBright: {
    backgroundColor: '#F09A1C',
    experimental_backgroundImage:
      'linear-gradient(160deg, #F7C04A 0%, #F09A1C 35%, #E07E10 60%, #F5AE2E 100%)',
  },
  felt: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0E3B22',
    experimental_backgroundImage:
      'radial-gradient(circle at 50% 35%, #22703F 0%, #145030 35%, #0B3A1F 65%, #072A15 100%)',
    boxShadow: 'inset 0 0 22px 4px rgba(0, 0, 0, 0.55)',
  },
  feltBright: {
    backgroundColor: '#3C9426',
    experimental_backgroundImage:
      'radial-gradient(circle at 50% 45%, #5BB338 0%, #45A02C 40%, #2F8020 75%, #1F6016 100%)',
    boxShadow: 'inset 0 0 26px 6px rgba(0, 40, 0, 0.55)',
  },
  feltLine: { borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.28)' },
  emblem: { alignItems: 'center', justifyContent: 'center', borderColor: 'rgba(20, 70, 10, 0.5)' },
  emblemLetter: { color: 'rgba(20, 70, 10, 0.5)', includeFontPadding: false },
  card: {
    position: 'absolute',
    borderColor: tablePalette.goldDeep,
    backgroundColor: '#A9572A',
    experimental_backgroundImage: 'linear-gradient(160deg, #C27237 0%, #A2532A 45%, #7E3A1C 100%)',
    boxShadow: '0 6px 14px rgba(0, 0, 0, 0.5)',
  },
  cardFrame: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'rgba(232, 170, 60, 0.75)',
  },
  diamond: {
    position: 'absolute',
    backgroundColor: tablePalette.goldDeep,
    transform: [{ rotate: '45deg' }],
  },
  medallion: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6E3218',
    borderColor: tablePalette.goldDeep,
  },
  cardLetter: { color: tablePalette.gold, fontWeight: '700', includeFontPadding: false },
  button: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: tablePalette.teal,
    experimental_backgroundImage: 'linear-gradient(180deg, #2DB3B1 0%, #1C9396 55%, #17797F 100%)',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
  },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  inactive: { opacity: 0.6 },
  buttonText: {
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
