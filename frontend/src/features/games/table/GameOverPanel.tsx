import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from "../../../components/table/TableDecor";
import { gameTheme, motion, salon } from "../../../constants/theme";
import { useMessages } from "../../../lib/i18n";
import type { GameView } from "../../../types/game";
import { useLobbyMetrics } from "../../lobby/lobby-metrics";
import { Coin, PanelButton } from "../../lobby/LobbyUi";
import { ChipStack } from "../../wallet/ShopIllustrations";
import { ReportProblemLink } from "../../complaints/ReportProblemLink";
import { GARAM_TWO_ACES_SCORE } from "../garam/garam-presentation";
import { playerLabel } from "../format";
import { useReducedMotion } from "./turn-signal";

/**
 * Délai affiché avant la sortie automatique, à partir de l'apparition du panneau : 10 s comme
 * tous les délais affichés (D-098), sur les 13 s de la ronde du serveur.
 */
export const EXIT_COUNTDOWN_SECONDS = 10;
const TICK_MS = 250;

/**
 * Compte à rebours de sortie : 10 s à partir de l'apparition du panneau, jamais au-delà de
 * l'échéance du serveur (`capAt`, heure locale), qui reste seul maître des départs
 * automatiques (ronde Poursuivre/Quitter, D-034). Un timer par panneau, donc par partie :
 * arrêté dès qu'il n'est plus actif et au démontage. Renvoie les secondes restantes.
 */
export function useExitCountdown(
  active: boolean,
  capAt: number | undefined,
  onExpire: () => void,
): number {
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(shownAt);
  const deadline = Math.min(
    shownAt + EXIT_COUNTDOWN_SECONDS * 1000,
    capAt ?? Infinity,
  );
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) {
        clearInterval(handle);
        expire.current();
      }
    }, TICK_MS);
    return () => clearInterval(handle);
  }, [active, deadline]);

  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Montant signé tel qu'affiché : « -84 », « +98 », « 0 ». */
export function signedAmount(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `-${Math.abs(delta)}` : "0";
}

type Action = "quit" | "replay";

/**
 * Panneau de fin de partie, posé au centre de la table (fidèle aux captures de référence) :
 * titre (« Vous avez gagné ! » avec la pile de jetons, ou « <pseudo> a gagné la partie. »),
 * bilan du joueur (montant réglé par le serveur, D-074, jamais recalculé ici), puis
 * Quitter / Rejouer et le compte à rebours de sortie automatique.
 *
 * « Rejouer » n'est présent que si le SERVEUR l'autorise (`canContinue`, solde disponible
 * ≥ 2 × mise, D-073) ; refusé ou non vérifié, seul « Quitter » reste, avec une explication.
 *
 * Une seule action par panneau : Quitter, Rejouer ou la fin du compte à rebours ; la
 * première arrête le compte à rebours et bloque les autres. Si le serveur la refuse, le
 * panneau redevient actif (le message d'erreur s'affiche).
 */
