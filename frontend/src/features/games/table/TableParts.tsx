import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { LogOut } from 'lucide-react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { fontOf, useTableFonts } from '../../../components/table/TableDecor';
import { gameTheme, motion } from '../../../constants/theme';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { UNKNOWN_PLAYER_LABEL, UNKNOWN_SELF_LABEL } from '../format';
import { distanceLabel, type DistanceView } from './distance';
import { remainingFraction, type TurnPhase } from './turn-phase';
import { CONTROL_SIGNAL_MS, useReducedMotion } from './turn-signal';

/**
 * Pièces de l'aire de jeu, direction « Ébène & Laiton » (`gameTheme`) : une pièce sombre où
 * seule la table est éclairée ; plaques, HUD et panneaux en laque sombre à filet de laiton,
 * en retrait des cartes. Présentation seulement : aucune pièce ne décide d'un état de jeu.
 * La salle et la table elles-mêmes sont dessinées dans `TableSurface`.
 */
export { FeltBackdrop, WoodTable } from './TableSurface';

/**
 * Entrée d'un panneau posé sur la table (attente, vote de mise, égalité) : fondu et léger
 * zoom, rapides (`motion.panel`). Ne retarde ni ne bloque aucun bouton ; avec « réduire les
 * animations », affichage direct.
 */
export function PanelEntrance({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [entrance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: motion.panel,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance, reduced]);
  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Plaque de laque sombre à filet de laiton (état central de la table, messages). */
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
 * Monogramme d'un joueur : première lettre de son pseudo RÉEL. Libellé neutre (pseudo absent,
 * « Vous » / « Adversaire ») : aucun monogramme, une silhouette neutre à la place.
 */
export function monogramOf(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === UNKNOWN_SELF_LABEL || trimmed === UNKNOWN_PLAYER_LABEL) return null;
  return Array.from(trimmed)[0]?.toLocaleUpperCase('fr') ?? null;
}

/**
 * Teinte du jeton d'un joueur (index dans `gameTheme.avatarTones`), dérivée de son pseudo RÉEL :
 * la même à chaque partie et sur chaque écran. Sans pseudo (libellé neutre) : teinte neutre.
 */
export function avatarToneOf(name: string): number {
  const neutral = gameTheme.avatarTones.length - 1;
  if (monogramOf(name) === null) return neutral;
  let hash = 0;
  for (const char of name.trim().toLocaleLowerCase('fr')) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % neutral;
}

/**
 * Jeton : couronne de laiton crénelée (huit encoches ivoire) et cœur de pierre (repère 100).
 * Remplit son parent ; partagé avec le profil (le même jeton qu'à la table).
 */
export function ChipArt({ tone }: { tone: number }) {
  const [light, mid, deep] = gameTheme.avatarTones[tone] ?? gameTheme.avatarTones[0]!;
  const edge = 46;
  const notches = (2 * Math.PI * edge) / 16;
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="chipRim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F7DE92" />
          <Stop offset="0.5" stopColor="#C99A3E" />
          <Stop offset="1" stopColor="#7C5A1E" />
        </LinearGradient>
        <RadialGradient id={`chipCore${tone}`} cx="38%" cy="32%" r="72%">
          <Stop offset="0" stopColor={light} />
          <Stop offset="0.55" stopColor={mid} />
          <Stop offset="1" stopColor={deep} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#chipRim)" />
      <Circle
        cx="50"
        cy="50"
        r={edge}
        fill="none"
        stroke="#F6EFDF"
        strokeWidth="8"
        strokeDasharray={`${notches * 0.55} ${notches * 1.45}`}
        opacity={0.85}
      />
      <Circle cx="50" cy="50" r="38" fill={`url(#chipCore${tone})`} />
      <Circle cx="50" cy="50" r="38" fill="none" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="1.5" />
      <Circle cx="50" cy="50" r="34" fill="none" stroke="#F2D27A" strokeWidth="0.8" opacity={0.6} />
    </Svg>
  );
}

