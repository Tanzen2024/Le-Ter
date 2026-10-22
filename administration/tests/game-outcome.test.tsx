import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataTable } from '@/components/data/data-table';
import { gameColumns } from '@/features/games/columns';
import { describeGameOutcome } from '@/features/games/game-outcome';
import type { GameRow } from '@/types/admin';

/**
 * Colonne « Vainqueur » : uniquement ce qui est enregistré (statut, end_reason, winner_id,
 * fled_at, turn_timed_out_at, reprise). Jamais de vainqueur déduit d'autre chose.
 */
const LAMAT = { playerId: 'u-lamat', username: 'LAMAT', seat: 0 };
const BOB = { playerId: 'u-bob', username: 'BOB', seat: 1 };
const ZOE = { playerId: 'u-zoe', username: 'ZOE', seat: 2 };

function game(over: Partial<GameRow> = {}): GameRow {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    gameType: 'TER',
    status: 'finished',
    sessionId: 'ssssssss-0000-4000-8000-000000000001',
    tournament: null,
    maxPlayers: 3,
    stakeAmount: null,
    createdAt: '2026-10-10T10:00:00Z',
    startedAt: '2026-10-10T10:00:05Z',
    finishedAt: '2026-10-10T10:04:00Z',
    durationSeconds: 235,
    turnTimedOutAt: null,
    endReason: 'CONTROL_AFTER_LAST_TRICK',
    winner: { id: LAMAT.playerId, username: 'LAMAT' },
    replayOfGameId: null,
    replayedByGameId: null,
    players: [LAMAT, BOB, ZOE].map((p) => ({
      ...p,
      joinedAt: '2026-10-10T10:00:00Z',
      fledAt: null,
    })),
    anomalies: [],
    ...over,
  };
}

const fled = (g: GameRow, playerId: string): GameRow['players'] =>
  g.players.map((p) => (p.playerId === playerId ? { ...p, fledAt: '2026-10-10T10:00:10Z' } : p));

