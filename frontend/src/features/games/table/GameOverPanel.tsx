import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from "../../../components/table/TableDecor";
import { useMessages } from "../../../lib/i18n";
import type { GameView } from "../../../types/game";
import { useLobbyMetrics } from "../../lobby/lobby-metrics";
import { Coin, PanelButton } from "../../lobby/LobbyUi";
import { ChipStack } from "../../wallet/ShopIllustrations";
import { ReportProblemLink } from "../../complaints/ReportProblemLink";
import { playerLabel } from "../format";

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
  const [action, setAction] = useState<Action | null>(null);
  const acted = useRef(false);

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
  // Deux boutons de même largeur (≈ un quart du panneau sur la capture), jamais trop étroits
  // pour leur libellé sur un petit téléphone ; identiques en victoire et en défaite.
  const buttonWidth = Math.min(Math.max(Math.round(width * 0.28), 104), 130);
  return (
    <View
      testID="game-over-panel"
      accessibilityLiveRegion="polite"
      style={[
        styles.panel,
        {
          width,
          paddingHorizontal: m.gap,
          paddingTop: m.gap * 0.8,
          paddingBottom: m.gap * 0.7,
          gap: m.gap * 0.5,
        },
      ]}
    >
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
            { fontSize: m.smallSize, paddingLeft: stack * 0.75 },
          ]}
        >
          {t.specialHandKicker}
        </Text>
      ) : null}
      <Text
        testID="game-over-title"
        accessibilityRole="header"
        numberOfLines={2}
        style={[
          styles.white,
          font,
          { fontSize: m.bodySize * 1.3 },
          iWon && { paddingLeft: stack * 0.75 },
        ]}
      >
        {headline}
      </Text>
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
            style={[styles.white, font, styles.gold, { fontSize: m.bodySize * 1.5 }]}
          >
            {specialHandName}
          </Text>
        </View>
      ) : null}
      {outcome ? (
        <Text
          style={[
            styles.white,
            font,
            { fontSize: m.bodySize * 1.05, marginTop: m.gap * 0.5 },
          ]}
        >
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
              { fontSize: amountSize, lineHeight: amountSize * 1.15 },
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
      {delta !== undefined && fictitious ? (
        <Text
          testID="game-over-tournament-note"
          style={[styles.white, { fontSize: m.smallSize, textAlign: "center" }]}
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
            style={[styles.buttons, { gap: m.gap * 1.2, marginTop: m.gap * 0.4 }]}
          >
            <View style={{ width: buttonWidth }}>
              <PanelButton
                tone="danger"
                title={t.quit}
                loading={action === "quit" && pending}
                disabled={action !== null}
                onPress={() => run("quit", () => onQuit(false))}
              />
            </View>
            {replayAllowed ? (
              <View style={{ width: buttonWidth }}>
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
    </View>
  );
}


const styles = StyleSheet.create({
  panel: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    // Brun sombre translucide : la table en bois reste visible derrière le panneau.
    backgroundColor: "rgba(28, 20, 14, 0.8)",
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.35)",
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
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttons: { flexDirection: "row", justifyContent: "center", alignSelf: "stretch" },
  error: { color: palette.error, textAlign: "center", fontWeight: "600" },
});
