import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import {
  fontOf,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { playSound } from '../../../services/audio-service';
import type { GameView } from '../../../types/game';
import { INSTANT_WIN_LABELS, playerLabel } from '../format';
import type { GameTableLayout } from './table-layout';
import {
  dialVisibleFor,
  remainingFraction,
  useRemainingMs,
  useTurnPhase,
} from './turn-phase';
import { TURN_SIGNAL_MS, useReducedMotion } from './turn-signal';

/**
 * Indicateurs de tour de la table (bas gauche) et actions ponctuelles (bas droit), placés
 * comme sur la table de référence. Aucun minuteur métier ici : le chrono lit l'échéance du
 * tour FIXÉE PAR LE SERVEUR (D-034) et les boutons n'existent que si le serveur les autorise.
 */

/**
 * Chrono circulaire de la référence : grand disque turquoise, cerclage doré net et arc de
 * progression continu (aucun point ni segment), chiffre blanc centré. `fraction` : part du
 * tour restante, de 0 à 1, lue sur l'échéance du serveur.
 */
export function TimerDial({
  size,
  fraction,
  urgent,
}: {
  size: number;
  fraction: number;
  urgent: boolean;
}) {
  const stroke = Math.max(3, size * 0.085);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const lit = Math.min(1, Math.max(0, fraction));
  return (
    <Svg
      testID="timer-dial"
      width={size}
      height={size}
      style={[StyleSheet.absoluteFill, styles.passThrough]}
    >
      <Defs>
        <RadialGradient id="timerDisc" cx="50%" cy="38%" r="62%">
          <Stop offset="0" stopColor="#3FC7BE" />
          <Stop offset="0.6" stopColor="#1A9A94" />
          <Stop offset="1" stopColor="#0E6F6C" />
        </RadialGradient>
      </Defs>
      {/* Disque turquoise. */}
      <Circle cx={size / 2} cy={size / 2} r={radius} fill="url(#timerDisc)" />
      {/* Cerclage doré sombre (temps écoulé), puis arc doré vif (temps restant). */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#8A6414"
        strokeWidth={stroke}
      />
      <Circle
        testID="timer-arc"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={urgent ? '#F0524F' : '#F5C842'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * lit} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Fin liseré clair intérieur pour la netteté du cerclage. */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius - stroke / 2 - 0.75}
        fill="none"
        stroke="rgba(255, 244, 200, 0.55)"
        strokeWidth={1.2}
      />
    </Svg>
  );
}

/** Texte du bandeau de tour, uniquement à partir de l'état synchronisé. */
export function turnMessage(
  game: GameView,
  { dealing, lastTrick }: { dealing: boolean; lastTrick: boolean },
): string | null {
  if (lastTrick) return '5ᵉ tour : cartes jouées automatiquement';
  if (game.status !== 'in_progress' || !game.play) return null;
  if (dealing) return 'Distribution des cartes…';
  if (game.turnTimedOutAt) return 'Temps écoulé : coup automatique';
  const active = game.activePlayerId ?? game.play.nextPlayerId;
  if (!active) return null;
  return active === game.viewerId ? "C'est ton tour !" : `Tour de ${playerLabel(game, active)}`;
}

/** Fondu d'apparition et de disparition du chrono entre deux phases de jeu. */
export const DIAL_FADE_MS = 220;

/**
 * Bas gauche : chrono circulaire du joueur attendu (secondes AFFICHÉES : 10 s, D-098),
 * « Tour n/5 » dessous (en entier, jamais tronqué) et bandeau « C'est ton tour ! » / « Tour de <pseudo> ».
 */
export function TurnHud({
  game,
  receivedAt,
  layout,
  dealing,
  presenting,
  turnHeld = false,
  safeLeft,
  safeBottom,
}: {
  game: GameView;
  receivedAt: number;
  layout: GameTableLayout;
  dealing: boolean;
  presenting: boolean;
  /**
   * Chrono suspendu : ma carte vient d'être lâchée (arrêt immédiat), ou les cartes du tour
   * précédent ne sont pas encore rangées dans leurs zones (voir PlayArea).
   */
  turnHeld?: boolean;
  safeLeft: number;
  safeBottom: number;
}) {
  const fonts = useTableFonts();
  // Même tour que les barres des joueurs et l'anneau central (turn-phase.ts).
  const phase = useTurnPhase(game, receivedAt, dealing || turnHeld);
  const remainingMs = useRemainingMs(phase && !phase.timedOut ? phase : null);
  // Chrono et roulette : uniquement chez le joueur attendu (D-099) ; les autres voient sa barre.
  const showDial = dialVisibleFor(phase, game.viewerId);
  const [dialOpacity] = useState(() => new Animated.Value(showDial ? 1 : 0));
  useEffect(() => {
    const animation = Animated.timing(dialOpacity, {
      toValue: showDial ? 1 : 0,
      duration: DIAL_FADE_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [dialOpacity, showDial]);
  // 5e tour : joué par le système, aucun compte à rebours (D-041).
  const lastTrick = game.status === 'finished' && presenting;
  if ((game.status !== 'in_progress' && !lastTrick) || !game.play) return null;

  const { ring, columnWidth, labelHeight, labelFontSize, message } = layout.hud;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const fraction =
    phase && remainingMs !== null
      ? remainingFraction(phase, phase.localDeadline - remainingMs)
      : lastTrick || dealing
        ? 1
        : 0;
  const urgent = seconds !== null && seconds <= 3;
  const text = turnMessage(game, { dealing, lastTrick });
  const trick = lastTrick ? 5 : game.play.trickNumber;

  return (
    <>
      <View
        style={[
          styles.absolute,
          styles.passThrough,
          styles.column,
          {
            left: safeLeft,
            bottom: safeBottom,
            width: columnWidth,
            gap: layout.gap * 0.5,
          },
        ]}
      >
        <Animated.View
          accessible={showDial}
          testID="turn-timer"
          accessibilityElementsHidden={!showDial}
          importantForAccessibility={showDial ? 'auto' : 'no-hide-descendants'}
          accessibilityLabel={
            seconds === null ? 'Chrono du tour' : `${seconds} seconde${seconds > 1 ? 's' : ''}`
          }
          style={[
            styles.ring,
            { width: ring, height: ring, borderRadius: ring / 2, opacity: dialOpacity },
          ]}
        >
          <TimerDial size={ring} fraction={fraction} urgent={urgent} />
          <Text
            allowFontScaling={false}
            style={[styles.ringText, fontOf(fonts.button), { fontSize: ring * 0.46 }]}
          >
            {seconds ?? '–'}
          </Text>
        </Animated.View>
        {/* Toute la largeur de la colonne, dimensionnée pour « Tour 5/5 » ; si une police
            plus large que prévu dépasse, le texte rétrécit au lieu d'être coupé. */}
        <View
          testID="turn-counter"
          style={[
            styles.label,
            {
              width: columnWidth,
              height: labelHeight,
              paddingHorizontal: labelHeight * 0.4,
            },
          ]}
        >
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.labelText, fontOf(fonts.button), { fontSize: labelFontSize }]}
          >
            Tour {trick}/5
          </Text>
        </View>
      </View>
      {text ? (
        <View
          style={[
            styles.absolute,
            styles.passThrough,
            styles.message,
            {
              left: message.left,
              bottom: message.bottom,
              width: message.width,
              minHeight: message.height,
            },
          ]}
        >
          <Text
            testID="turn-message"
            accessibilityLiveRegion="polite"
            numberOfLines={2}
            style={[styles.messageText, fontOf(fonts.button), { fontSize: message.height * 0.36 }]}
          >
            {text}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * Images clés du halo du joueur actif sur ses 5 s (`TURN_SIGNAL_MS`), en fraction de la
 * durée : allumage franc, pulsations sans jamais s'éteindre, extinction dans les derniers
 * instants. Le composant est retiré par `useTurnSignal` à 5 s pile.
 */
export const TURN_GLOW_KEYFRAMES = {
  at: [0, 0.04, 0.2, 0.36, 0.52, 0.68, 0.84, 0.95, 1],
  opacity: [0, 1, 0.78, 1, 0.78, 1, 0.82, 0.7, 0],
  scale: [0.96, 1.04, 1, 1.04, 1, 1.04, 1, 1, 1],
} as const;

/** Marge de la lueur autour de la zone du joueur, selon sa hauteur. */
export function turnGlowSpread(zoneHeight: number): number {
  return Math.round(Math.min(18, Math.max(10, zoneHeight * 0.18)));
}

/**
 * Halo lumineux du joueur qui devient actif, posé autour de sa zone (cartes en main, et barre
 * pour un adversaire) : lueur dorée large et diffuse, anneau plein (visible même sans rendu
 * des ombres) et contour or vif. Monté une fois par tour (clé = tour), retiré par
 * `useTurnSignal` après 5 s ; avec « réduire les animations », halo fixe sans mouvement.
 * Ne capte aucun geste.
 */
export function TurnGlow({
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
      duration: TURN_SIGNAL_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  const k = TURN_GLOW_KEYFRAMES;
  const track = (values: readonly number[], still: number) =>
    reduced ? still : progress.interpolate({ inputRange: [...k.at], outputRange: [...values] });
  const spread = turnGlowSpread(rect.height);
  return (
    <Animated.View
      testID="turn-glow"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.absolute,
        styles.passThrough,
        {
          left: rect.left - spread,
          top: rect.top - spread,
          width: rect.width + spread * 2,
          height: rect.height + spread * 2,
          opacity: track(k.opacity, 1),
          transform: [{ scale: track(k.scale, 1) }],
        },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, styles.glowBloom, { borderRadius: spread + 10 }]} />
      <View
        style={[
          styles.glowRing,
          {
            left: spread * 0.5,
            top: spread * 0.5,
            right: spread * 0.5,
            bottom: spread * 0.5,
            borderRadius: spread * 0.5 + 10,
          },
        ]}
      />
      <View
        testID="turn-glow-rim"
        style={[
          styles.glowRim,
          {
            left: spread - 4,
            top: spread - 4,
            right: spread - 4,
            bottom: spread - 4,
            borderRadius: 12,
          },
        ]}
      />
    </Animated.View>
  );
}

/**
 * Badges « Main spéciale » / « Se coucher » relevés sur la capture de référence, dessinés en
 * SVG dans un repère de 100 × 117 (largeur × hauteur) : disque en haut, plaque basse arrondie
 * pleine largeur qui porte le libellé, aplat de couleur bordé d'un fin trait plus sombre,
 * pictogrammes jaunes (cartes pleines, mains au trait).
 */
const BADGE_W = 100;
const BADGE_H = 117;
/** Plaque du libellé, dans le repère du badge. */
const BADGE_PLATE = { top: 85, height: 32 };

/** Jaune des cartes et des traits ; jaune clair du libellé. */
const ICON_YELLOW = '#E8BD2A';
const LABEL_YELLOW = '#F7DA6E';

const ACTION_TONES = {
  teal: { edge: '#0B4F41', top: '#16806A', bottom: '#0F6D57', ray: 'rgba(150, 235, 205, 0.28)' },
  red: { edge: '#86141F', top: '#CC2236', bottom: '#B5182B', ray: 'rgba(255, 190, 170, 0.18)' },
} as const;

/**
 * Bouton inactif (non autorisé ou envoi en cours) : mêmes formes, teintes désaturées mais
 * OPAQUES. Jamais d'opacité ni de filtre sur le bouton : sur Android ils le rendent flou et
 * translucide couche par couche.
 */
const MUTED_TONES = {
  teal: { edge: '#2E3F3B', top: '#55706A', bottom: '#46605A', ray: 'rgba(200, 220, 215, 0.12)' },
  red: { edge: '#45302F', top: '#7C5B5D', bottom: '#6A4B4E', ray: 'rgba(230, 210, 205, 0.1)' },
} as const;

/**
 * Silhouette du badge, rétrécie de `inset` : disque, raccord (adoucit la taille entre le disque
 * et la plaque) et plaque basse, peints de la même couleur.
 */
function BadgeShape({ inset, fill, dy = 0 }: { inset: number; fill: string; dy?: number }) {
  return (
    <G transform={dy ? `translate(0 ${dy})` : undefined}>
      <Circle cx={50} cy={50} r={50 - inset} fill={fill} />
      <Rect x={11 + inset} y={70} width={78 - inset * 2} height={20} fill={fill} />
      <Rect
        x={1 + inset}
        y={BADGE_PLATE.top + inset}
        width={98 - inset * 2}
        height={BADGE_PLATE.height - inset * 2}
        rx={13 - inset}
        fill={fill}
      />
    </G>
  );
}

/** Pictogramme « Main spéciale » : carte jaune marquée S, rayons clairs, main au trait. */
function SpecialHandArt() {
  const ink = ACTION_TONES.teal.bottom;
  const rays = [-150, -115, -80, -45, -10, 160, 195];
  return (
    <G>
      {rays.map((angle) => (
        <Path
          key={angle}
          d="M0 0 L46 -5 L46 5 Z"
          fill={ACTION_TONES.teal.ray}
          transform={`translate(49 38) rotate(${angle})`}
        />
      ))}
      <G transform="rotate(-5 49 37)">
        <Rect x="25" y="8" width="48" height="57" rx="4.5" fill={ICON_YELLOW} />
        <SvgText x="50" y="45" fontSize="28" fontWeight="900" fill={ink} textAnchor="middle">
          S
        </SvgText>
      </G>
      {/* Doigts repliés sur le bord droit de la carte. */}
      {[35, 46, 57].map((y, i) => (
        <Rect
          key={y}
          x={66 + (i === 1 ? 1 : 0)}
          y={y}
          width={i === 2 ? 15 : 17}
          height="11"
          rx="5.5"
          fill={ink}
          stroke={ICON_YELLOW}
          strokeWidth="3.4"
        />
      ))}
      {/* Pouce en travers de la carte, paume en arc jusqu'au poignet en bas à gauche. */}
      <Path
        d="M24 59 L57 57 C63 56.5 63.5 64.5 57.5 65 L48 66 L72 66.5 C77 67 77 74 71.5 74.5 C60 76 48 80 34 81 C27 81.5 22 80 20 76 L18 64 C17.5 61 20 59 24 59 Z"
        fill={ink}
        stroke={ICON_YELLOW}
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
    </G>
  );
}

/** Pictogramme « Se coucher » : deux cartes jaunes inclinées, main ouverte au trait posée dessus. */
function FoldArt() {
  const ink = ACTION_TONES.red.bottom;
  return (
    <G>
      <G transform="rotate(-9 44 32)">
        <Rect x="17" y="11" width="45" height="48" rx="4" fill={ICON_YELLOW} stroke={ink} strokeWidth="1.6" />
        <Rect x="22" y="7" width="45" height="48" rx="4" fill={ICON_YELLOW} stroke={ink} strokeWidth="1.6" />
      </G>
      {/* Main ouverte, quatre longs doigts séparés vers le haut à droite, pouce à gauche. */}
      <G transform="translate(54 50) rotate(35) scale(1.7) translate(-14 -21)">
        <Path
          d="M4 26 L4 9.3 C4 6.3 8.6 6.3 8.6 9.3 L8.6 21 L10.4 21 L10.4 5.3 C10.4 2.3 15 2.3 15 5.3 L15 21 L16.8 21 L16.8 7.3 C16.8 4.3 21.4 4.3 21.4 7.3 L21.4 22 L23.2 22 L23.2 12 C23.2 9.4 27.4 9.4 27.4 12 L27.4 29 C27.4 36 22.5 40 16 40 C11 40 7.5 38 5.5 35 L0.6 27.5 C-0.9 25 2.2 22.6 4 25 Z"
          fill={ink}
          stroke={ICON_YELLOW}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </G>
    </G>
  );
}

/** Badge complet : ombre portée, fin bord sombre, aplat légèrement dégradé, pictogramme. */
function ActionBadge({
  width,
  tone,
  muted = false,
  children,
}: {
  width: number;
  tone: 'teal' | 'red';
  /** Bouton inactif : teintes ternes opaques (voir `MUTED_TONES`). */
  muted?: boolean;
  children: ReactNode;
}) {
  const c = muted ? MUTED_TONES[tone] : ACTION_TONES[tone];
  const gradientId = `actionFill-${tone}${muted ? '-muted' : ''}`;
  const clipId = `actionClip-${tone}${muted ? '-muted' : ''}`;
  return (
    <Svg
      width={width}
      height={(width * BADGE_H) / BADGE_W}
      viewBox={`0 0 ${BADGE_W} ${BADGE_H + 3}`}
      style={styles.passThrough}
    >
      <Defs>
        <LinearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="0"
          y2={BADGE_H}
        >
          <Stop offset="0" stopColor={c.top} />
          <Stop offset="1" stopColor={c.bottom} />
        </LinearGradient>
        <ClipPath id={clipId}>
          <Circle cx={50} cy={50} r={47.5} />
        </ClipPath>
      </Defs>
      <BadgeShape inset={0} fill="rgba(0, 0, 0, 0.4)" dy={3} />
      <BadgeShape inset={0} fill={c.edge} />
      <BadgeShape inset={1.6} fill={`url(#${gradientId})`} />
      <G clipPath={`url(#${clipId})`}>{children}</G>
    </Svg>
  );
}

/**
 * Bouton de la référence : badge coloré, pictogramme jaune et libellé jaune clair sur la
 * plaque basse. La zone tactile reste le carré `size` × `size` ; le badge y est centré.
 */
function RoundActionButton({
  label,
  accessibilityLabel,
  tone,
  size,
  pending,
  allowed,
  onPress,
  children,
}: {
  label: string;
  accessibilityLabel: string;
  tone: 'teal' | 'red';
  size: number;
  pending: boolean;
  /** Autorisé par le serveur maintenant ; sinon le bouton reste visible mais inactif. */
  allowed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const fonts = useTableFonts();
  const inactive = pending || !allowed;
  const badgeWidth = (size * BADGE_W) / (BADGE_H + 3);
  const unit = size / (BADGE_H + 3);
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive, busy: pending }}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
    >
      <ActionBadge width={badgeWidth} tone={tone} muted={inactive}>
        {children}
      </ActionBadge>
      <View
        style={[
          styles.roundLabel,
          {
            top: BADGE_PLATE.top * unit,
            height: BADGE_PLATE.height * unit,
            width: badgeWidth * 0.92,
          },
        ]}
      >
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[
            styles.roundText,
            inactive && styles.roundTextMuted,
            fontOf(fonts.button),
            { fontSize: Math.max(9, badgeWidth * 0.135) },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** Fenêtre pendant laquelle un second appui sur un bouton d'action est ignoré. */
export const PRESS_LATCH_MS = 800;

/** Message d'un appui sur « Main spéciale » sans main gagnante, et sa durée d'affichage. */
export const SPECIAL_HAND_REFUSED =
  'Pas de main spéciale : tes 5 cartes ne forment aucune combinaison gagnante. Joue normalement.';
export const SPECIAL_HAND_HINT_MS = 4000;

/** Cartes déjà jouées par `playerId` dans la partie (tours terminés et tour en cours). */
export function cardsPlayedBy(game: GameView, playerId: string): number {
  const play = game.play;
  if (!play) return 0;
  const tricks = [...play.completedTricks.map((t) => t.plays), play.currentTrick];
  return tricks.reduce((n, plays) => n + plays.filter((p) => p.playerId === playerId).length, 0);
}

/**
 * Bas droit, côte à côte comme sur la référence : « Main spéciale » (victoire instantanée,
 * DECLARE_WIN) et « Se coucher » (la fuite, commande FLEE). Visibilité (D-085), et dans
 * tous les cas UNIQUEMENT pendant le tour du joueur :
 * - « Main spéciale » : visible tant que le joueur n'a joué AUCUNE carte. Un appui envoie la
 *   déclaration seulement si le serveur a reconnu une main gagnante (`canDeclareInstantWin`) ;
 *   sinon un court message l'explique, sans rien envoyer.
 * - « Se coucher » : visible tant que le joueur n'a pas joué sa DEUXIÈME carte et que
 *   personne n'a fui ; actif si le serveur autorise la fuite (`canFlee` : avant sa deuxième
 *   carte, D-089 ; à 2 joueurs la fuite fait gagner l’adversaire, D-086), sinon terne.
 * Aucun bouton pour un joueur qui a fui ; plus de « Se coucher » chez personne après une fuite. Le serveur revalide chaque commande et décide du
 * résultat ; pendant la requête, les boutons sont inactifs.
 */
export function TurnActions({
  game,
  layout,
  pending,
  onFlee,
  onDeclareWin,
  safeRight,
  safeBottom,
}: {
  game: GameView;
  layout: GameTableLayout;
  pending: boolean;
  onFlee: () => void;
  onDeclareWin: () => void;
  safeRight: number;
  safeBottom: number;
}) {
  const fonts = useTableFonts();
  const { canFlee, canDeclareInstantWin } = game.myActions;
  // Un seul envoi par appui : un double appui plus rapide que la mise à jour de `pending`
  // (même image) n'envoie pas une seconde commande. Objet stable, écrit seulement à l'appui ;
  // après un refus du serveur, un nouvel appui reste possible.
  const [latch] = useState(() => ({ at: 0 }));
  // Message « pas de main spéciale » : affiché quelques secondes, minuteur annulé au
  // démontage ou à un nouvel appui (propre à cet écran de partie).
  // `hint` : numéro de l'appui refusé (0 = aucun message) ; chaque appui relance la durée.
  const [hint, setHint] = useState(0);
  useEffect(() => {
    if (hint === 0) return;
    const timer = setTimeout(() => setHint(0), SPECIAL_HAND_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  const me = game.players.find((p) => p.playerId === game.viewerId);
  // Un seul fuyard par partie (D-035) : dès qu'un joueur a fui, « Se coucher » disparaît chez
  // tous les joueurs.
  const someoneFled = game.players.some((p) => p.fledAt);
  const played = cardsPlayedBy(game, game.viewerId);
  // Les deux boutons ne s'affichent que pendant MON tour (même joueur actif que le bandeau
  // « C'est ton tour ! »), en plus des règles ci-dessus ; le serveur revalide toujours.
  const myTurn =
    game.status === 'in_progress' &&
    (game.activePlayerId ?? game.play?.nextPlayerId) === game.viewerId;
  const showSpecial = myTurn && !me?.fledAt && played === 0;
  const showFold = myTurn && !someoneFled && played < 2;
  if (!showSpecial && !showFold) return null;

  const size = layout.action.size;
  const press = (action: () => void) => () => {
    const now = Date.now();
    if (pending || now - latch.at < PRESS_LATCH_MS) return;
    latch.at = now;
    playSound('uiClick');
    action();
  };
  const special = () => {
    if (canDeclareInstantWin) onDeclareWin();
    else setHint((n) => n + 1);
  };
  return (
    <View
      style={[
        styles.absolute,
        styles.actions,
        {
          right: safeRight,
          bottom: safeBottom,
          gap: layout.action.width - size * 2,
          width: layout.action.width,
        },
      ]}
    >
      {showSpecial && hint > 0 ? (
        <View
          testID="special-hand-hint"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.hint,
            { bottom: size + layout.gap * 0.5, width: layout.action.width * 1.35 },
          ]}
        >
          <Text
            style={[styles.hintText, fontOf(fonts.button), { fontSize: Math.max(11, size * 0.17) }]}
          >
            {SPECIAL_HAND_REFUSED}
          </Text>
        </View>
      ) : null}
      {showSpecial ? (
        <RoundActionButton
          label="Main spéciale"
          accessibilityLabel={
            canDeclareInstantWin
              ? `Main spéciale : gagner instantanément${
                  game.myInstantWin
                    ? ` (${INSTANT_WIN_LABELS[game.myInstantWin.combination]}, rang ${game.myInstantWin.rank})`
                    : ''
                }`
              : 'Main spéciale : déclarer une victoire instantanée'
          }
          tone="teal"
          size={size}
          pending={pending}
          allowed
          onPress={press(special)}
        >
          <SpecialHandArt />
        </RoundActionButton>
      ) : null}
      {showFold ? (
        <RoundActionButton
          label="Se coucher"
          accessibilityLabel={
            canFlee
              ? 'Se coucher : abandonner cette partie'
              : 'Se coucher : indisponible pour le moment'
          }
          tone="red"
          size={size}
          pending={pending}
          allowed={canFlee}
          onPress={press(onFlee)}
        >
          <FoldArt />
        </RoundActionButton>
      ) : null}
    </View>
  );
}

/**
 * Bouton rond « Main spéciale » seul (même badge et même pictogramme que celui de Fap-Fap),
 * pour GARAM TIA (D-129). Le serveur décide toujours si la main est spéciale.
 */
export function SpecialHandButton({
  accessibilityLabel,
  size,
  pending,
  onPress,
}: {
  accessibilityLabel: string;
  size: number;
  pending: boolean;
  onPress: () => void;
}) {
  return (
    <RoundActionButton
      label="Main spéciale"
      accessibilityLabel={accessibilityLabel}
      tone="teal"
      size={size}
      pending={pending}
      allowed
      onPress={onPress}
    >
      <SpecialHandArt />
    </RoundActionButton>
  );
}

/** Durée de la main d'au revoir affichée après « Se coucher », avant le panneau de fin. */
export const FAREWELL_MS = 3000;

/**
 * Main d'au revoir : vraie juste après que le serveur a confirmé MA fuite (passage à
 * « a fui » pendant que l'écran est ouvert), pendant `FAREWELL_MS`, puis fausse. Rien à
 * l'ouverture d'une partie déjà fuie (reconnexion). Minuteur annulé au démontage.
 */
export function useFarewell(game: GameView): boolean {
  const fled = Boolean(game.players.find((p) => p.playerId === game.viewerId)?.fledAt);
  const [seen, setSeen] = useState(fled);
  const [farewell, setFarewell] = useState(false);
  // Mémorisation du rendu précédent (motif React « état dérivé ») : pas d'effet en cascade.
  if (seen !== fled) {
    setSeen(fled);
    if (fled) setFarewell(true);
  }
  useEffect(() => {
    if (!farewell) return;
    const timer = setTimeout(() => setFarewell(false), FAREWELL_MS);
    return () => clearTimeout(timer);
  }, [farewell]);
  return farewell;
}

/**
 * Main d'au revoir (comme sur la référence) : disque rouge cerclé d'or, main jaune ouverte
 * qui salue (balancement), au centre de la table. Décorative : ne capte aucun geste.
 */
export function FarewellHand({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const reduced = useReducedMotion();
  const [wave] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(wave, { toValue: -1, duration: 500, useNativeDriver: true }),
        Animated.timing(wave, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [wave, reduced]);
  const rotate = wave.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });
  return (
    <View
      testID="farewell-hand"
      accessible
      accessibilityLabel="Au revoir : vous vous êtes couché"
      accessibilityLiveRegion="polite"
      style={[
        styles.absolute,
        styles.passThrough,
        { left: cx - size / 2, top: cy - size / 2, width: size, height: size },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={48} fill="#7A1A1F" />
        <Circle cx={50} cy={50} r={45} fill="#C8242C" stroke="#F5C842" strokeWidth={3} />
      </Svg>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.farewellArt, { transform: [{ rotate }] }]}
      >
        <Svg width={size * 0.62} height={size * 0.62} viewBox="-2 0 32 42">
          <Path
            d="M4 26 L4 9.3 C4 6.3 8.6 6.3 8.6 9.3 L8.6 21 L10.4 21 L10.4 5.3 C10.4 2.3 15 2.3 15 5.3 L15 21 L16.8 21 L16.8 7.3 C16.8 4.3 21.4 4.3 21.4 7.3 L21.4 22 L23.2 22 L23.2 12 C23.2 9.4 27.4 9.4 27.4 12 L27.4 29 C27.4 36 22.5 40 16 40 C11 40 7.5 38 5.5 35 L0.6 27.5 C-0.9 25 2.2 22.6 4 25 Z"
            fill={ICON_YELLOW}
            stroke="#7A1A1F"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  passThrough: { pointerEvents: 'none' },
  column: { alignItems: 'center' },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45), 0 0 8px rgba(245, 200, 66, 0.35)',
  },
  ringText: {
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  label: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: 'rgba(6, 30, 14, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  labelText: { color: '#FFFFFF', includeFontPadding: false },
  // Bandeau de la référence : plaque vert très sombre translucide, texte blanc gras à gauche.
  message: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(4, 30, 12, 0.78)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.3)',
  },
  messageText: { color: '#FFFFFF', textAlign: 'left' },
  glowBloom: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 200, 40, 0.22)',
    boxShadow:
      '0 0 16px 6px rgba(255, 214, 64, 0.85), 0 0 36px 16px rgba(255, 170, 0, 0.55), 0 0 60px 24px rgba(255, 150, 0, 0.3)',
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 206, 60, 0.3)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 230, 120, 0.7)',
  },
  glowRim: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#FFD23F',
    boxShadow:
      '0 0 0 1.5px rgba(110, 60, 0, 0.7), 0 0 10px 3px rgba(255, 244, 170, 0.95), 0 0 22px 8px rgba(255, 196, 30, 0.9)',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end' },
  // Le badge (fond, liseré, ombre) est dessiné en SVG par `ActionBadge`.
  round: { alignItems: 'center', justifyContent: 'center' },
  roundLabel: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Libellé jaune clair gras posé directement sur la plaque du badge, comme sur la référence.
  roundText: {
    color: LABEL_YELLOW,
    includeFontPadding: false,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  // Pression : léger enfoncement seulement (aucune opacité, voir `MUTED_TONES`).
  pressed: { transform: [{ scale: 0.96 }] },
  roundTextMuted: { color: '#CFC7A6' },
  // Bulle « pas de main spéciale » au-dessus des boutons : plaque sombre opaque, texte net.
  hint: {
    position: 'absolute',
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#0B2414',
    borderWidth: 1,
    borderColor: '#F5C842',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.4)',
  },
  hintText: { color: '#FFFFFF', textAlign: 'center' },
  farewellArt: { alignItems: 'center', justifyContent: 'center' },
});