export function GameOverPanel({
  game,
  width,
  fit,
  awaitingMe,
  canContinue,
  capAt,
  pending,
  error,
  footer,
  onQuit,
  onReplay,
}: {
  game: GameView;
  width: number;
  /**
   * Place disponible : hauteur maximale et réduction déjà imposée par la largeur. Le panneau
   * est réduit (jamais agrandi) pour y tenir en entier, pile de jetons comprise.
   */
  fit?: { height: number; scale: number };
  /** Ma réponse Quitter/Rejouer est attendue ; `undefined` tant que la table n'est pas lue. */
  awaitingMe: boolean | undefined;
  /** « Poursuivre » permis par le serveur ; `undefined` : non vérifié (jamais proposé). */
  canContinue: boolean | undefined;
  /** Échéance de la ronde côté serveur, en heure locale (ms). */
  capAt?: number;
  pending: boolean;
  error?: string;
  /** Remplace boutons et compte à rebours quand le serveur n'attend plus ma réponse. */
  footer?: ReactNode;
  /** Résout `true` si la sortie a abouti ; `automatic` : fin du compte à rebours. */
  onQuit: (automatic: boolean) => Promise<boolean>;
  onReplay: () => Promise<boolean>;
}) {
  const m = useLobbyMetrics();
  const fonts = useTableFonts();
  const t = useMessages().gameOver;
  const entrance = usePanelEntrance();
  const [action, setAction] = useState<Action | null>(null);
  const acted = useRef(false);
  const [measured, setMeasured] = useState(0);

  const run = (kind: Action, task: () => Promise<boolean>) => {
    if (acted.current) return;
    acted.current = true;
    setAction(kind);
    void task().then((ok) => {
      if (!ok) {
        acted.current = false;
        setAction(null);
      }
    });
  };
  const counting = action === null && awaitingMe !== false && !footer;
  const seconds = useExitCountdown(counting, capAt, () =>
    run("quit", () => onQuit(true)),
  );

  const result = game.result;
  const winnerName = result ? playerLabel(game, result.winnerId) : undefined;
  const iWon = result?.winnerId === game.viewerId;
  const iFled = game.players.some(
    (p) => p.playerId === game.viewerId && p.fledAt,
  );
  const delta = game.mySettlement?.delta;
  // Partie de tournoi : même bilan, mais sur le compte FICTIF (D-111), jamais l'argent réel.
  const fictitious = game.mySettlement?.account === "TOURNAMENT";
  const headline = !result
    ? t.stopped
    : iWon
      ? t.youWon
      : t.wonBy(winnerName ?? "");
  const outcome = iWon
    ? t.youWin
    : iFled
      ? t.youFled
      : result
        ? t.youLose
        : delta !== undefined
          ? t.noChange
          : undefined;

  // Comment la partie s'est terminée, d'après le résultat officiel du serveur : main
  // spéciale (déclarée ou automatique, D-035) ou adversaire couché (partie à 2, D-086). Le
  // joueur qui s'est couché a déjà « Vous avez fui la partie ».
  const fledName = result?.fledPlayerIds[0]
    ? playerLabel(game, result.fledPlayerIds[0])
    : undefined;
  // Ma victoire par Full (THREE_AND_TWO : 3 cartes d'une valeur + 2 d'une autre) ou par
  // « somme ≤ 21 » (SUM_AT_MOST_21) : combinaison retenue par le serveur (D-035), jamais
  // recalculée ici. Le bloc « Main spéciale » remplace alors la ligne de raison.
  const specialHandName =
    iWon && result?.method === "INSTANT_WIN"
      ? result.instantWinCombination === "THREE_AND_TWO"
        ? t.fullHouse
        : result.instantWinCombination === "SUM_AT_MOST_21"
          ? t.sumAtMost21
          : // « Composition de 7 » (deux 7, un 4, un 3 ; D-118), retenue par le serveur.
            result.instantWinCombination === "COMPOSITION_OF_SEVEN"
            ? t.compositionOfSeven
            : undefined
      : undefined;
  const reason = specialHandName
    ? undefined
    : result?.method === "INSTANT_WIN"
      ? t.bySpecialHand(
          result.instantWinCombination
            ? t.combinations[result.instantWinCombination]
            : undefined,
        )
      : result?.method === "OPPONENT_FLED" && !iFled && fledName
        ? t.opponentFled(fledName)
        : // GARAM TIA (D-119) : condition spéciale, ou meilleur total (fin normale).
          result?.method === "GARAM_AUTOMATIC_WIN" && result.garamCondition
          ? t.garamAutomatic(t.garamConditions[result.garamCondition] ?? "")
          : result?.method === "GARAM_BEST_SCORE" && result.scores
            ? [
                // 22 points = deux As (D-130) : « Victoire avec deux As » au lieu du total.
                result.scores[result.winnerId] === GARAM_TWO_ACES_SCORE
                  ? t.garamTwoAces
                  : t.garamBestScore(result.scores[result.winnerId] ?? 0),
                // Pénalité « moins de X » de la variante (D-127), décidée par le serveur.
                result.belowThresholdIds?.includes(game.viewerId)
                  ? t.garamBelowThreshold(result.penaltyThreshold ?? game.garamVariant)
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined;

  const replayAllowed = canContinue === true;
  const replayNotice =
    awaitingMe === true && !replayAllowed
      ? canContinue === false
        ? t.cannotContinue
        : t.continueUnchecked
      : undefined;

  const font = fontOf(fonts.button);
  const amountSize = Math.round(m.bodySize * 1.9);
  // Pile de jetons de la victoire, à cheval sur le coin haut gauche du panneau (capture :
  // ≈ un quart de la largeur du panneau), sans sortir de la marge de 16 de l'écran.
  const stack = Math.round(width * 0.24);
  // Deux boutons de même largeur MINIMALE (≈ un quart du panneau sur la capture), identiques
  // en victoire et en défaite. Ce n'est qu'un minimum : sur tablette la police des boutons
  // grandit (jusqu'à 22) et un libellé (« Rejouer », « Play again ») qui dépasse élargit son
  // bouton, sans jamais dépasser la largeur intérieure du panneau ; si les deux ne tiennent
  // plus côte à côte, le second passe dessous (jamais de libellé tronqué ni de débordement).
  const buttonWidth = Math.min(Math.max(Math.round(width * 0.28), 104), 130);
  const innerWidth = Math.max(buttonWidth, width - m.gap * 2 - 2);
  const buttonBox = { minWidth: buttonWidth, maxWidth: innerWidth };
  // Pile de jetons au-dessus du bord haut : comptée dans la hauteur à faire tenir.
  const overhang = iWon ? stack * 0.4 : 0;
  const scale = fit
    ? Math.min(
        fit.scale,
        measured > 0 ? fit.height / (measured + overhang) : 1,
        1,
      )
    : 1;
  // Titre centré sur toute la largeur : la même marge des deux côtés laisse la place de la
  // pile de jetons à gauche sans décaler le texte.
  const titleInset = iWon ? stack * 0.75 : 0;
  return (
    <View
      style={
        scale < 1
          ? { transform: [{ translateY: (overhang * scale) / 2 }, { scale }] }
          : overhang && fit
            ? { transform: [{ translateY: overhang / 2 }] }
            : undefined
      }
    >
      <Animated.View
        onLayout={(e) => setMeasured(e.nativeEvent.layout.height)}
        testID="game-over-panel"
        accessibilityLiveRegion="polite"
        style={[
          styles.panel,
          iWon && styles.panelWon,
          {
            width,
            paddingHorizontal: m.gap,
            paddingTop: m.gap * 0.8,
            paddingBottom: m.gap * 0.7,
            gap: m.gap * 0.5,
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, 0],
                }),
              },
              {
                scale: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.94, 1],
                }),
              },
            ],
          },
        ]}
      >
        {iWon ? <VictoryRays /> : null}
        {/* Filet de laiton en tête du panneau (or vif pour une victoire). */}
        <View
          pointerEvents="none"
          style={[styles.crest, iWon && styles.crestWon]}
        />
        {iWon ? (
          <View
            testID="game-over-chips"
            style={[
              styles.chips,
              { top: -stack * 0.4, left: -Math.min(stack * 0.3, 12) },
            ]}
          >
            {/* Capture : pile haute en arrière à droite, pile basse devant à gauche. */}
            <ChipStack size={stack * 0.62} layers={3} />
            <ChipStack
              size={stack * 0.62}
              layers={2}
              style={{ marginRight: -stack * 0.22, marginTop: stack * 0.3 }}
            />
          </View>
        ) : null}
        {specialHandName ? (
          <Text
            testID="game-over-special-kicker"
            style={[
              styles.white,
              font,
              styles.muted,
              styles.fullWidth,
              { fontSize: m.smallSize, paddingHorizontal: titleInset },
            ]}
          >
            {t.specialHandKicker}
          </Text>
        ) : null}
        <Text
          testID="game-over-title"
          accessibilityRole="header"
          // Une seule ligne, centrée : un titre long est réduit, jamais coupé.
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[
            styles.white,
            font,
            styles.fullWidth,
            { fontSize: m.bodySize * 1.3, paddingHorizontal: titleInset },
            iWon && [styles.gold, styles.titleWon],
          ]}
        >
          {headline}
        </Text>
        <OrnamentRule width={Math.round(width * 0.42)} won={iWon} />
        {reason ? (
          <Text
            testID="game-over-reason"
            style={[styles.white, font, { fontSize: m.smallSize }]}
          >
            {reason}
          </Text>
        ) : null}
        {specialHandName ? (
          <View testID="game-over-special-hand" style={styles.centerRow}>
            <Text style={[styles.white, font, { fontSize: m.smallSize }]}>
              {t.specialHandLabel}
            </Text>
            <Text
              testID="game-over-special-name"
              // Nom long (« Somme inférieur ou égale à 21 ») : réduit sur une ligne, jamais coupé,
              // pour que la hauteur du panneau ne change pas.
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={[
                styles.white,
                font,
                styles.gold,
                { fontSize: m.bodySize * 1.5 },
              ]}
            >
              {specialHandName}
            </Text>
          </View>
        ) : null}
        {/* Bilan sur une ligne (« Vous gagnez +485 ») : le panneau reste bas sur la table. */}
        <View
          style={[styles.amountRow, styles.wrap, { columnGap: m.gap * 0.6 }]}
        >
          {outcome ? (
            <Text style={[styles.white, font, { fontSize: m.bodySize * 1.05 }]}>
              {outcome}
            </Text>
          ) : null}
          {delta !== undefined ? (
            <View
              testID="game-over-amount"
              accessible
              accessibilityLabel={
                fictitious
                  ? t.tournamentAmountA11y(signedAmount(delta))
                  : t.amountA11y(signedAmount(delta))
              }
              style={[styles.amountRow, { gap: m.gap * 0.4 }]}
            >
              <Text
                style={[
                  styles.white,
                  font,
                  {
                    fontSize: amountSize,
                    lineHeight: amountSize * 1.15,
                    color: amountColor(delta),
                  },
                ]}
              >
                {signedAmount(delta)}
              </Text>
              <View testID="game-over-coin">
                <Coin
                  size={Math.round(amountSize * 0.95)}
                  fontFamily={fonts.title}
                />
              </View>
            </View>
          ) : null}
        </View>
        {delta !== undefined && fictitious ? (
          <Text
            testID="game-over-tournament-note"
            style={[
              styles.white,
              { fontSize: m.smallSize, textAlign: "center" },
            ]}
          >
            {t.tournamentAmountNote}
          </Text>
        ) : null}
        {error ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { fontSize: m.smallSize }]}
          >
            {error}
          </Text>
        ) : null}
        {/* Réclamation sur cette partie (D-114) : le serveur vérifie la participation. */}
        <ReportProblemLink gameId={game.gameId} category="GAME_RESULT" />
        {footer ?? (
          <>
            <View
              style={[
                styles.buttons,
                {
                  columnGap: m.gap * 1.2,
                  rowGap: m.gap * 0.6,
                  marginTop: m.gap * 0.4,
                },
              ]}
            >
              <View testID="game-over-quit" style={buttonBox}>
                <PanelButton
                  tone="danger"
                  title={t.quit}
                  loading={action === "quit" && pending}
                  disabled={action !== null}
                  onPress={() => run("quit", () => onQuit(false))}
                />
              </View>
              {replayAllowed ? (
                <View testID="game-over-replay" style={buttonBox}>
                  <PanelButton
                    title={t.replay}
                    loading={action === "replay" && pending}
                    disabled={action !== null || awaitingMe !== true}
                    onPress={() => run("replay", onReplay)}
                  />
                </View>
              ) : null}
            </View>
            {replayNotice ? (
              <Text
                testID="game-over-replay-notice"
                style={[styles.white, font, { fontSize: m.smallSize }]}
              >
                {replayNotice}
              </Text>
            ) : null}
            {action === "quit" ? (
              <Text style={[styles.white, font, { fontSize: m.smallSize }]}>
                {t.leaving}
              </Text>
            ) : counting ? (
              <Text
                testID="game-over-countdown"
                style={[styles.white, font, { fontSize: m.smallSize }]}
              >
                {t.leavingIn(seconds)}
              </Text>
            ) : null}
          </>
        )}
      </Animated.View>
    </View>
  );
}

