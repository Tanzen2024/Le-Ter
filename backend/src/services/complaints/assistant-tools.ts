import type { AssistantToolName, ExtractedReferences } from '../../domain/complaints/assistant';
import type { UserId } from '../../domain/users/user';
import type {
  ComplaintEvidenceRepository,
  GameFacts,
  PaymentFacts,
  TournamentFacts,
  WithdrawalFacts,
} from '../../repositories/complaint-evidence.repository';

/**
 * Outils de l'assistant (D-114) : LECTURE SEULE, exécutés par le serveur avec l'identité du
 * jeton vérifié. Aucun outil n'écrit quoi que ce soit (ni solde, ni transaction, ni partie, ni
 * classement, ni récompense) : la seule écriture possible de l'assistant est une proposition de
 * réclamation, que le JOUEUR confirme par la route de création ordinaire.
 *
 * Chaque outil renvoie des FAITS (lus dans les tables qui font autorité) et des CONSTATS : des
 * conclusions déterministes tirées de règles vérifiables (ex. « paiement confirmé, jetons
 * crédités »). Un écart entre deux sources (paiement confirmé mais non crédité) est un constat
 * `needsHuman` : seul le support peut décider.
 */

export type InsightCode =
  | 'GAME_IN_PROGRESS'
  | 'GAME_WON_CREDITED'
  | 'GAME_WON_SETTLEMENT_PENDING'
  | 'GAME_WON_NOT_CREDITED'
  | 'GAME_WON_TOURNAMENT'
  | 'GAME_LOST'
  | 'GAME_NO_WINNER'
  | 'GAME_PLAYER_FLED'
  | 'GAME_NOT_FOUND'
  | 'NO_RECENT_GAMES'
  | 'WALLET_FUNDS_RESERVED'
  | 'WALLET_RECENT_STAKES'
  | 'WALLET_PENDING_OPERATIONS'
  | 'TRANSACTION_NOT_FOUND'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_CREDITED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_SUCCESS_NOT_CREDITED'
  | 'PAYMENT_NOT_FOUND'
  | 'NO_PAYMENTS'
  | 'WITHDRAWAL_IN_PROGRESS'
  | 'WITHDRAWAL_SUCCEEDED'
  | 'WITHDRAWAL_FAILED'
  | 'WITHDRAWAL_NOT_FOUND'
  | 'NO_WITHDRAWALS'
  | 'TOURNAMENT_PRIZE_PAID'
  | 'TOURNAMENT_PRIZE_NOT_PAID'
  | 'TOURNAMENT_NO_PRIZE'
  | 'TOURNAMENT_RESULTS_PENDING'
  | 'TOURNAMENT_REGISTRATION_CANCELLED'
  | 'TOURNAMENT_NOT_FOUND'
  | 'NO_TOURNAMENTS'
  | 'COMPLAINT_STATUS'
  | 'COMPLAINT_NOT_FOUND';

export interface Insight {
  code: InsightCode;
  /** Écart ou situation que seul le support peut trancher. */
  needsHuman: boolean;
  /** Valeurs issues des faits, citables telles quelles. */
  values: Record<string, string | number>;
}

export interface ToolResult {
  tool: AssistantToolName;
  outcome: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  facts: Record<string, unknown>;
  insights: Insight[];
}

const insight = (
  code: InsightCode,
  values: Record<string, string | number> = {},
  needsHuman = false,
): Insight => ({ code, needsHuman, values });

const RECENT = 5;

export function gameInsights(game: GameFacts): Insight[] {
  const insights: Insight[] = [];
  if (game.status !== 'finished') return [insight('GAME_IN_PROGRESS', { gameId: game.gameId })];
  if (game.playerFled) insights.push(insight('GAME_PLAYER_FLED', { gameId: game.gameId }));
  if (game.outcome === 'NO_WINNER')
    insights.push(insight('GAME_NO_WINNER', { gameId: game.gameId }));
  if (game.outcome === 'LOST') insights.push(insight('GAME_LOST', { gameId: game.gameId }));
  if (game.outcome === 'WON') {
    if (game.tournamentGame) {
      insights.push(insight('GAME_WON_TOURNAMENT', { gameId: game.gameId }));
    } else {
      const winnings = game.walletEntries.find(
        (e) => e.kind === 'game_winnings' && e.status === 'succeeded',
      );
      if (winnings) {
        insights.push(
          insight('GAME_WON_CREDITED', { gameId: game.gameId, tokens: winnings.tokens }),
        );
      } else if (game.settlement?.status === 'RESERVED') {
        insights.push(insight('GAME_WON_SETTLEMENT_PENDING', { gameId: game.gameId }));
      } else if (game.settlement?.status === 'SETTLED' && (game.settlement.netGain ?? 0) > 0) {
        // Règlement écrit sans écriture de gain du joueur : écart entre deux registres.
        insights.push(insight('GAME_WON_NOT_CREDITED', { gameId: game.gameId }, true));
      }
    }
  }
  return insights;
}

