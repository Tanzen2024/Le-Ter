import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { tablePalette } from '../../components/table/TableDecor';
import type { GameType } from '../../types/session';

/**
 * Emblèmes de l'accueil, la SEULE source de l'identité graphique des jeux et des tournois :
 * - Fap-Fap : éventail de 5 dos de cartes cuivrés (les 5 plis) et médaillon aux 5 points ;
 * - Garam Tia : 3 cartes FACE visible en escalier (la main de 3 : 3, As de pique, 7) et jeton « 21 » ;
 * - Tournois : trophée doré entre un dos cuivré « L » (Fap-Fap) et un 3 de cœur (Garam Tia).
 * Dessins vectoriels permanents (aucune donnée de partie, de joueur ni de tournoi), dans un
 * carré de 100 × 100 : nets à toute taille. Purement graphiques : aucun nom de jeu en texte.
 */

const COPPER = '#A4521E';
const COPPER_DEEP = '#7A3A12';
const IVORY = tablePalette.cream;
const RED = '#C8312B';
/** Encre des enseignes noires (pique). */
const INK = '#1B1B1B';
const GOLD = tablePalette.gold;
const GOLD_DEEP = tablePalette.goldDeep;
const BRONZE = '#8A5A10';
const FELT = '#0A2114';

/** `size` absent : l'emblème remplit son conteneur (carré centré). */
type EmblemSize = { size?: number };

function Emblem({ size, children }: EmblemSize & { children: ReactNode }) {
  const side = size ?? '100%';
  return (
    <Svg width={side} height={side} viewBox="0 0 100 100">
      {children}
    </Svg>
  );
}

/**
 * Dos de carte cuivré, cadre doré (rappel des cartes L de la table), lettre facultative en haut
 * (éventail) ou au centre (`centered`, carte seule).
 */
function CardBack({
  x,
  y,
  w,
  h,
  letter,
  centered,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  letter?: string;
  centered?: boolean;
}) {
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={3} fill={COPPER} stroke={GOLD} strokeWidth={1.6} />
      <Rect
        x={x + 3}
        y={y + 3}
        width={w - 6}
        height={h - 6}
        rx={1.8}
        fill="none"
        stroke={GOLD_DEEP}
        strokeWidth={0.9}
      />
      {letter && centered ? (
        <SvgText
          testID={`card-back-letter-${letter}`}
          x={x + w / 2}
          y={y + h / 2 + 4.5}
          fontSize={13}
          fontWeight="900"
          textAnchor="middle"
          fill={GOLD}
        >
          {letter}
        </SvgText>
      ) : letter ? (
        // Légèrement à gauche du centre : la carte suivante de l'éventail recouvre le bord droit.
        <SvgText
          x={x + w / 2 - 2}
          y={y + 13}
          fontSize={9}
          fontWeight="900"
          textAnchor="middle"
          fill={GOLD}
        >
          {letter}
        </SvgText>
      ) : null}
    </G>
  );
}

/** Losange rouge (enseigne de carte) centré sur (cx, cy). */
function Pip({ cx, cy, r, testID }: { cx: number; cy: number; r: number; testID?: string }) {
  return (
    <Polygon
      testID={testID}
      points={`${cx},${cy - r} ${cx + r * 0.7},${cy} ${cx},${cy + r} ${cx - r * 0.7},${cy}`}
      fill={RED}
    />
  );
}

/**
 * Pique noir (enseigne de carte) centré sur (cx, cy), dans un carré de côté 2r : pointe en
 * haut, deux lobes arrondis, pied évasé. Un seul tracé symétrique, comme sur une vraie carte.
 */
function SpadePip({ cx, cy, r, testID }: { cx: number; cy: number; r: number; testID?: string }) {
  const p = (dx: number, dy: number) => `${cx + r * dx},${cy + r * dy}`;
  const d = [
    `M${p(0, -1)}`,
    // Flanc droit : de la pointe au lobe droit, puis retour vers le pied.
    `C${p(0.18, -0.72)} ${p(0.92, -0.32)} ${p(0.92, 0.18)}`,
    `C${p(0.92, 0.52)} ${p(0.66, 0.7)} ${p(0.4, 0.7)}`,
    `C${p(0.22, 0.7)} ${p(0.09, 0.62)} ${p(0.04, 0.5)}`,
    // Pied évasé.
    `Q${p(0.08, 0.88)} ${p(0.32, 1)}`,
    `L${p(-0.32, 1)}`,
    `Q${p(-0.08, 0.88)} ${p(-0.04, 0.5)}`,
    // Flanc gauche, symétrique.
    `C${p(-0.09, 0.62)} ${p(-0.22, 0.7)} ${p(-0.4, 0.7)}`,
    `C${p(-0.66, 0.7)} ${p(-0.92, 0.52)} ${p(-0.92, 0.18)}`,
    `C${p(-0.92, -0.32)} ${p(-0.18, -0.72)} ${p(0, -1)}`,
    'Z',
  ].join(' ');
  return <Path testID={testID ?? 'spade-pip'} d={d} fill={INK} />;
}