/** Rayons d'une victoire (repère 100 × 100) : éventail vers le bas depuis le haut du panneau. */
const VICTORY_RAYS = Array.from({ length: 18 }, (_, i) => {
  const a = ((10 + (i * 160) / 17) * Math.PI) / 180;
  const half = (2.2 * Math.PI) / 180;
  const point = (angle: number) =>
    `${(50 + 140 * Math.cos(angle)).toFixed(1)} ${(-10 + 140 * Math.sin(angle)).toFixed(1)}`;
  return `M50 -10 L${point(a - half)} L${point(a + half)} Z`;
}).join(" ");

/**
 * Soleil de victoire derrière le contenu du panneau : rayons d'or très doux partant du haut,
 * halo au-dessus du titre. Décor seulement, affiché quand le SERVEUR annonce ma victoire.
 */
function VictoryRays() {
  return (
    <View
      testID="game-over-rays"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.rays]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="victoryHalo" cx="50%" cy="0%" r="75%">
            <Stop offset="0" stopColor="#FFD86A" stopOpacity="0.32" />
            <Stop offset="1" stopColor="#FFD86A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path d={VICTORY_RAYS} fill="#F5C842" opacity={0.09} />
        <Rect x="0" y="0" width="100" height="100" fill="url(#victoryHalo)" />
      </Svg>
    </View>
  );
}