/**
 * Médaillon d'un joueur dans sa plaque : jeton de laiton crénelé, cœur de pierre à sa teinte
 * (`avatarToneOf`) et monogramme gravé (aucune photo n'est fournie par le serveur, aucune n'est
 * inventée). Anneau jade pour le joueur connecté, or vif pour le joueur attendu ou le gagnant.
 * Décoratif : la plaque annonce déjà le pseudo.
 */
function SeatAvatar({
  name,
  size,
  ring,
}: {
  name: string;
  size: number;
  ring: 'focus' | 'self' | 'plain';
}) {
  const fonts = useTableFonts();
  const letter = monogramOf(name);
  const ringColor =
    ring === 'focus' ? gameTheme.focus : ring === 'self' ? gameTheme.self : 'rgba(0, 0, 0, 0.6)';
  return (
    <View
      testID="seat-avatar"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: ringColor,
          borderWidth: ring === 'plain' ? 1 : Math.max(1.5, size * 0.07),
        },
        ring === 'focus' && styles.avatarFocus,
      ]}
    >
      <ChipArt tone={avatarToneOf(name)} />
      {letter ? (
        <Text
          allowFontScaling={false}
          style={[styles.avatarLetter, fontOf(fonts.title), { fontSize: size * 0.42 }]}
        >
          {letter}
        </Text>
      ) : (
        <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24">
          <Circle cx="12" cy="8.5" r="4.2" fill={gameTheme.ivory} opacity={0.8} />
          <Path d="M3.5 22 C4.5 15.5 19.5 15.5 20.5 22 Z" fill={gameTheme.ivory} opacity={0.8} />
        </Svg>
      )}
    </View>
  );
}

/**
 * Bref éclat de la plaque quand son joueur DEVIENT le joueur attendu (état du serveur) :
 * léger gonflement et lueur d'or qui retombe. L'état actif reste lisible ensuite (contour
 * or) ; avec « réduire les animations », aucun mouvement.
 */