/**
 * Cœur rouge (enseigne de carte) centré sur (cx, cy), dans un carré de côté 2r : deux lobes
 * arrondis en haut, pointe en bas. Un seul tracé symétrique.
 */
function HeartPip({ cx, cy, r, testID }: { cx: number; cy: number; r: number; testID?: string }) {
  const p = (dx: number, dy: number) => `${cx + r * dx},${cy + r * dy}`;
  const d = [
    `M${p(0, -0.55)}`,
    `C${p(-0.15, -0.95)} ${p(-1, -1)} ${p(-1, -0.35)}`,
    `C${p(-1, 0.15)} ${p(-0.4, 0.55)} ${p(0, 1)}`,
    `C${p(0.4, 0.55)} ${p(1, 0.15)} ${p(1, -0.35)}`,
    `C${p(1, -1)} ${p(0.15, -0.95)} ${p(0, -0.55)}`,
    'Z',
  ].join(' ');
  return <Path testID={testID} d={d} fill={RED} />;
}

/** Enseigne d'une carte : carreau rouge (par défaut), cœur rouge ou pique noir. */
type Suit = 'diamond' | 'heart' | 'spade';

const SUIT_MARKS = { diamond: Pip, heart: HeartPip, spade: SpadePip };

/**
 * Carte ivoire face visible, liseré rouge, enseignes en coins. `value` : valeur écrite dans le
 * coin haut gauche (seul coin visible quand les cartes se chevauchent), l'enseigne dessous.
 */
function CardFace({
  x,
  y,
  w,
  h,
  center,
  value,
  suit = 'diamond',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  center?: boolean;
  value?: string;
  suit?: Suit;
}) {
  const Mark = SUIT_MARKS[suit];
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={3.5} fill={IVORY} stroke={RED} strokeWidth={1.6} />
      {value ? (
        <SvgText
          testID={`card-value-${value}`}
          x={x + 6}
          y={y + 11}
          fontSize={11}
          fontWeight="900"
          textAnchor="middle"
          fill={suit === 'spade' ? INK : RED}
        >
          {value}
        </SvgText>
      ) : null}
      <Mark cx={x + 6} cy={value ? y + 17 : y + 8} r={value ? 2.8 : 3.2} />
      <Mark cx={x + w - 6} cy={y + h - 8} r={3.2} />
      {center ? (
        // Enseigne centrale : même place pour toutes les cartes ; le cœur, plus large que le
        // carreau, est réduit pour ne pas toucher l'enseigne du coin haut gauche.
        <Mark testID={`${suit}-pip-center`} cx={x + w / 2} cy={y + h / 2} r={suit === 'heart' ? 6 : 8} />
      ) : null}
    </G>
  );
}

/** Lettres des 5 dos de l'éventail Fap-Fap, de gauche à droite. */
const FAP_FAP_LETTERS = ['L', 'A', 'M', 'A', 'T'];

/**
 * Fap-Fap : 5 cartes en éventail autour d'un même pivot (lettres L, A, M, A, T), médaillon
 * « 5 points » au pied.
 */
function FapFapEmblem({ size }: EmblemSize) {
  return (
    <Emblem size={size}>
      {[-40, -20, 0, 20, 40].map((angle, index) => (
        <G key={angle} transform={`rotate(${angle} 50 88)`}>
          <CardBack x={38} y={22} w={24} h={36} letter={FAP_FAP_LETTERS[index]} />
        </G>
      ))}
      <Circle cx={50} cy={68} r={13} fill={FELT} stroke={GOLD} strokeWidth={2.2} />
      {[
        [45, 63],
        [55, 63],
        [50, 68],
        [45, 73],
        [55, 73],
      ].map(([cx, cy]) => (
        <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2} fill={GOLD} />
      ))}
    </Emblem>
  );
}

/**
 * Garam Tia : 3 cartes face visible en escalier (donne de 3), de gauche à droite 3 de carreau,
 * As de pique et 7 de carreau, et jeton doré « 21 ». Le 3 et le 7 sont dessinés à l'identique
 * (valeur, carreaux de coin et grand carreau central) ; l'As porte un grand pique central,
 * visible entre le 3 et le 7.
 */
function GaramEmblem({ size }: EmblemSize) {
  return (
    <Emblem size={size}>
      <G transform="rotate(-8 50 50)">
        <CardFace x={6} y={32} w={30} h={44} value="3" center />
        <CardFace x={30} y={22} w={30} h={44} value="A" suit="spade" center />
        <CardFace x={54} y={12} w={30} h={44} value="7" center />
      </G>
      <Circle cx={75} cy={74} r={16} fill={GOLD} stroke={BRONZE} strokeWidth={2} />
      <Circle cx={75} cy={74} r={12} fill="none" stroke={FELT} strokeWidth={1} />
      <SvgText
        x={75}
        y={79}
        fontSize={14}
        fontWeight="900"
        textAnchor="middle"
        fill={tablePalette.backdrop}
      >
        21
      </SvgText>
    </Emblem>
  );
}

