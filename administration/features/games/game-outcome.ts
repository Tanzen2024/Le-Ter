import { END_REASON, label } from '@/lib/labels';
import type { GameRow } from '@/types/admin';

/**
 * Colonne « Vainqueur » : ce qui s'est réellement passé dans une partie, déduit UNIQUEMENT des
 * données persistées (statut, `end_reason`, `winner_id`, `fled_at`, `turn_timed_out_at`, lien de
 * reprise). Aucun événement n'est inventé :
 * - le vainqueur est `winner_id` et rien d'autre (jamais le dernier contrôleur d'un pli, ni le
 *   dernier joueur restant) ; il n'existe que pour INSTANT_WIN, CONTROL_AFTER_LAST_TRICK et
 *   OPPONENT_FLED ;
 * - une fuite ne termine une partie que dans une partie à 2 (OPPONENT_FLED, D-086) : le
 *   joueur restant gagne ; sinon la partie continue sans le fuyard ;
 * - une échéance de tour ne termine jamais une partie (un coup automatique est joué) ;
 * - les déconnexions et les parties en attente supprimées ne sont pas enregistrées.
 * Toute combinaison contraire à ces invariants est signalée comme une anomalie.
 */
export type GameOutcome =
  | { kind: 'winner'; winner: string; method: string; details: string[] }
  | { kind: 'state'; title: string; tone: OutcomeTone; details: string[] }
  | { kind: 'anomaly'; title: string; details: string[] };

export type OutcomeTone = 'neutral' | 'accent' | 'info';

const VICTORY_REASONS = new Set([
  'INSTANT_WIN',
  'CONTROL_AFTER_LAST_TRICK',
  'OPPONENT_FLED',
  'GARAM_AUTOMATIC_WIN',
  'GARAM_BEST_SCORE',
]);

type OutcomeInput = Pick<
  GameRow,
  'status' | 'endReason' | 'winner' | 'players' | 'turnTimedOutAt' | 'replayedByGameId'
>;

const shortId = (id: string) => id.slice(0, 8);

function fleeDetails(g: OutcomeInput): string[] {
  const ended = g.endReason === 'OPPONENT_FLED';
  return g.players
    .filter((p) => p.fledAt)
    .map((p) =>
      ended
        ? `${p.username} s’est couché au 1er tour : partie terminée, sa mise est perdue`
        : `${p.username} a fui au 1er tour, la partie a continué`,
    );
}

function anomaly(title: string, ...details: string[]): GameOutcome {
  return { kind: 'anomaly', title, details };
}

export function describeGameOutcome(g: OutcomeInput): GameOutcome {
  const flees = fleeDetails(g);

  if (g.status !== 'finished') {
    if (g.winner || g.endReason) {
      return anomaly(
        'Données contradictoires',
        g.winner
          ? 'Vainqueur enregistré alors que la partie n’est pas terminée'
          : 'Motif de fin enregistré alors que la partie n’est pas terminée',
      );
    }
    if (g.status === 'waiting') {
      return { kind: 'state', title: 'En attente', tone: 'info', details: ['Non commencée'] };
    }
    return {
      kind: 'state',
      title: 'En cours',
      tone: 'accent',
      details: [
        ...flees,
        ...(g.turnTimedOutAt ? ['Délai de tour dépassé, coup automatique en attente'] : []),
      ],
    };
  }

  const reason = g.endReason;
  if (!reason) {
    return anomaly(
      'Résultat indisponible',
      g.winner
        ? 'Vainqueur enregistré sans motif de fin'
        : 'Partie terminée sans motif de fin enregistré',
    );
  }

  if (VICTORY_REASONS.has(reason)) {
    const winner = g.winner;
    if (!winner) return anomaly('Résultat indisponible', 'Victoire enregistrée sans vainqueur');
    const seat = g.players.find((p) => p.playerId === winner.id);
    if (!seat) {
      return anomaly('Données contradictoires', 'Vainqueur absent des joueurs de la partie');
    }
    if (seat.fledAt) {
      return anomaly('Données contradictoires', 'Le vainqueur enregistré a fui la partie');
    }
    return {
      kind: 'winner',
      winner: winner.username ?? seat.username,
      method: label(END_REASON, reason),
      details: flees,
    };
  }

  if (g.winner) {
    return anomaly(
      'Données contradictoires',
      `Vainqueur enregistré pour une fin sans vainqueur (${label(END_REASON, reason)})`,
    );
  }

  if (reason === 'GARAM_TIE') {
    return {
      kind: 'state',
      title: 'Manche nulle (GARAM TIA)',
      tone: 'neutral',
      details: [
        'Égalité, aucun vainqueur',
        g.replayedByGameId
          ? `Rejouée dans la partie ${shortId(g.replayedByGameId)}`
          : 'Aucune reprise enregistrée',
      ],
    };
  }

  if (reason === 'INSTANT_WIN_TIE') {
    return {
      kind: 'state',
      title: 'Égalité',
      tone: 'neutral',
      details: [
        'Victoires instantanées de même rang, aucun vainqueur',
        g.replayedByGameId
          ? `Rejouée dans la partie ${shortId(g.replayedByGameId)}`
          : 'Aucune reprise enregistrée',
        ...flees,
      ],
    };
  }

  if (reason === 'ADMIN_STOP') {
    return {
      kind: 'state',
      title: 'Partie interrompue',
      tone: 'neutral',
      details: ['Arrêt administratif, sans résultat de jeu', ...flees],
    };
  }

  return anomaly('Résultat indisponible', `Motif de fin inconnu (${reason})`);
}
