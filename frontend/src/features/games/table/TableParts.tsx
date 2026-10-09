import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
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
import { formatDistance } from './distance';

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

/** Table ronde en bois : planches, liseré foncé, anneau gravé et monogramme L en filigrane. */
export function WoodTable({ diameter }: { diameter: number }) {
  const fonts = useTableFonts();
  const ring = diameter * 0.5;
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
        style={[
          styles.engraving,
          {
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: Math.max(3, diameter * 0.04),
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

export interface SeatState {
  /** Pseudo réel du joueur (D-064) ; absent ou inconnu : libellé neutre, jamais un faux pseudo. */
  name: string;
  local: boolean;
  /** C'est à lui de jouer (joueur attendu par le serveur). */
  active: boolean;
  firstPlayer: boolean;
  /** Ligne d'état, uniquement à partir des données de la partie. */
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
 * Plaque d'un joueur, style de la table de référence : rectangle sombre, nom centré, ligne
 * d'état discrète. Le joueur attendu a un liseré doré fixe (le signal lumineux de 2 s est
 * posé sur ses cartes), J1 une pastille dorée. Sans joueur : plaque vide et estompée.
 *
 * La plaque prend la hauteur de son contenu (`plateContentHeight`), posée dans l'emplacement
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
  const detailSize = Math.round(Math.max(10, height * 0.25));
  const plateHeight = plateContentHeight(height, Boolean(state?.detail));
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
          state.local && styles.plateLocal,
          state.active && styles.plateActive,
          state.winner && styles.plateWinner,
          state.dimmed && styles.plateDimmed,
          { height: plateHeight, paddingHorizontal: chip * 0.7 },
        ]}
      >
        {/* Pseudo long : il rétrécit un peu puis s'arrête en « … », la plaque ne se déforme pas. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[styles.plateName, fontOf(fonts.button), { fontSize: nameSize }]}
        >
          {state.name}
        </Text>
        {state.detail ? (
          <Text
            numberOfLines={1}
            style={[
              styles.plateDetail,
              state.active && styles.plateDetailActive,
              { fontSize: detailSize, lineHeight: detailSize * 1.1 },
            ]}
          >
            {state.detail}
          </Text>
        ) : null}
        {state.firstPlayer ? (
          <View
            style={[
              styles.firstChip,
              {
                width: chip,
                height: chip,
                borderRadius: chip / 2,
                left: -chip * 0.45,
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
    </View>
  );
}

/**
 * Étiquette de distance entre le joueur connecté et un adversaire : petite pastille
 * translucide « ↔ 850 m », posée entre les deux joueurs, hors de la table. Sans distance
 * connue (aucune géolocalisation aujourd'hui, T-03), elle affiche « — » : jamais une valeur
 * inventée, jamais de coordonnées. Un changement de valeur se fait en fondu, sans clignoter.
 */
export function DistanceTag({
  meters,
  playerName,
  width,
  style,
}: {
  meters?: number;
  playerName: string;
  /** Largeur de l'emplacement : la pastille y est centrée. */
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { smallSize } = useLobbyMetrics();
  const label = formatDistance(meters);
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
      accessibilityLabel={
        meters === undefined
          ? `Distance avec ${playerName} : indisponible`
          : `Distance avec ${playerName} : ${label}`
      }
      style={[styles.distance, { width }, style]}
    >
      <Animated.View style={[styles.distancePill, { opacity, paddingHorizontal: fontSize * 0.7 }]}>
        <Text allowFontScaling={false} style={[styles.distanceIcon, { fontSize }]}>
          ↔
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[
            styles.distanceText,
            meters === undefined && styles.distanceUnknown,
            { fontSize },
          ]}
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
export function BalancePill({
  height,
  onPress,
  children,
}: {
  height: number;
  /** « Ajouter des jetons » : ouvre la Boutique. */
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Ajouter des jetons"
      hitSlop={6}
      style={({ pressed }) => [
        styles.balance,
        { height, borderRadius: height / 2, paddingHorizontal: height * 0.3 },
        pressed && styles.softPressed,
      ]}
    >
      {children}
      <View
        style={[
          styles.balancePlus,
          {
            width: height * 0.36,
            height: height * 0.36,
            borderRadius: height * 0.18,
          },
        ]}
      >
        <Text allowFontScaling={false} style={[styles.balancePlusText, { fontSize: height * 0.3 }]}>
          +
        </Text>
      </View>
    </Pressable>
  );
}

const glassBorder = 'rgba(255, 255, 255, 0.14)';

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
  balancePlus: {
    position: 'absolute',
    top: -4,
    right: -4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2FA43A',
    borderWidth: 1,
    borderColor: '#BDF5B0',
  },
  balancePlusText: {
    color: '#FFFFFF',
    fontWeight: '900',
    includeFontPadding: false,
  },
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
  plate: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.35)',
    backgroundColor: 'rgba(8, 44, 18, 0.82)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(20, 70, 32, 0.9) 0%, rgba(6, 36, 14, 0.9) 100%)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.35)',
  },
  plateEmpty: {
    opacity: 0.55,
    borderStyle: 'dashed',
    borderColor: glassBorder,
  },
  plateLocal: { borderColor: 'rgba(242, 196, 81, 0.45)' },
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
  plateDetail: { color: 'rgba(255, 255, 255, 0.72)', textAlign: 'center' },
  plateDetailActive: { color: palette.gold },
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
