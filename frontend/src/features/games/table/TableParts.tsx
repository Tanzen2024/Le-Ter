import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  BRAND_INITIAL,
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { distanceLabel, type DistanceView } from './distance';
import { CONTROL_SIGNAL_MS, useReducedMotion } from './turn-signal';

/**
 * Pièces de l'aire de jeu, style « soft » : la table en bois domine, tout le reste est
 * translucide, fin et discret (transparences, bordures fines, ombres douces).
 */

/** Tapis vert éclairé au centre, avec un décor TATAMI estompé dans les coins. */
export function FeltBackdrop({ children }: { children: ReactNode }) {
  const { width, height } = useLobbyMetrics();
  const disc = Math.round(height * 0.4);
  const mat = Math.round(height * 0.62);
  return (
    <View style={styles.felt}>
      <View
        style={[StyleSheet.absoluteFill, styles.passThrough]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <PatternMat
          size={mat}
          style={{
            right: -mat * 0.25,
            top: -mat * 0.42,
            transform: [{ rotate: '-12deg' }],
          }}
        />
        <PatternMat
          size={mat}
          style={{
            left: -mat * 0.45,
            bottom: -mat * 0.3,
            transform: [{ rotate: '38deg' }],
          }}
        />
        <WoodDisc size={disc} style={{ left: width * 0.16, top: -disc * 0.62 }} />
        <WoodDisc size={disc} style={{ left: -disc * 0.35, bottom: -disc * 0.4 }} />
        <WoodDisc size={disc} style={{ right: -disc * 0.3, bottom: -disc * 0.45 }} />
      </View>
      {children}
    </View>
  );
}

/** Tapis à motifs géométriques (losanges imbriqués), en filigrane. */
function PatternMat({ size, style }: { size: number; style: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[styles.mat, { width: size * 1.5, height: size, borderRadius: size * 0.06 }, style]}
    >
      {[0.7, 0.48, 0.26].map((ratio) => (
        <View
          key={ratio}
          style={[
            styles.matDiamond,
            {
              width: size * ratio,
              height: size * ratio,
              borderRadius: size * 0.03,
            },
          ]}
        />
      ))}
    </View>
  );
}

/** Disque de bois cerclé d'ocre (décor). */
function WoodDisc({ size, style }: { size: number; style: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: size * 0.06,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.discInner,
          {
            width: size * 0.62,
            height: size * 0.62,
            borderRadius: size * 0.31,
          },
        ]}
      />
    </View>
  );
}

/**
 * Table ronde en bois : planches, liseré foncé, anneau gravé et monogramme L en filigrane.
 * `ring` / `ringBorder` : diamètre et trait de l'anneau gravé (proportions de la référence,
 * voir `centerCircles`).
 */
export function WoodTable({
  diameter,
  ring = diameter * 0.54,
  ringBorder = Math.max(3, diameter * 0.044),
}: {
  diameter: number;
  ring?: number;
  ringBorder?: number;
}) {
  const fonts = useTableFonts();
  const planks = 9;
  return (
    <View
      style={[
        styles.table,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderWidth: Math.max(3, diameter * 0.018),
        },
      ]}
    >
      {Array.from({ length: planks - 1 }, (_, i) => (
        <View key={i} style={[styles.plank, { top: ((i + 1) * diameter) / planks }]} />
      ))}
      <View style={[styles.tableLight, { borderRadius: diameter / 2 }]} />
      <View
        testID="table-ring"
        style={[
          styles.engraving,
          {
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: ringBorder,
          },
        ]}
      >
        <Text
          allowFontScaling={false}
          style={[styles.engravedLetter, fontOf(fonts.button), { fontSize: ring * 0.62 }]}
        >
          {BRAND_INITIAL}
        </Text>
      </View>
    </View>
  );
}