describe('colonne Vainqueur : description de la partie', () => {
  it('partie à 2, adversaire couché (D-086) : vainqueur, motif et fuite qui a terminé la partie', () => {
    const base = game({ maxPlayers: 2, endReason: 'OPPONENT_FLED' });
    const duo = { ...base, players: base.players.slice(0, 2) };
    expect(describeGameOutcome({ ...duo, players: fled(duo, BOB.playerId) })).toEqual({
      kind: 'winner',
      winner: 'LAMAT',
      method: 'Adversaire couché (partie à 2)',
      details: ['BOB s’est couché au 1er tour : partie terminée, sa mise est perdue'],
    });
    // Le vainqueur enregistré ne peut pas être le fuyard.
    expect(describeGameOutcome({ ...duo, players: fled(duo, LAMAT.playerId) }).kind).toBe(
      'anomaly',
    );
  });

  it('1. victoire normale : seulement le pseudo, sans détail', () => {
    expect(describeGameOutcome(game())).toEqual({
      kind: 'winner',
      winner: 'LAMAT',
      method: 'Contrôle au dernier pli',
      details: [],
    });
    expect(describeGameOutcome(game({ endReason: 'INSTANT_WIN' }))).toMatchObject({
      kind: 'winner',
      winner: 'LAMAT',
      method: 'Victoire instantanée',
    });
  });

  it('2. partie en cours, et en attente', () => {
    const inProgress = game({
      status: 'in_progress',
      endReason: null,
      winner: null,
      finishedAt: null,
    });
    expect(describeGameOutcome(inProgress)).toEqual({
      kind: 'state',
      title: 'En cours',
      tone: 'accent',
      details: [],
    });
    const waiting = game({ ...inProgress, status: 'waiting', startedAt: null });
    expect(describeGameOutcome(waiting)).toMatchObject({
      kind: 'state',
      title: 'En attente',
      details: ['Non commencée'],
    });
  });

  it('3. annulation : jamais enregistrée (partie en attente supprimée), aucun libellé inventé', () => {
    // Aucun statut ni motif « annulée » n'existe : une valeur inconnue est signalée telle quelle.
    expect(describeGameOutcome(game({ endReason: 'CANCELLED', winner: null }))).toEqual({
      kind: 'anomaly',
      title: 'Résultat indisponible',
      details: ['Motif de fin inconnu (CANCELLED)'],
    });
  });

  it('4. fuite puis victoire officielle : le vainqueur est winner_id, la fuite en détail', () => {
    const g = game();
    const outcome = describeGameOutcome({ ...g, players: fled(g, BOB.playerId) });
    expect(outcome).toEqual({
      kind: 'winner',
      winner: 'LAMAT',
      method: 'Contrôle au dernier pli',
      details: ['BOB a fui au 1er tour, la partie a continué'],
    });
  });

  it('4 bis. le joueur ayant fui n’est jamais présenté comme vainqueur', () => {
    const g = game({ winner: { id: BOB.playerId, username: 'BOB' } });
    expect(describeGameOutcome({ ...g, players: fled(g, BOB.playerId) })).toEqual({
      kind: 'anomaly',
      title: 'Données contradictoires',
      details: ['Le vainqueur enregistré a fui la partie'],
    });
  });

  it('5. déconnexion / reconnexion : non enregistrée, la partie reste simplement en cours', () => {
    const g = game({ status: 'in_progress', endReason: null, winner: null, finishedAt: null });
    const outcome = describeGameOutcome(g);
    expect(outcome).toMatchObject({ kind: 'state', title: 'En cours' });
    expect(JSON.stringify(outcome)).not.toMatch(/déconnect|abandon/i);
  });

  it('6. partie interrompue (arrêt administratif)', () => {
    expect(describeGameOutcome(game({ endReason: 'ADMIN_STOP', winner: null }))).toEqual({
      kind: 'state',
      title: 'Partie interrompue',
      tone: 'neutral',
      details: ['Arrêt administratif, sans résultat de jeu'],
    });
  });

  it('7. échéance de tour : la partie continue, coup automatique en attente', () => {
    const g = game({
      status: 'in_progress',
      endReason: null,
      winner: null,
      finishedAt: null,
      turnTimedOutAt: '2026-10-10T10:02:00Z',
    });
    expect(describeGameOutcome(g)).toMatchObject({
      title: 'En cours',
      details: ['Délai de tour dépassé, coup automatique en attente'],
    });
  });

  it('8. égalité de victoires instantanées : reprise liée, ou absente', () => {
    const tie = game({ endReason: 'INSTANT_WIN_TIE', winner: null });
    expect(
      describeGameOutcome({ ...tie, replayedByGameId: 'bbbbbbbb-0000-4000-8000-000000000002' }),
    ).toEqual({
      kind: 'state',
      title: 'Égalité',
      tone: 'neutral',
      details: [
        'Victoires instantanées de même rang, aucun vainqueur',
        'Rejouée dans la partie bbbbbbbb',
      ],
    });
    expect(describeGameOutcome(tie).details).toContain('Aucune reprise enregistrée');
  });

  it('9. terminée sans vainqueur exploitable', () => {
    expect(describeGameOutcome(game({ winner: null }))).toEqual({
      kind: 'anomaly',
      title: 'Résultat indisponible',
      details: ['Victoire enregistrée sans vainqueur'],
    });
    expect(describeGameOutcome(game({ endReason: null, winner: null }))).toEqual({
      kind: 'anomaly',
      title: 'Résultat indisponible',
      details: ['Partie terminée sans motif de fin enregistré'],
    });
  });

  it('10. données contradictoires ou incomplètes', () => {
    expect(describeGameOutcome(game({ endReason: 'ADMIN_STOP' }))).toMatchObject({
      kind: 'anomaly',
      title: 'Données contradictoires',
    });
    expect(describeGameOutcome(game({ status: 'in_progress' }))).toEqual({
      kind: 'anomaly',
      title: 'Données contradictoires',
      details: ['Vainqueur enregistré alors que la partie n’est pas terminée'],
    });
    expect(
      describeGameOutcome(game({ winner: { id: 'u-stranger', username: 'X' } })),
    ).toMatchObject({ kind: 'anomaly', details: ['Vainqueur absent des joueurs de la partie'] });
    expect(describeGameOutcome(game({ endReason: null }))).toMatchObject({
      kind: 'anomaly',
      details: ['Vainqueur enregistré sans motif de fin'],
    });
  });

  it('12. jamais de vainqueur déduit : sans winner_id, aucun joueur n’est présenté gagnant', () => {
    // Le dernier contrôleur d'un pli n'est pas transmis à l'administration ; même pour une fin
    // CONTROL_AFTER_LAST_TRICK, seul winner_id désigne le vainqueur.
    for (const reason of ['CONTROL_AFTER_LAST_TRICK', 'INSTANT_WIN_TIE', 'ADMIN_STOP']) {
      const outcome = describeGameOutcome(game({ endReason: reason, winner: null }));
      expect(outcome.kind).not.toBe('winner');
      expect(JSON.stringify(outcome)).not.toMatch(/LAMAT|BOB|ZOE/);
    }
  });
});

describe('colonne Vainqueur : rendu dans le tableau', () => {
  it('11. parties successives aux résultats différents, en-tête « Vainqueur »', () => {
    const rows = [
      game({ id: 'g1' }),
      game({
        id: 'g2',
        endReason: 'INSTANT_WIN',
        winner: { id: BOB.playerId, username: 'BOB' },
      }),
      game({ id: 'g3', endReason: 'INSTANT_WIN_TIE', winner: null, replayedByGameId: 'g4-xxxxxx' }),
      game({
        id: 'g4',
        status: 'in_progress',
        endReason: null,
        winner: null,
        replayOfGameId: 'g3',
      }),
    ];
    render(<DataTable caption="Parties" columns={gameColumns} rows={rows} rowKey={(g) => g.id} />);
    expect(screen.getByRole('columnheader', { name: 'Vainqueur' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Résultat' })).not.toBeInTheDocument();

    const [, r1, r2, r3, r4] = screen.getAllByRole('row');
    expect(within(r1!).getByRole('img', { name: 'Vainqueur :' })).toBeInTheDocument();
    expect(within(r1!).getByTitle('Contrôle au dernier pli')).toHaveTextContent('LAMAT');
    expect(within(r2!).getByTitle('Victoire instantanée')).toHaveTextContent('BOB');
    expect(within(r3!).queryByRole('img', { name: 'Vainqueur :' })).not.toBeInTheDocument();
    expect(within(r3!).getByText('Égalité')).toBeInTheDocument();
    expect(within(r3!).getByText(/Rejouée dans la partie g4-xxxxx/)).toBeInTheDocument();
    expect(within(r4!).getAllByText('En cours').length).toBeGreaterThan(0);
  });
});