/**
 * Tournois : trophée au centre, une carte de chaque jeu derrière lui : dos cuivré « L »
 * (Fap-Fap) et 3 de cœur (Garam Tia, dessiné comme les cartes de son emblème, à l'échelle).
 * Les cartes passent devant les anses pour que la lettre et la valeur restent lisibles.
 */
export function TournamentEmblem({ size }: EmblemSize) {
  return (
    <View testID="tournament-emblem" style={size ? undefined : styles.fill}>
      <Emblem size={size}>
        <Path d="M31 22 C17 22 17 42 34 44" fill="none" stroke={GOLD} strokeWidth={3.5} />
        <Path d="M69 22 C83 22 83 42 66 44" fill="none" stroke={GOLD} strokeWidth={3.5} />
        <G transform="rotate(-22 22 50)">
          <CardBack x={10} y={32} w={24} h={36} letter="L" centered />
        </G>
        <G transform="rotate(22 78 50)">
          {/* Carte Garam Tia (30 × 44) réduite à 24 × 35,2. */}
          <G transform="translate(66 32) scale(0.8)">
            <CardFace x={0} y={0} w={30} h={44} value="3" suit="heart" center />
          </G>
        </G>
        <Path
          d="M30 18 H70 V30 C70 46 60 56 50 56 C40 56 30 46 30 30 Z"
          fill={GOLD}
          stroke={BRONZE}
          strokeWidth={1.5}
        />
        <Path d="M37 23 C37 36 41 44 46 48" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
        <Polygon
          points="50,28 51.5,31.9 55.7,32.2 52.5,34.8 53.5,38.9 50,36.6 46.5,38.9 47.5,34.8 44.3,32.2 48.5,31.9"
          fill={BRONZE}
        />
        <Rect x={46} y={55} width={8} height={12} fill={GOLD_DEEP} />
        <Rect x={36} y={66} width={28} height={6} rx={1.5} fill={GOLD} stroke={BRONZE} strokeWidth={1.2} />
        <Rect x={32} y={72} width={36} height={8} rx={2} fill={GOLD_DEEP} stroke={BRONZE} strokeWidth={1.2} />
        <Circle cx={16} cy={16} r={1.8} fill={GOLD} />
        <Circle cx={86} cy={13} r={1.5} fill={GOLD} />
        <Circle cx={88} cy={84} r={1.2} fill={COPPER_DEEP} />
      </Emblem>
    </View>
  );
}

/** Emblème d'un jeu (Fap-Fap ou Garam Tia) ; `size` absent : remplit son conteneur. */
export function GameIdentityIcon({ gameType, size }: { gameType: GameType; size?: number }) {
  return (
    <View testID={`game-identity-${gameType}`} style={size ? undefined : styles.fill}>
      {gameType === 'TER' ? <FapFapEmblem size={size} /> : <GaramEmblem size={size} />}
    </View>
  );
}

/** Jeux reconnus : toute autre valeur (absente, inconnue) n'affiche rien. */
const isKnownGame = (value: unknown): value is GameType => value === 'TER' || value === 'GARAM';

/**
 * Repère du jeu d'un tournoi dans le panneau Tournois de l'accueil : UNE flèche et UN
 * emblème (celui du panneau du jeu), tournés vers ce panneau (Fap-Fap à gauche, Garam Tia à
 * droite).
 * - TER (Fap-Fap) : ← [emblème Fap-Fap] ;
 * - GARAM (Garam Tia) : [emblème Garam Tia] →.
 * Décidé par le seul `gameType` du tournoi (D-124), jamais par son nom ; sans jeu reconnu,
 * rien. Décoratif pour les lecteurs d'écran : le jeu est dit dans le libellé du résumé.
 */
export function TournamentGameMarker({
  gameType,
  size,
}: {
  gameType: GameType | undefined;
  /** Taille de référence (texte du résumé) : le repère suit son ajustement. */
  size: number;
}) {
  if (!isKnownGame(gameType)) return null;
  const left = gameType === 'TER';
  const arrow = (
    <Text
      testID={left ? 'tournament-game-arrow-left' : 'tournament-game-arrow-right'}
      allowFontScaling={false}
      style={[styles.arrow, { fontSize: Math.round(size * 1.15) }]}
    >
      {left ? '←' : '→'}
    </Text>
  );
  const pad = Math.max(2, Math.round(size * 0.15));
  return (
    <View
      testID={`tournament-game-${gameType}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.marker, { gap: Math.max(2, Math.round(size * 0.25)) }]}
    >
      {left ? arrow : null}
      <View
        testID="tournament-game-identity"
        style={[styles.highlight, { padding: pad, borderRadius: size }]}
      >
        <GameIdentityIcon gameType={gameType} size={Math.round(size * 2.2)} />
      </View>
      {left ? null : arrow}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  marker: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  arrow: { color: tablePalette.gold, fontWeight: '900', includeFontPadding: false },
  // Emblème mis en évidence : liseré et halo dorés, comme les éléments actifs de l'accueil.
  highlight: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: tablePalette.gold,
    backgroundColor: 'rgba(242, 196, 81, 0.16)',
    boxShadow: '0 0 8px rgba(242, 196, 81, 0.55)',
  },
});