/** Plaque translucide (état central de la table, messages). */
export function GlassBox({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

/**
 * Images clés du halo de contrôle sur ses 3 s (`CONTROL_SIGNAL_MS`), en fraction de la durée :
 * apparition immédiate, 1re pulsation, retour à une intensité de base (jamais éteint),
 * 2e pulsation, extinction progressive. `bloom` : grande lueur extérieure (opacité, échelle) ;
 * `core` : contour brillant et lueur serrée, qui reste net jusqu'à l'extinction.
 */
export const CONTROL_GLOW_KEYFRAMES = {
  at: [0, 0.06, 0.13, 0.22, 0.32, 0.42, 0.5, 0.6, 0.7, 0.85, 1],
  bloom: [0.75, 0.95, 1, 0.75, 0.55, 0.8, 1, 0.75, 0.6, 0.3, 0],
  scale: [0.97, 1.06, 1.12, 1.05, 1, 1.06, 1.12, 1.05, 1, 0.99, 0.98],
  core: [1, 1, 1, 0.92, 0.85, 0.95, 1, 0.95, 0.9, 0.6, 0],
} as const;

/** Marge de la grande lueur autour de la plaque, selon sa hauteur (smartphone → tablette). */
export function controlGlowSpread(plateHeight: number): number {
  return Math.round(Math.min(22, Math.max(12, plateHeight * 0.5)));
}

/**
 * Halo du joueur qui OBTIENT le contrôle, construit pour se voir d'un coup d'œil sur
 * smartphone, et distinct du signal de tour (simple cadre sur les cartes) :
 * 1. grande lueur extérieure dorée (fond translucide et ombres larges), qui pulse en
 *    intensité ET en taille ;
 * 2. contour doré saturé, double ombre serrée (or clair puis or profond) ;
 * 3. liseré ambre foncé à l'extérieur du contour : il le détache du bois clair de la table
 *    comme du tapis sombre ;
 * 4. reflet clair intérieur pour la brillance.
 * Une seule animation (progression 0 → 1 sur 3 s, pilote natif) interpolée par images clés :
 * fluide, sans clignotement. Dessiné DERRIÈRE tout le reste de l'aire de jeu (plaques,
 * cartes, chrono, boutons) : il ne masque rien, ne capte aucun geste et ne déplace rien.
 * Avec « réduire les animations » : halo fixe, sans pulsation.
 */
export function ControlGlow({
  rect,
}: {
  rect: { left: number; top: number; width: number; height: number };
}) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: CONTROL_SIGNAL_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);

  const k = CONTROL_GLOW_KEYFRAMES;
  const track = (values: readonly number[], still: number) =>
    reduced ? still : progress.interpolate({ inputRange: [...k.at], outputRange: [...values] });
  const spread = controlGlowSpread(rect.height);
  const rim = 4;
  const box = (pad: number) => ({
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  });
  return (
    <View
      testID="control-glow"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.glowLayer, box(spread)]}
    >
      <Animated.View
        testID="control-glow-bloom"
        style={[
          styles.glowBloom,
          // Toute la couche élargie : la lueur déborde de `spread` px autour de la plaque.
          StyleSheet.absoluteFill,
          { borderRadius: spread + 8 },
          { opacity: track(k.bloom, 0.85), transform: [{ scale: track(k.scale, 1) }] },
        ]}
      >
        {/* Anneaux pleins, SANS ombre : la lueur reste visible même si un appareil rend mal
            les ombres larges. Du plus large (diffus) au plus proche de la plaque (dense). */}
        {[0.45, 0.78].map((depth) => (
          <View
            key={depth}
            testID="control-glow-ring"
            style={[
              styles.glowRing,
              {
                left: spread * depth,
                top: spread * depth,
                right: spread * depth,
                bottom: spread * depth,
                borderRadius: spread * (1 - depth) + 10,
                backgroundColor: `rgba(255, 200, 40, ${depth > 0.6 ? 0.38 : 0.24})`,
              },
            ]}
          />
        ))}
      </Animated.View>
      <Animated.View
        testID="control-glow-rim"
        style={[
          styles.glowRim,
          {
            left: spread - rim,
            top: spread - rim,
            width: rect.width + rim * 2,
            height: rect.height + rim * 2,
            borderRadius: 10,
            opacity: track(k.core, 1),
          },
        ]}
      >
        <View style={[styles.glowHighlight, { borderRadius: 8 }]} />
      </Animated.View>
    </View>
  );
}