function useActivePulse(active: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  const was = useRef(active);
  useEffect(() => {
    const became = active && !was.current;
    was.current = active;
    if (!became || reduced) return;
    pulse.setValue(0);
    const animation = Animated.timing(pulse, {
      toValue: 1,
      duration: motion.turn + 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduced, pulse]);
  return pulse;
}

/**
 * Plaque d'un joueur : capsule de laque sombre, médaillon (monogramme) à gauche et SEULEMENT
 * le pseudo, blanc, gras. Le joueur attendu prend un contour or vif et une lueur (le halo de
 * 5 s est posé sur ses cartes) ; le joueur connecté se reconnaît à son anneau jade, jamais à
 * l'or. Sans joueur : capsule vide en pointillé.
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
  turn = null,
  style,
}: {
  state?: SeatState;
  width: number;
  height: number;
  align?: 'top' | 'bottom';
  /**
   * Tour en cours de CE joueur, vu par UN AUTRE joueur (sinon `null`) : la barre se vide
   * jusqu'à l'échéance affichée. Jamais sur sa propre plaque (voir `seatTurnFor`).
   */
  turn?: TurnPhase | null;
  style: StyleProp<ViewStyle>;
}) {
  const fonts = useTableFonts();
  const nameSize = Math.round(Math.max(12, height * 0.36));
  const plateHeight = plateContentHeight(height, false);
  const pulse = useActivePulse(Boolean(state?.active && !state.dimmed));
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
          style={[
            styles.plate,
            styles.plateEmpty,
            { height: plateHeight, borderRadius: plateHeight / 2 },
          ]}
        />
      </View>
    );
  }
  const inset = Math.max(2, Math.round(plateHeight * 0.1));
  const avatar = plateHeight - inset * 2;
  const focus = (state.active && !state.dimmed) || state.winner;
  return (
    <View pointerEvents="box-none" style={slot}>
      <Animated.View
        style={[
          styles.plateMotion,
          {
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.07, 1] }) },
            ],
          },
        ]}
      >
        {/* Éclat du changement de tour, derrière la plaque. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.plateFlare,
            {
              borderRadius: plateHeight / 2,
              opacity: pulse.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] }),
            },
          ]}
        />
        <View
          testID="seat-plate"
          accessible
          accessibilityLabel={[state.name, state.firstPlayer ? 'premier joueur' : '', state.detail]
            .filter(Boolean)
            .join(', ')}
          style={[
            styles.plate,
            state.local && styles.plateSelf,
            state.active && styles.plateActive,
            state.winner && styles.plateWinner,
            state.dimmed && styles.plateDimmed,
            {
              height: plateHeight,
              borderRadius: plateHeight / 2,
              paddingLeft: inset,
              paddingRight: plateHeight * 0.45,
              gap: Math.max(4, plateHeight * 0.18),
            },
          ]}
        >
          {turn && !state.dimmed ? (
            <TurnProgressFill key={turn.key} turn={turn} radius={plateHeight / 2} />
          ) : null}
          <SeatAvatar
            name={state.name}
            size={avatar}
            ring={focus ? 'focus' : state.local ? 'self' : 'plain'}
          />
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
      </Animated.View>
    </View>
  );
}

/** Part restante sous laquelle la barre passe au bordeaux (≈ 3 dernières secondes de 10 s). */
export const URGENT_FRACTION = 0.3;

/**
 * Remplissage de la barre d'un joueur pendant SON tour : part restante du délai fixé par le
 * serveur (`restant / durée`, bornée à [0, 1]). Une seule animation linéaire par tour, du
 * niveau réel au moment de l'affichage jusqu'à 0 à l'échéance : jamais un compteur local, et
 * un état reçu en retard ou après une reconnexion reprend au bon niveau (sans repartir de
 * 10 s). Relancée seulement si l'échéance locale change (`localDeadline`, déjà stabilisée).
 * Or sur fond vert, bordeaux à la fin ; pilote natif (`scaleX`), aucun geste capté.
 */
export function TurnProgressFill({ turn, radius = 6 }: { turn: TurnPhase; radius?: number }) {
  const [progress] = useState(() => new Animated.Value(remainingFraction(turn, Date.now())));
  const { localDeadline, totalMs, timedOut } = turn;
  useEffect(() => {
    const now = Date.now();
    const from = remainingFraction({ key: '', playerId: '', localDeadline, totalMs, timedOut }, now);
    progress.setValue(from);
    if (from <= 0) return;
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: Math.max(0, localDeadline - now),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, localDeadline, totalMs, timedOut]);
  const urgent = progress.interpolate({
    inputRange: [0, URGENT_FRACTION, URGENT_FRACTION + 0.001, 1],
    outputRange: [1, 1, 0, 0],
  });
  return (
    <View
      testID="turn-progress"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, styles.progressTrack, { borderRadius: radius }]}
    >
      <Animated.View
        testID="turn-progress-fill"
        style={[StyleSheet.absoluteFill, styles.progressFill, { transform: [{ scaleX: progress }] }]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.progressUrgent, { opacity: urgent }]} />
        <View style={styles.progressEdge} />
      </Animated.View>
    </View>
  );
}

/**
 * Étiquette de distance entre le joueur connecté et un adversaire : petite pastille
 * translucide « ↔ 850 m », posée entre les deux joueurs, hors de la table. Affichée SEULEMENT
 * pour une partie surveillée (D-043 et D-053). Distance inconnue : sa cause (« Recherche
 * GPS… », « Localisation désactivée », « Position de <pseudo> non reçue », « En attente de
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
  const label = distanceLabel(distance, playerName);
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
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.softPressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Couleur des pictogrammes des médaillons (`SoftIconButton`). */
export const TABLE_ICON_COLOR = gameTheme.brass.bright;

