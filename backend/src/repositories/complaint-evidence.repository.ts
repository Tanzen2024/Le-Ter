import type { UserId } from '../domain/users/user';

/**
 * Lectures en LECTURE SEULE, toujours bornées au joueur (`userId` issu du jeton vérifié),
 * utilisées par les outils de l'assistant et par la vue « éléments liés » de l'administration
 * (D-114). Un élément qui n'appartient pas au joueur est rendu comme INEXISTANT (null) : aucune
 * distinction qui révélerait l'existence de données d'un autre joueur.
 *
 * Données minimisées : ni téléphone, ni email, ni pseudo d'un autre joueur, ni référence
 * marchande, ni empreinte de jeton. Les montants viennent des tables qui font autorité.
 */

export interface GameFacts {
  gameId: string;
  status: 'waiting' | 'in_progress' | 'finished';
  startedAt: string | null;
  finishedAt: string | null;
  endReason: string | null;
  /** Résultat du point de vue du joueur ; null tant que la partie n'est pas finie. */
  outcome: 'WON' | 'LOST' | 'NO_WINNER' | null;
  playerFled: boolean;
  opponents: number;
  /** Partie de tournoi : jetons du tournoi, jamais le compte de jeu réel (D-111). */
  tournamentGame: boolean;
  stake: number | null;
  settlement: {
    status: 'RESERVED' | 'SETTLED' | 'VOID';
    outcome: string | null;
    netGain: number | null;
    unitAmount: number | null;
    settledAt: string | null;
  } | null;
  /** Écritures du compte de jeu RÉEL liées à cette partie, pour ce joueur. */
  walletEntries: { kind: string; status: string; tokens: number; at: string }[];
}

export interface WalletEntryFacts {
  transactionId: string;
  kind: string;
  status: string;
  tokens: number;
  createdAt: string;
  completedAt: string | null;
  failureCode: string | null;
  gameId: string | null;
}

export interface WalletFacts {
  balance: number;
  reserved: number;
  available: number;
  entries: WalletEntryFacts[];
}

export interface PaymentFacts {
  paymentId: string;
  status: string;
  amount: number;
  currency: string;
  operator: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Statut de l'écriture du compte de jeu : `succeeded` = jetons réellement crédités. */
  walletTransactionStatus: string;
  tokens: number;
}

export interface WithdrawalFacts {
  withdrawalId: string;
  status: string;
  tokens: number;
  amount: number;
  operator: string;
  createdAt: string;
  completedAt: string | null;
  failureCode: string | null;
  walletTransactionStatus: string;
}

export interface TournamentFacts {
  tournamentId: string;
  tournamentStatus: string;
  startsAt: string;
  endsAt: string;
  registrationStatus: string | null;
  registeredAt: string | null;
  cancelledAt: string | null;
  result: {
    rank: number;
    prizeAmount: number;
    paidAt: string | null;
  } | null;
}

export interface ComplaintStatusFacts {
  reference: string;
  status: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintEvidenceRepository {
  game(userId: UserId, gameId: string): Promise<GameFacts | null>;
  recentGames(userId: UserId, limit: number): Promise<GameFacts[]>;
  wallet(userId: UserId, limit: number): Promise<WalletFacts>;
  walletTransaction(userId: UserId, transactionId: string): Promise<WalletEntryFacts | null>;
  payment(userId: UserId, paymentId: string): Promise<PaymentFacts | null>;
  recentPayments(userId: UserId, limit: number): Promise<PaymentFacts[]>;
  withdrawal(userId: UserId, withdrawalId: string): Promise<WithdrawalFacts | null>;
  recentWithdrawals(userId: UserId, limit: number): Promise<WithdrawalFacts[]>;
  tournament(userId: UserId, tournamentId: string): Promise<TournamentFacts | null>;
  recentTournaments(userId: UserId, limit: number): Promise<TournamentFacts[]>;
  complaintStatus(userId: UserId, reference: string): Promise<ComplaintStatusFacts | null>;
  /** Le paiement est-il celui du joueur ? (lien d'une réclamation) */
  ownsPayment(userId: UserId, paymentId: string): Promise<boolean>;
  ownsWithdrawal(userId: UserId, withdrawalId: string): Promise<boolean>;
  ownsWalletTransaction(userId: UserId, transactionId: string): Promise<boolean>;
  /** Le joueur a-t-il pris part à la partie ? */
  playedGame(userId: UserId, gameId: string): Promise<boolean>;
  /** Le joueur est-il (ou a-t-il été) inscrit au tournoi ? */
  joinedTournament(userId: UserId, tournamentId: string): Promise<boolean>;
}