export interface SeatState {
  /** Pseudo réel du joueur (D-064) ; absent ou inconnu : libellé neutre, jamais un faux pseudo. */
  name: string;
  local: boolean;
  /** C'est à lui de jouer (joueur attendu par le serveur). */
  active: boolean;
  firstPlayer: boolean;
  /**
   * État du joueur, uniquement à partir des données de la partie. Jamais écrit dans la barre
   * (qui n'affiche que le pseudo) : il n'est annoncé qu'aux lecteurs d'écran.
   */
  detail?: string;
  dimmed: boolean;
  winner: boolean;
}

/** Hauteur réelle d'une plaque : son contenu (nom, ligne d'état) et une marge réduite. */
export function plateContentHeight(slotHeight: number, withDetail: boolean): number {
  const nameSize = Math.round(Math.max(12, slotHeight * 0.36));
  const detailSize = Math.round(Math.max(10, slotHeight * 0.25));
  const padding = Math.max(3, Math.round(nameSize * 0.25));
  const content = nameSize * 1.25 + (withDetail ? detailSize * 1.1 : 0);
  return Math.min(slotHeight, Math.ceil(content + padding * 2 + 2));
}

/**
 * Barre d'un joueur, style de la table de référence : rectangle vert très sombre translucide,
 * coins arrondis, et SEULEMENT le pseudo, blanc, gras, centré. Le joueur attendu garde un
 * liseré doré fixe et discret (le halo lumineux de 5 s est posé sur ses cartes) ; J1 a une
 * pastille dorée à cheval sur le bord gauche, hors de la barre. Sans joueur : barre vide.
 *
 * La barre prend la hauteur d'une ligne (`plateContentHeight`), posée dans l'emplacement
 * `width` × `height` de la disposition : collée en haut (dos des cartes juste au-dessus) ou en
 * bas (joueur connecté, aligné sur sa main). La disposition de la table ne bouge pas.
 */