export function paymentInsights(payment: PaymentFacts): Insight[] {
  const values = { paymentId: payment.paymentId, amount: payment.amount, tokens: payment.tokens };
  if (payment.status === 'PENDING') return [insight('PAYMENT_PENDING', values)];
  if (payment.status === 'SUCCESS') {
    return payment.walletTransactionStatus === 'succeeded'
      ? [insight('PAYMENT_CREDITED', values)]
      : [insight('PAYMENT_SUCCESS_NOT_CREDITED', values, true)];
  }
  return [insight('PAYMENT_FAILED', { ...values, status: payment.status })];
}

export function withdrawalInsights(w: WithdrawalFacts): Insight[] {
  const values = { withdrawalId: w.withdrawalId, tokens: w.tokens, amount: w.amount };
  if (w.status === 'SUCCEEDED') return [insight('WITHDRAWAL_SUCCEEDED', values)];
  // Échec : le remboursement suit la procédure des retraits (D-075/D-076) ; le support vérifie.
  if (w.status === 'FAILED') return [insight('WITHDRAWAL_FAILED', values, true)];
  return [insight('WITHDRAWAL_IN_PROGRESS', values)];
}

export function tournamentInsights(t: TournamentFacts): Insight[] {
  const values = { tournamentId: t.tournamentId };
  if (t.registrationStatus === 'CANCELLED')
    return [insight('TOURNAMENT_REGISTRATION_CANCELLED', values)];
  if (!t.result) return [insight('TOURNAMENT_RESULTS_PENDING', values)];
  if (t.result.prizeAmount <= 0)
    return [insight('TOURNAMENT_NO_PRIZE', { ...values, rank: t.result.rank })];
  const prize = { ...values, rank: t.result.rank, amount: t.result.prizeAmount };
  if (t.result.paidAt) return [insight('TOURNAMENT_PRIZE_PAID', prize)];
  // Classement publié, gain non versé : un état normal pendant la distribution, mais seul le
  // support peut dire s'il y a un blocage (D-112).
  return [insight('TOURNAMENT_PRIZE_NOT_PAID', prize, t.tournamentStatus === 'COMPLETED')];
}

export class AssistantToolbox {
  constructor(private readonly evidence: ComplaintEvidenceRepository) {}

  /** Exécute un outil pour CE joueur ; une erreur technique devient un résultat `ERROR`. */
  async run(
    tool: AssistantToolName,
    userId: UserId,
    refs: ExtractedReferences,
  ): Promise<ToolResult> {
    try {
      return await this.execute(tool, userId, refs);
    } catch {
      return { tool, outcome: 'ERROR', facts: {}, insights: [] };
    }
  }

