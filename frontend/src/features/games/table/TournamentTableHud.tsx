import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fontOf, tablePalette, useTableFonts } from '../../../components/table/TableDecor';
import type { TournamentContext } from '../../../types/tournament';
import { useLobbyMetrics } from '../../lobby/lobby-metrics';
import { Coin } from '../../lobby/LobbyUi';
import { useTournamentContext } from '../../tournaments/hooks';
import { formatDuration, useTournamentMessages } from '../../tournaments/tournament-messages';
import { BalancePill } from './TableParts';

/** L'échéance du tournoi se compte en minutes : une seconde de résolution suffit largement. */
const TICK_MS = 1_000;

/**
 * Temps restant avant la fin du tournoi, sur l'horloge du SERVEUR (`serverNow` et l'instant de
 * réception corrigent le décalage du téléphone). Visuel seulement : le serveur seul ferme le
 * tournoi.
 */
export function tournamentRemainingMs(
  context: Pick<TournamentContext, 'endsAt' | 'serverNow'>,
  receivedAt: number,
  now: number,
): number {
  const offset = Date.parse(context.serverNow) - receivedAt;
  return Math.max(0, Date.parse(context.endsAt) - (now + offset));
}

/**
 * HUD d'une table de TOURNOI (D-106), à la place du solde du compte de jeu : jetons restants
 * dans CE tournoi, parties jouées dans ce tournoi, rang provisoire et temps restant. Le compte
 * de jeu ordinaire, les réservations et les autres tournois n'y figurent jamais. Le tournoi est
 * celui de la partie (`game.tournamentId`, décidé par le serveur), jamais un état global.
 */
export function TournamentTableHud({
  tournamentId,
  height,
}: {
  tournamentId: string;
  height: number;
}) {
  const m = useLobbyMetrics();
  const t = useTournamentMessages();
  const fonts = useTableFonts();
  const { data, dataUpdatedAt } = useTournamentContext(tournamentId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(handle);
  }, []);

  if (!data) {
    return (
      <BalancePill height={height}>
        <Text style={[styles.tokens, fontOf(fonts.button), { fontSize: m.bodySize * 1.15 }]}>
          —
        </Text>
        <Coin size={Math.round(height * 0.62)} fontFamily={fonts.title} />
      </BalancePill>
    );
  }
  const remaining = tournamentRemainingMs(data, dataUpdatedAt || now, now);
  const ended = data.status !== 'IN_PROGRESS' || remaining === 0;
  const details = [
    t.hud.games(data.gamesPlayed),
    t.hud.rank(data.rank, data.participants),
    ended ? t.hud.ended : t.hud.remaining(formatDuration(remaining)),
    data.participation !== 'ACTIVE' ? t.hud.status[data.participation] : undefined,
  ].filter((part): part is string => part !== undefined);
  return (
    <BalancePill height={height}>
      <View
        testID="tournament-table-hud"
        accessible
        accessibilityLabel={[
          t.hud.tokensA11y(data.tokensRemaining),
          t.hud.games(data.gamesPlayed),
          t.hud.rankA11y(data.rank, data.participants),
          ended ? t.hud.ended : t.hud.remaining(formatDuration(remaining)),
        ].join(', ')}
        style={styles.column}
      >
        <View style={styles.line}>
          {/* Le solde affiché est celui du tournoi, distinct du compte de jeu réel (D-111). */}
          <Text testID="tournament-table-hud-tag" style={[styles.tag, { fontSize: m.smallSize - 1 }]}>
            {t.hud.tag}
          </Text>
          <Text style={[styles.tokens, fontOf(fonts.button), { fontSize: m.bodySize * 1.15 }]}>
            {t.hud.tokens(data.tokensRemaining)}
          </Text>
          <Coin size={Math.round(height * 0.5)} fontFamily={fonts.title} />
        </View>
        <Text numberOfLines={1} style={[styles.details, { fontSize: m.smallSize - 1 }]}>
          {details.join(' · ')}
        </Text>
      </View>
    </BalancePill>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'flex-end' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tokens: { color: '#FFFFFF' },
  tag: { color: tablePalette.gold, fontWeight: '700', textTransform: 'uppercase' },
  details: { color: tablePalette.cream, opacity: 0.9 },
});
