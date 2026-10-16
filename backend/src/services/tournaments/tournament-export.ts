import { tournamentLabel, type Tournament } from '../../domain/tournaments/tournament';
import type { TournamentResultRow } from '../../repositories/tournament.repository';

/**
 * Export du classement final (D-054). Le calcul est fait une fois (résultats figés) ; un
 * format n'est qu'une mise en forme des mêmes lignes : CSV aujourd'hui, XLSX en ajoutant un
 * `ResultsExportFormat` sans toucher au calcul.
 */
export interface ResultsExportFormat {
  contentType: string;
  extension: string;
  render(tournament: Tournament, rows: TournamentResultRow[]): string | Buffer;
}

export const RESULTS_EXPORT_COLUMNS = [
  'Tournament',
  'Player',
  'Rank',
  'Initial Tokens',
  'Remaining Tokens',
  'Games Played',
  'Games Won',
  'Score',
  'Prize Amount',
  // Audit du classement (D-106), ajouté en fin pour ne pas déplacer les colonnes existantes.
  'Ranking Method',
  'Tokens Ratio',
  'Games Ratio',
  'Tokens Weight %',
  'Games Weight %',
  'Games Reference',
  'Tie Break',
] as const;

/** Cellule CSV (RFC 4180) ; neutralise les formules (=, +, -, @) à l'ouverture dans Excel. */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_EXPORT: ResultsExportFormat = {
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  render(tournament, rows) {
    const lines = [
      RESULTS_EXPORT_COLUMNS.join(','),
      ...rows.map((r) =>
        [
          // Le nom n'existe plus (D-060) : libellé daté calculé.
          tournamentLabel(tournament.startsAt, tournament.timezone),
          r.username,
          r.rank,
          r.initialTokens,
          r.remainingTokens,
          r.gamesPlayed,
          r.gamesWon,
          // Score figé (D-062) ; vide pour un classement antérieur au score pondéré.
          r.score ?? '',
          r.prizeAmount,
          r.rankingMethod ?? '',
          r.tokensRatio ?? '',
          r.gamesRatio ?? '',
          r.tokensWeightBps !== undefined ? r.tokensWeightBps / 100 : '',
          r.gamesWeightBps !== undefined ? r.gamesWeightBps / 100 : '',
          r.gamesReference ?? '',
          r.tieBreak ?? '',
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    // BOM UTF-8 : accents corrects à l'ouverture dans Excel.
    return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
  },
};

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Résumé partageable (WhatsApp ou autre) : canal COMPLÉMENTAIRE, la source officielle reste
 * Le Ter. Montants en FCFA (1 jeton = 1 FCFA, D-054).
 */
export function shareSummary(tournament: Tournament, rows: TournamentResultRow[]): string {
  const winners = rows.filter((r) => r.prizeAmount > 0);
  const lines = [
    `🏆 ${tournamentLabel(tournament.startsAt, tournament.timezone)} — TOURNOI TERMINÉ`,
    '',
    ...winners.map(
      (r) =>
        `${MEDALS[r.rank - 1] ?? `${r.rank}.`} ${r.username} — ${formatFcfa(r.prizeAmount)} ` +
        `(${r.remainingTokens} jetons, ${r.gamesPlayed} parties` +
        `${r.score !== undefined ? `, score ${r.score.toFixed(2)}` : ''})`,
    ),
    '',
    `${rows.length} participants · cagnotte ${formatFcfa(tournament.prizePool ?? 0)}`,
    'Résultats officiels dans l’application Le Ter.',
  ];
  return lines.join('\n');
}

const UTF8_BOM = String.fromCharCode(0xfeff);

/** « 45 000 FCFA » (espaces ordinaires : lisibles dans tout canal de partage). */
export function formatFcfa(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}