/** Filet Art déco sous le titre : deux traits de laiton et un losange au centre. */
function OrnamentRule({ width, won }: { width: number; won: boolean }) {
  const color = won ? gameTheme.focus : gameTheme.brass.main;
  return (
    <Svg
      testID="game-over-rule"
      width={width}
      height={8}
      viewBox={`0 0 ${width} 8`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={`M0 4 L${width / 2 - 8} 4 M${width / 2 + 8} 4 L${width} 4`} stroke={color} strokeOpacity={0.55} strokeWidth={1} />
      <Path d={`M${width / 2} 0.5 L${width / 2 + 4} 4 L${width / 2} 7.5 L${width / 2 - 4} 4 Z`} fill={color} />
    </Svg>
  );
}

/** Couleur du montant selon son SIGNE (bilan du serveur) : gain jade, perte corail. */
export function amountColor(delta: number): string {
  if (delta > 0) return salon.status.positive.text;
  if (delta < 0) return salon.status.critical.text;
  return "#FFFFFF";
}

/**
 * Entrée du panneau de fin : il monte et se pose (fondu, léger zoom) une fois le résultat
 * annoncé par le serveur. Avec « réduire les animations », il apparaît directement. Les
 * boutons sont actifs dès le premier rendu : l'animation ne retarde aucune action.
 */
function usePanelEntrance(): Animated.Value {
  const reduced = useReducedMotion();
  const [entrance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: motion.result,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance, reduced]);
  return entrance;
}