  private async execute(
    tool: AssistantToolName,
    userId: UserId,
    refs: ExtractedReferences,
  ): Promise<ToolResult> {
    const e = this.evidence;
    switch (tool) {
      case 'get_game': {
        if (!refs.gameId) return this.execute('list_recent_games', userId, refs);
        const game = await e.game(userId, refs.gameId);
        return game
          ? { tool, outcome: 'FOUND', facts: { game }, insights: gameInsights(game) }
          : { tool, outcome: 'NOT_FOUND', facts: {}, insights: [insight('GAME_NOT_FOUND')] };
      }
      case 'list_recent_games': {
        const games = await e.recentGames(userId, RECENT);
        return games.length > 0
          ? {
              tool,
              outcome: 'FOUND',
              facts: { games },
              insights: games.slice(0, 1).flatMap(gameInsights),
            }
          : {
              tool,
              outcome: 'NOT_FOUND',
              facts: { games: [] },
              insights: [insight('NO_RECENT_GAMES')],
            };
      }
      case 'get_wallet_history': {
        const wallet = await e.wallet(userId, 10);
        const insights: Insight[] = [];
        if (wallet.reserved > 0)
          insights.push(insight('WALLET_FUNDS_RESERVED', { reserved: wallet.reserved }));
        const stakes = wallet.entries.filter(
          (x) => x.kind === 'game_stake' && x.status === 'succeeded',
        );
        if (stakes.length > 0)
          insights.push(insight('WALLET_RECENT_STAKES', { count: stakes.length }));
        if (wallet.entries.some((x) => x.status === 'pending'))
          insights.push(insight('WALLET_PENDING_OPERATIONS'));
        const facts: Record<string, unknown> = { wallet };
        if (refs.transactionId) {
          const transaction = await e.walletTransaction(userId, refs.transactionId);
          if (transaction) facts.transaction = transaction;
          else insights.push(insight('TRANSACTION_NOT_FOUND'));
        }
        return { tool, outcome: 'FOUND', facts, insights };
      }
      case 'check_payment': {
        if (refs.paymentId) {
          const payment = await e.payment(userId, refs.paymentId);
          return payment
            ? { tool, outcome: 'FOUND', facts: { payment }, insights: paymentInsights(payment) }
            : { tool, outcome: 'NOT_FOUND', facts: {}, insights: [insight('PAYMENT_NOT_FOUND')] };
        }
        const payments = await e.recentPayments(userId, 3);
        return payments[0]
          ? { tool, outcome: 'FOUND', facts: { payments }, insights: paymentInsights(payments[0]) }
          : {
              tool,
              outcome: 'NOT_FOUND',
              facts: { payments: [] },
              insights: [insight('NO_PAYMENTS')],
            };
      }
      case 'check_withdrawal': {
        if (refs.withdrawalId) {
          const withdrawal = await e.withdrawal(userId, refs.withdrawalId);
          return withdrawal
            ? {
                tool,
                outcome: 'FOUND',
                facts: { withdrawal },
                insights: withdrawalInsights(withdrawal),
              }
            : {
                tool,
                outcome: 'NOT_FOUND',
                facts: {},
                insights: [insight('WITHDRAWAL_NOT_FOUND')],
              };
        }
        const withdrawals = await e.recentWithdrawals(userId, 3);
        return withdrawals[0]
          ? {
              tool,
              outcome: 'FOUND',
              facts: { withdrawals },
              insights: withdrawalInsights(withdrawals[0]),
            }
          : {
              tool,
              outcome: 'NOT_FOUND',
              facts: { withdrawals: [] },
              insights: [insight('NO_WITHDRAWALS')],
            };
      }
      case 'get_tournament_status': {
        if (refs.tournamentId) {
          const tournament = await e.tournament(userId, refs.tournamentId);
          return tournament
            ? {
                tool,
                outcome: 'FOUND',
                facts: { tournament },
                insights: tournamentInsights(tournament),
              }
            : {
                tool,
                outcome: 'NOT_FOUND',
                facts: {},
                insights: [insight('TOURNAMENT_NOT_FOUND')],
              };
        }
        const tournaments = await e.recentTournaments(userId, 3);
        return tournaments[0]
          ? {
              tool,
              outcome: 'FOUND',
              facts: { tournaments },
              insights: tournamentInsights(tournaments[0]),
            }
          : {
              tool,
              outcome: 'NOT_FOUND',
              facts: { tournaments: [] },
              insights: [insight('NO_TOURNAMENTS')],
            };
      }
      case 'get_complaint_status': {
        if (!refs.complaintReference) {
          return {
            tool,
            outcome: 'NOT_FOUND',
            facts: {},
            insights: [insight('COMPLAINT_NOT_FOUND')],
          };
        }
        const complaint = await e.complaintStatus(userId, refs.complaintReference);
        return complaint
          ? {
              tool,
              outcome: 'FOUND',
              facts: { complaint },
              insights: [
                insight('COMPLAINT_STATUS', {
                  reference: complaint.reference,
                  status: complaint.status,
                }),
              ],
            }
          : { tool, outcome: 'NOT_FOUND', facts: {}, insights: [insight('COMPLAINT_NOT_FOUND')] };
      }
    }
  }
}