export function SeatPlate({
  state,
  width,
  height,
  align = 'top',
  style,
}: {
  state?: SeatState;
  width: number;
  height: number;
  align?: 'top' | 'bottom';
  style: StyleProp<ViewStyle>;
}) {
  const fonts = useTableFonts();
  const nameSize = Math.round(Math.max(12, height * 0.36));
  const plateHeight = plateContentHeight(height, false);
  const chip = Math.round(Math.min(height * 0.62, plateHeight * 0.9));
  const slot = [
    styles.plateSlot,
    {
      width,
      height,
      justifyContent: align === 'top' ? 'flex-start' : 'flex-end',
    } as const,
    style,
  ];
  if (!state) {
    return (
      <View pointerEvents="box-none" style={slot}>
        <View
          testID="seat-plate"
          accessible
          accessibilityLabel="Siège sans joueur dans cette partie"
          style={[styles.plate, styles.plateEmpty, { height: plateHeight }]}
        />
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={slot}>
      <View
        testID="seat-plate"
        accessible
        accessibilityLabel={[state.name, state.firstPlayer ? 'premier joueur' : '', state.detail]
          .filter(Boolean)
          .join(', ')}
        style={[
          styles.plate,
          state.active && styles.plateActive,
          state.winner && styles.plateWinner,
          state.dimmed && styles.plateDimmed,
          { height: plateHeight, paddingHorizontal: plateHeight * 0.4 },
        ]}
      >
        {/* Pseudo long : il rétrécit un peu puis s'arrête en « … », la barre ne se déforme pas. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[styles.plateName, fontOf(fonts.button), { fontSize: nameSize }]}
        >
          {state.name}
        </Text>
      </View>
      {state.firstPlayer ? (
        // Pastille J1 posée à cheval sur le bord gauche, hors du contenu de la barre (qui
        // n'affiche que le pseudo) : elle ne recouvre ni dos, ni cartes jouées, ni étiquette.
        <View
          testID="first-player-chip"
          style={[
            styles.firstChip,
            {
              width: chip,
              height: chip,
              borderRadius: chip / 2,
              left: -chip * 0.6,
              [align === 'top' ? 'top' : 'bottom']: (plateHeight - chip) / 2,
            },
          ]}
        >
          <Text
            allowFontScaling={false}
            style={[styles.firstChipText, fontOf(fonts.button), { fontSize: chip * 0.42 }]}
          >
            J1
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Étiquette de distance entre le joueur connecté et un adversaire : petite pastille
 * translucide « ↔ 850 m », posée entre les deux joueurs, hors de la table. Affichée SEULEMENT
 * pour une partie surveillée (D-043 et D-053). Distance inconnue : sa cause (« En attente de
 * position », « Position obsolète », « GPS indisponible », « Localisation refusée »), jamais
 * une valeur inventée ni « 0 m », jamais de coordonnées. Un changement se fait en fondu, sans
 * clignoter ni déplacer la mise en page (largeur fixe, texte réduit si besoin).
 */
export function DistanceTag({
  distance,
  playerName,
  width,
  style,
}: {
  distance: DistanceView;
  playerName: string;
  /** Largeur de l'emplacement : la pastille y est centrée. */
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { smallSize } = useLobbyMetrics();
  const label = distanceLabel(distance);
  const known = distance.kind === 'known';
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    opacity.setValue(0.4);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [label, opacity]);
  const fontSize = Math.max(10, smallSize - 2);
  return (
    <View
      accessible
      testID="distance-tag"
      accessibilityLabel={`Distance avec ${playerName} : ${known ? label : label.toLowerCase()}`}
      style={[styles.distance, { width }, style]}
    >
      <Animated.View
        style={[
          styles.distancePill,
          { opacity, paddingHorizontal: fontSize * 0.7, maxWidth: width },
        ]}
      >
        <Text allowFontScaling={false} style={[styles.distanceIcon, { fontSize }]}>
          ↔
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          allowFontScaling={false}
          style={[styles.distanceText, !known && styles.distanceUnknown, { fontSize, flexShrink: 1 }]}
        >
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

/** Bouton compact et discret (quitter, réglages, chat). */
export function SoftIconButton({
  label,
  tone,
  size,
  onPress,
  children,
}: {
  label: string;
  tone: 'danger' | 'teal';
  size: number;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.softButton,
        tone === 'danger' ? styles.softDanger : styles.softTeal,
        { width: size, height: size, borderRadius: size * 0.26 },
        pressed && styles.softPressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Pictogramme « sortie » : flèche claire dans un cadre fin. */
export function ExitGlyph({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.exitFrame,
        { width: size * 0.5, height: size * 0.5, borderRadius: size * 0.08 },
      ]}
    >
      <Text allowFontScaling={false} style={[styles.exitArrow, { fontSize: size * 0.38 }]}>
        ←
      </Text>
    </View>
  );
}

/** Pilule discrète du solde réel du compte de jeu ; un appui ouvre la Boutique. */
/**
 * Solde affiché à la table, en LECTURE SEULE : pendant une partie, aucune opération
 * financière (achat, retrait) n'est proposée ; elles restent accessibles depuis l'accueil.
 */
export function BalancePill({ height, children }: { height: number; children: ReactNode }) {
  return (
    <View
      testID="table-balance"
      style={[
        styles.balance,
        { height, borderRadius: height / 2, paddingHorizontal: height * 0.3 },
      ]}
    >
      {children}
    </View>
  );
}

const glassBorder = 'rgba(255, 255, 255, 0.14)';

const styles = StyleSheet.create({
  glowLayer: { position: 'absolute', pointerEvents: 'none' },
  glowBloom: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 196, 36, 0.28)',
    // Double halo : diffusion large or profond + lueur intermédiaire or clair.
    boxShadow:
      '0 0 18px 6px rgba(255, 214, 64, 0.85), 0 0 40px 18px rgba(255, 170, 0, 0.6), 0 0 70px 28px rgba(255, 150, 0, 0.3)',
  },
  glowRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 226, 110, 0.65)',
  },
  glowRim: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#FFD23F',
    // Noyau serré éclatant, puis or saturé ; liseré ambre foncé pour le contraste.
    boxShadow:
      '0 0 0 1.5px rgba(110, 60, 0, 0.75), 0 0 10px 3px rgba(255, 244, 170, 0.95), 0 0 22px 8px rgba(255, 196, 30, 0.9)',
  },
  glowHighlight: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 250, 220, 0.9)',
  },
  passThrough: { pointerEvents: 'none' },
  felt: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#1F7430',
    experimental_backgroundImage:
      'radial-gradient(ellipse at 50% 45%, #44A548 0%, #2C8A37 32%, #1B6828 64%, #0D4518 100%)',
  },
  mat: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
    borderWidth: 1.5,
    borderColor: 'rgba(200, 240, 160, 0.55)',
    backgroundColor: 'rgba(10, 50, 20, 0.55)',
  },
  matDiamond: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(170, 225, 130, 0.5)',
    transform: [{ rotate: '45deg' }],
  },
  disc: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
    borderColor: '#B6481E',
    backgroundColor: '#8A5530',
    experimental_backgroundImage: 'linear-gradient(170deg, #9C6238 0%, #7A4626 60%, #5E331A 100%)',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
  },
  discInner: { borderWidth: 2, borderColor: 'rgba(230, 150, 60, 0.45)' },
  table: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#5E2A0E',
    backgroundColor: '#B85A24',
    experimental_backgroundImage:
      'radial-gradient(circle at 50% 38%, #E58A44 0%, #CB6A2C 38%, #A9521E 72%, #7A3612 100%)',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.5), inset 0 0 24px rgba(60, 20, 0, 0.45)',
  },
  tableLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    experimental_backgroundImage:
      'radial-gradient(ellipse at 50% 30%, rgba(255, 210, 150, 0.28) 0%, rgba(255, 210, 150, 0) 60%)',
  },
  plank: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(70, 28, 6, 0.28)',
  },
  engraving: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'rgba(80, 32, 8, 0.3)',
    // Relief : ombre portée vers l'extérieur et liseré clair, l'anneau semble posé sur la table.
    boxShadow:
      '0 3px 8px rgba(40, 14, 0, 0.45), 0 0 0 1.5px rgba(255, 214, 160, 0.28), inset 0 2px 6px rgba(255, 220, 170, 0.18)',
  },
  engravedLetter: { color: 'rgba(80, 32, 8, 0.32)', includeFontPadding: false },
  glass: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 220, 170, 0.18)',
    backgroundColor: 'rgba(40, 18, 8, 0.62)',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
  },
  plateSlot: { position: 'absolute' },
  // Barre de pseudo de la référence : vert très sombre translucide, sans relief marqué.
  plate: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    backgroundColor: 'rgba(4, 30, 12, 0.78)',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
  },
  plateEmpty: {
    opacity: 0.55,
    borderStyle: 'dashed',
    borderColor: glassBorder,
  },
  plateActive: { borderColor: palette.gold, borderWidth: 1.5 },
  plateWinner: {
    borderColor: palette.gold,
    boxShadow: '0 0 14px rgba(242, 196, 81, 0.45)',
  },
  plateDimmed: { opacity: 0.5 },
  firstChip: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gold,
    experimental_backgroundImage: 'linear-gradient(180deg, #FFE08A 0%, #E9A92A 100%)',
    borderWidth: 1.5,
    borderColor: '#7A4A10',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.4)',
  },
  firstChipText: { color: '#5A3208', includeFontPadding: false },
  plateName: {
    color: '#FFFFFF',
    textAlign: 'center',
    includeFontPadding: false,
  },
  distance: {
    flexDirection: 'row',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  distancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
  },
  distanceIcon: { color: 'rgba(242, 196, 81, 0.85)', fontWeight: '700' },
  distanceText: { color: 'rgba(255, 255, 255, 0.9)', fontWeight: '600' },
  distanceUnknown: { color: 'rgba(255, 255, 255, 0.6)' },
  softButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.28)',
  },
  softDanger: {
    backgroundColor: '#9E2329',
    experimental_backgroundImage: 'linear-gradient(180deg, #B8323A 0%, #8E1E24 100%)',
  },
  softTeal: {
    backgroundColor: 'rgba(23, 128, 110, 0.85)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(38, 160, 140, 0.9) 0%, rgba(18, 110, 96, 0.9) 100%)',
  },
  softPressed: { opacity: 0.8, transform: [{ scale: 0.95 }] },
  exitFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.85)',
  },
  exitArrow: { color: '#FFFFFF', fontWeight: '900', includeFontPadding: false },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: glassBorder,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
});