const styles = StyleSheet.create({
  panel: {
    alignItems: "center",
    overflow: "visible",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: gameTheme.lacquer.border,
    // Laque sombre : la table reste devinée derrière le panneau.
    backgroundColor: gameTheme.lacquer.fill,
    experimental_backgroundImage: gameTheme.lacquer.surface,
    // Double filet Art déco, comme les plaques de la table.
    boxShadow: `${gameTheme.shadow.panel}, inset 0 0 0 3px rgba(0, 0, 0, 0.45), inset 0 0 0 4px ${gameTheme.brass.faint}`,
  },
  // Victoire du joueur (résultat du serveur) : contour or et lueur.
  panelWon: {
    borderColor: gameTheme.focus,
    boxShadow: `${gameTheme.shadow.panel}, 0 0 26px 4px ${gameTheme.focusGlow}, inset 0 0 0 3px rgba(0, 0, 0, 0.45), inset 0 0 0 4px rgba(245, 200, 66, 0.3)`,
  },
  rays: { borderRadius: 14, overflow: "hidden" },
  crest: {
    position: "absolute",
    top: -1,
    left: "18%",
    right: "18%",
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: gameTheme.brass.main,
  },
  crestWon: { backgroundColor: gameTheme.focus, boxShadow: `0 0 10px ${gameTheme.focusGlow}` },
  titleWon: {
    textShadowColor: "rgba(245, 200, 66, 0.45)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  chips: {
    position: "absolute",
    zIndex: 1,
    flexDirection: "row-reverse",
    pointerEvents: "none",
  },
  white: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
  muted: { opacity: 0.75, textTransform: "uppercase", letterSpacing: 1 },
  gold: { color: palette.gold },
  centerRow: { alignItems: "center" },
  fullWidth: { alignSelf: "stretch" },
  wrap: { flexWrap: "wrap" },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  error: { color: palette.error, textAlign: "center", fontWeight: "600" },
});