/** Pictogramme « sortie » : porte et flèche vers la gauche, vectoriels (même rendu partout). */
export function ExitGlyph({ size }: { size: number }) {
  return (
    <View style={styles.exitGlyph}>
      <LogOut size={Math.round(size * 0.46)} color={gameTheme.ivory} strokeWidth={2.2} />
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

const t = gameTheme;

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
  glass: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.lacquer.border,
    backgroundColor: t.lacquer.fill,
    experimental_backgroundImage: t.lacquer.surface,
    // Double filet Art déco : liseré de laque puis filet de laiton à l'intérieur du bord.
    boxShadow: `${t.shadow.panel}, inset 0 0 0 2px rgba(0, 0, 0, 0.45), inset 0 0 0 3px ${t.brass.faint}`,
  },
  plateSlot: { position: 'absolute' },
  progressTrack: { overflow: 'hidden' },
  // Ancrée à gauche : la barre se vide de droite à gauche.
  progressFill: {
    transformOrigin: 'left',
    backgroundColor: 'rgba(214, 160, 40, 0.5)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(242, 210, 122, 0.55) 0%, rgba(176, 128, 36, 0.5) 100%)',
  },
  progressUrgent: {
    backgroundColor: 'rgba(150, 24, 36, 0.78)',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(226, 87, 76, 0.85) 0%, rgba(122, 20, 30, 0.8) 100%)',
  },
  progressEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 2,
    backgroundColor: 'rgba(255, 240, 190, 0.9)',
  },
  plateMotion: { alignSelf: 'stretch' },
  plateFlare: {
    backgroundColor: 'rgba(245, 200, 66, 0.35)',
    boxShadow: `0 0 18px 6px ${t.focusGlow}`,
  },
  // Capsule de laque sombre, filet de laiton : en retrait des cartes.
  plate: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.lacquer.border,
    backgroundColor: t.lacquer.fill,
    experimental_backgroundImage: t.lacquer.surface,
    // Filet de laiton intérieur, comme les plaques de la table (LOT 1).
    boxShadow: `${t.shadow.plate}, inset 0 0 0 2px rgba(0, 0, 0, 0.45), inset 0 0 0 3px ${t.brass.faint}`,
  },
  plateEmpty: {
    opacity: 0.55,
    borderStyle: 'dashed',
    borderColor: t.brass.hairline,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    experimental_backgroundImage: undefined,
    boxShadow: undefined,
  },
  plateSelf: { borderColor: 'rgba(67, 196, 158, 0.45)' },
  plateActive: {
    borderColor: t.focus,
    borderWidth: 2,
    boxShadow: `0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 14px ${t.focusGlow}`,
  },
  plateWinner: {
    borderColor: t.focus,
    borderWidth: 2,
    boxShadow: `0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 20px 4px ${t.focusGlow}`,
  },
  plateDimmed: { opacity: 0.5 },
  // Le jeton est dessiné par `ChipArt` ; la vue porte l'anneau d'état et l'ombre.
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: t.brass.deep,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
  },
  avatarFocus: {
    boxShadow: `0 0 10px 1px ${t.focusGlow}, 0 1px 3px rgba(0, 0, 0, 0.6)`,
  },
  avatarLetter: {
    color: t.ivory,
    includeFontPadding: false,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  plateName: {
    flex: 1,
    color: '#FFFFFF',
    // Lisible sur la laque comme sur le remplissage or ou bordeaux.
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
    borderColor: t.brass.hairline,
    backgroundColor: 'rgba(6, 12, 10, 0.72)',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
  },
  distanceIcon: { color: t.brass.main, fontWeight: '700' },
  distanceText: { color: t.textSoft, fontWeight: '600' },
  distanceUnknown: { color: t.textFaint },
  // Médaillon rond : couronne de laiton, filet intérieur, reflet en haut.
  softButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: t.brass.main,
    boxShadow: `${t.shadow.plate}, inset 0 0 0 2px rgba(0, 0, 0, 0.55), inset 0 0 0 3px ${t.brass.hairline}, inset 0 2px 3px rgba(255, 240, 200, 0.18)`,
  },
  softDanger: {
    backgroundColor: t.oxblood.main,
    experimental_backgroundImage: t.oxblood.surface,
  },
  softTeal: {
    backgroundColor: t.lacquer.solid,
    experimental_backgroundImage: t.lacquer.surface,
  },
  softPressed: { opacity: 0.85, transform: [{ scale: 0.94 }] },
  // La flèche de lucide pointe vers la droite : retournée, elle sort vers la gauche.
  exitGlyph: { transform: [{ scaleX: -1 }] },
  // Plaque de solde : laque encadrée de laiton, double filet comme les plaques de la table.
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: t.brass.line,
    backgroundColor: t.lacquer.fill,
    experimental_backgroundImage: t.lacquer.surface,
    boxShadow: `${t.shadow.plate}, inset 0 0 0 2px rgba(0, 0, 0, 0.5), inset 0 0 0 3px ${t.brass.faint}`,
  },
});
