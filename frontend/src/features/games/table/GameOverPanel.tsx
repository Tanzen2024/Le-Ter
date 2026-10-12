import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  fontOf,
  tablePalette as palette,
  useTableFonts,
} from '../../../components/table/TableDecor';
import { useMessages } from '../../../lib/i18n';
import type { GameView } from '../../../types/game';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { Coin, PanelButton } from '../../lobby/LobbyUi';
import { playerLabel } from '../format';

/** Délai affiché avant la sortie automatique, à partir de l'apparition du panneau. */
export const EXIT_COUNTDOWN_SECONDS = 13;
const TICK_MS = 250;

/**
 * Compte à rebours de sortie : 13 s à partir de l'apparition du panneau, jamais au-delà de
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
  const deadline = Math.min(shownAt + EXIT_COUNTDOWN_SECONDS * 1000, capAt ?? Infinity);
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
  return delta > 0 ? `+${delta}` : delta < 0 ? `-${Math.abs(delta)}` : '0';
}

type Action = 'quit' | 'replay';

/**
 * Panneau de fin de partie, posé au centre de la table : gagnant (badge doré), message,
 * bilan du joueur (montant réglé par le serveur, D-074, jamais recalculé ici), puis
 * Quitter / Rejouer et le compte à rebours de sortie automatique.
 *
 * Une seule action par panneau : Quitter, Rejouer ou la fin du compte à rebours ; la
 * première arrête le compte à rebours et bloque les autres. Si le serveur la refuse, le
 * panneau redevient actif (le message d'erreur s'affiche).
 */
export function GameOverPanel({
  game,
  width,
  awaitingMe,
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
  const seconds = useExitCountdown(counting, capAt, () => run('quit', () => onQuit(true)));

  const result = game.result;
  const winnerName = result ? playerLabel(game, result.winnerId) : undefined;
  const iWon = result?.winnerId === game.viewerId;
  const iFled = game.players.some((p) => p.playerId === game.viewerId && p.fledAt);
  const delta = game.mySettlement?.delta;
  const headline = !result ? t.stopped : iWon ? t.youWon : t.wonBy(winnerName ?? '');
  const outcome = iWon
    ? t.youWin
    : iFled
      ? t.youFled
      : result
        ? t.youLose
        : delta !== undefined
          ? t.noChange
          : undefined;

  const font = fontOf(fonts.button);
  const amountSize = Math.round(m.bodySize * 1.9);
  const badgeHeight = Math.round(m.bodySize * 2);
  return (
    <View
      testID="game-over-panel"
      accessibilityLiveRegion="polite"
      style={[styles.panel, { width, padding: m.gap, gap: m.gap * 0.55 }]}
    >
      {winnerName ? (
        <View
          testID="game-over-winner"
          style={[
            styles.badge,
            { height: badgeHeight, borderRadius: badgeHeight / 2, minWidth: width * 0.55 },
          ]}
        >
          <Text numberOfLines={1} style={[styles.badgeText, font, { fontSize: m.bodySize * 1.05 }]}>
            {winnerName}
          </Text>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={[styles.white, font, { fontSize: m.bodySize * 1.2 }]}>
        {headline}
      </Text>
      {outcome ? (
        <Text style={[styles.white, font, { fontSize: m.bodySize * 1.05, marginTop: m.gap * 0.4 }]}>
          {outcome}
        </Text>
      ) : null}
      {delta !== undefined ? (
        <View
          testID="game-over-amount"
          accessible
          accessibilityLabel={t.amountA11y(signedAmount(delta))}
          style={[styles.amountRow, { gap: m.gap * 0.5 }]}
        >
          <Text style={[styles.white, font, { fontSize: amountSize, lineHeight: amountSize * 1.15 }]}>
            {signedAmount(delta)}
          </Text>
          <View testID="game-over-coin">
            <Coin size={Math.round(amountSize * 0.95)} fontFamily={fonts.title} />
          </View>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { fontSize: m.smallSize }]}>
          {error}
        </Text>
      ) : null}
      {footer ?? (
        <>
          <View style={[styles.buttons, { gap: m.gap, marginTop: m.gap * 0.5 }]}>
            <PanelButton
              tone="danger"
              title={t.quit}
              loading={action === 'quit' && pending}
              disabled={action !== null}
              onPress={() => run('quit', () => onQuit(false))}
            />
            <PanelButton
              title={t.replay}
              loading={action === 'replay' && pending}
              disabled={action !== null || awaitingMe !== true}
              onPress={() => run('replay', onReplay)}
            />
          </View>
          {action === 'quit' ? (
            <Text style={[styles.white, font, { fontSize: m.smallSize }]}>{t.leaving}</Text>
          ) : counting ? (
            <Text testID="game-over-countdown" style={[styles.white, font, { fontSize: m.smallSize }]}>
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
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.panelBorder,
    // Brun sombre translucide : la table en bois reste visible derrière le panneau.
    backgroundColor: 'rgba(30, 17, 9, 0.78)',
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 236, 170, 0.55)',
    backgroundColor: palette.goldDeep,
    experimental_backgroundImage: 'linear-gradient(180deg, #E8B53A 0%, #C98A14 100%)',
  },
  badgeText: { color: '#FFFFFF', fontWeight: '800' },
  white: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center' },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttons: { flexDirection: 'row', justifyContent: 'center' },
  error: { color: palette.error, textAlign: 'center', fontWeight: '600' },
});
