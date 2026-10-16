import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataTable } from '@/components/data/data-table';
import { resultColumns } from '@/features/tournaments/tournament-detail';
import type { TournamentResult } from '@/types/admin';

/**
 * Colonne « Parties » du classement officiel : nombre TOTAL de parties admissibles jouées dans
 * tout le tournoi (calculé par le serveur sur toutes les tables), un nombre seul, sans
 * dénominateur ; les victoires ont leur propre colonne. Colonne « Départage » : critère
 * enregistré par le serveur, « — » sans égalité de score.
 */
function result(over: Partial<TournamentResult>): TournamentResult {
  return {
    rank: 1,
    username: 'LAMAT',
    initialTokens: 8000,
    remainingTokens: 9200,
    gamesPlayed: 5,
    gamesWon: 4,
    score: 65.43,
    prizePercent: 50,
    prizeAmount: 680,
    paid: true,
    ...over,
  };
}

describe('classement et résultats (administration)', () => {
  it('« Parties » = total seul, sans dénominateur ; victoires dans « Gagnées »', () => {
    const rows = [
      result({}),
      result({ rank: 2, username: 'Hugo', remainingTokens: 6800, gamesWon: 1, score: 60.9 }),
    ];
    render(
      <DataTable
        caption="Classement"
        columns={resultColumns()}
        rows={rows}
        rowKey={(r) => r.username}
      />,
    );
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const games = headers.indexOf('Parties');
    const won = headers.indexOf('Gagnées');
    expect(games).toBeGreaterThan(-1);
    expect(won).toBeGreaterThan(-1);

    const [, lamat, hugo] = screen.getAllByRole('row');
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(cells(lamat!)[games]).toBe('5');
    expect(cells(lamat!)[won]).toBe('4');
    expect(cells(hugo!)[games]).toBe('5');
    expect(cells(hugo!)[won]).toBe('1');
  });

  it('jamais de « / » dans « Parties », quel que soit le total', () => {
    render(
      <DataTable
        caption="Classement"
        columns={resultColumns()}
        rows={[result({ gamesPlayed: 4 })]}
        rowKey={(r) => r.username}
      />,
    );
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const [, row] = screen.getAllByRole('row');
    expect(within(row!).getAllByRole('cell')[headers.indexOf('Parties')]).toHaveTextContent(/^4$/);
  });

  it('« Départage » : libellé du critère enregistré, « — » sans égalité', () => {
    const rows = [
      result({ rank: 1, username: 'A', score: 70 }),
      result({ rank: 2, username: 'B', score: 50, tieBreak: 'GAMES_WON' }),
      result({ rank: 3, username: 'C', score: 50, tieBreak: 'REGISTRATION_ORDER' }),
      result({ rank: 4, username: 'D', score: 50, tieBreak: 'PLAYER_ID' }),
    ];
    render(
      <DataTable
        caption="Classement"
        columns={resultColumns()}
        rows={rows}
        rowKey={(r) => r.username}
      />,
    );
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const column = headers.indexOf('Départage');
    expect(column).toBeGreaterThan(-1);
    const labels = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[column]!.textContent);
    expect(labels).toEqual(['—', 'Parties gagnées', 'Ordre d’inscription', 'Identifiant']);
    // Aucun critère qui n'est pas appliqué par le serveur (les jetons sont dans le score).
    expect(screen.queryByText('Jetons restants', { selector: 'td' })).toBeNull();
  });
});
