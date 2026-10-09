import { randomUUID } from 'node:crypto';

import {
  amountForTokens,
  DEPOSIT_AMOUNTS_XAF,
  isAllowedDepositAmount,
  PAYMENT_CURRENCY,
  type Payment,
} from '../../domain/payments/payment';
import type { UserId } from '../../domain/users/user';
import {
  IdempotencyKeyReusedError,
  isValidTokenAmount,
  maskPhone,
  MobileMoneyUnavailableError,
  type WalletTransaction,
  type WalletTransactionKind,
} from '../../domain/wallet/wallet';
import type { PaymentRepository } from '../../repositories/payment.repository';
import type { UserRepository } from '../../repositories/user.repository';
import {
  DuplicateIdempotencyKeyError,
  type SettlementOutcome,
  type WalletRepository,
} from '../../repositories/wallet.repository';
import type { Logger } from '../../utils/logger';
import { ValidationError } from '../../validators/validation-error';
import type { MobileMoneyGateway } from './mobile-money.gateway';

/** Code d'échec enregistré quand le fournisseur refuse ou est indisponible à la demande. */
export const PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE';

export interface WalletServiceDependencies {
  wallets: WalletRepository;
  users: UserRepository;
  gateway: MobileMoneyGateway;
  /** Paiements fournisseur (D-050) : relus pour rejouer un achat déjà initialisé. */
  payments?: PaymentRepository;
  logger: Logger;
  clock?: () => Date;
}

/** Ce que le joueur voit d'un paiement (D-050) : jamais de référence ni de jeton fournisseur. */
export interface PaymentView {
  id: string;
  status: Payment['status'];
  amount: number;
  currency: Payment['currency'];
  /** Page de paiement à ouvrir, tant que le paiement est en attente. */
  paymentUrl?: string;
}

export function toPaymentView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    ...(payment.status === 'PENDING' && payment.paymentUrl && { paymentUrl: payment.paymentUrl }),
  };
}

export interface WalletOperationResult {
  transaction: WalletTransaction;
  balance: number;
  /** Achat par page de paiement hébergée (CinetPay). */
  payment?: PaymentView;
}

/** Ce que le joueur voit de son compte de jeu. */
export interface WalletView {
  /** Solde total du compte de jeu. */
  balance: number;
  /** Bloqué par des inscriptions à des tournois non démarrés (D-054). */
  reserved: number;
  /** Utilisable : solde − réservé. */
  available: number;
  /** Numéro Mobile Money (d'inscription), masqué. */
  mobileMoneyNumber: string;
  phoneVerified: boolean;
  /** Faux tant qu'aucun fournisseur Mobile Money n'est configuré. */
  mobileMoneyAvailable: boolean;
  /** Faux si le fournisseur ne gère pas les retraits (CinetPay : achat seulement, D-050). */
  withdrawalAvailable: boolean;
}

/**
 * Compte de jeu (D-040) : solde en jetons, achats (Mobile Money → compte de jeu) et retraits
 * (compte de jeu → Mobile Money personnel, numéro d'inscription). Le serveur est la seule
 * source de vérité ; chaque opération est une transaction enregistrée et idempotente
 * (une Idempotency-Key = une opération).
 *
 * - Achat : transaction en attente → demande de paiement au fournisseur → crédit SEULEMENT
 *   quand le fournisseur confirme (`settle`).
 * - Retrait : solde vérifié et débité sous verrou → demande de transfert → succès confirmé
 *   par le fournisseur, ou échec et remboursement.
 *
 * Le numéro de téléphone n'est jamais journalisé.
 */
export class WalletService {
  private readonly clock: () => Date;

  constructor(private readonly deps: WalletServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async getWallet(userId: UserId): Promise<WalletView> {
    const [{ balance, reserved, available }, user] = await Promise.all([
      this.deps.wallets.getBalances(userId),
      this.deps.users.findById(userId),
    ]);
    return {
      balance,
      reserved,
      available,
      mobileMoneyNumber: user ? maskPhone(user.phone) : '',
      phoneVerified: user?.phoneVerified ?? false,
      mobileMoneyAvailable: this.deps.gateway.available,
      withdrawalAvailable: this.withdrawalAvailable(),
    };
  }

  /** Vrai seulement si un fournisseur configuré gère les retraits. */
  private withdrawalAvailable(): boolean {
    return this.deps.gateway.available && this.deps.gateway.disbursementAvailable !== false;
  }

  /**
   * Achat de `tokens` jetons, payés en FCFA (1 FCFA = 1 jeton) parmi les montants autorisés
   * (D-050 : 500, 1 000, 2 000, 5 000).
   */
  requestDeposit(userId: UserId, tokens: number, idempotencyKey: string) {
    if (isValidTokenAmount(tokens) && !isAllowedDepositAmount(amountForTokens(tokens))) {
      throw new ValidationError({
        tokens: `Montant non autorisé. Montants possibles : ${DEPOSIT_AMOUNTS_XAF.join(', ')} FCFA.`,
      });
    }
    return this.request('deposit', userId, tokens, idempotencyKey);
  }

  /** Retrait de `tokens` jetons vers le compte Mobile Money du joueur. */
  requestWithdrawal(userId: UserId, tokens: number, idempotencyKey: string) {
    return this.request('withdrawal', userId, tokens, idempotencyKey);
  }

  /**
   * Issue décidée par le fournisseur (rappel). Idempotent : une transaction déjà réglée
   * n'est jamais modifiée une seconde fois.
   */
  settle(transactionId: string, outcome: SettlementOutcome): Promise<WalletTransaction> {
    return this.deps.wallets.settle(transactionId, outcome, this.clock());
  }

  private async request(
    kind: WalletTransactionKind,
    userId: UserId,
    tokens: number,
    idempotencyKey: string,
  ): Promise<WalletOperationResult> {
    if (!isValidTokenAmount(tokens)) {
      throw new ValidationError({
        tokens: 'Le nombre de jetons doit être un entier supérieur à 0.',
      });
    }
    const log = this.deps.logger.child({ userId, action: `WALLET_${kind.toUpperCase()}` });
    const replayed = await this.replay(kind, userId, tokens, idempotencyKey);
    if (replayed) return replayed;
    // Fournisseur incapable de transférer (aucun, ou CinetPay : achat seulement) : refus
    // AVANT toute écriture — ni débit temporaire, ni transaction enregistrée.
    if (kind === 'withdrawal' && !this.withdrawalAvailable()) {
      throw new MobileMoneyUnavailableError();
    }

    const user = await this.deps.users.findById(userId);
    if (!user) throw new ValidationError({ user: 'Compte introuvable.' });
    const customer = { firstName: user.firstName, lastName: user.lastName, email: user.email };
    // Exigences du fournisseur sur le payeur : vérifiées avant toute écriture.
    if (kind === 'deposit') this.deps.gateway.assertCollectionEligible?.(customer);

    const now = this.clock();
    const transaction: WalletTransaction = {
      id: randomUUID(),
      userId,
      kind,
      status: 'pending',
      tokens,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    try {
      if (kind === 'deposit') {
        await this.deps.wallets.createPendingDeposit(transaction);
      } else {
        // Lève InsufficientBalanceError : le solde n'est jamais rendu négatif.
        await this.deps.wallets.createPendingWithdrawal(transaction);
      }
    } catch (err) {
      if (err instanceof DuplicateIdempotencyKeyError) {
        // Double soumission simultanée : l'autre requête a créé l'opération.
        const existing = await this.replay(kind, userId, tokens, idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
    log.info('wallet transaction created', { transactionId: transaction.id, tokens });

    const request = {
      transactionId: transaction.id,
      msisdn: user.phone,
      tokens,
      customer,
    };
    try {
      const { providerReference, paymentId, paymentUrl } =
        kind === 'deposit'
          ? await this.deps.gateway.requestCollection(request)
          : await this.deps.gateway.requestDisbursement(request);
      // Toujours en attente : seule la confirmation du fournisseur règle l'opération.
      const pending = await this.deps.wallets.findById(transaction.id);
      const withReference = { ...(pending ?? transaction), providerReference };
      const payment =
        paymentId && paymentUrl
          ? {
              id: paymentId,
              status: 'PENDING' as const,
              amount: amountForTokens(tokens),
              currency: PAYMENT_CURRENCY,
              paymentUrl,
            }
          : undefined;
      return {
        transaction: withReference,
        balance: await this.deps.wallets.getBalance(userId),
        ...(payment && { payment }),
      };
    } catch (err) {
      log.warn('mobile money request failed', {
        transactionId: transaction.id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      // Échec immédiat : achat abandonné ; retrait remboursé (même transaction SQL).
      await this.settle(transaction.id, { status: 'failed', failureCode: PROVIDER_UNAVAILABLE });
      throw new MobileMoneyUnavailableError(transaction.id);
    }
  }

  /** Même Idempotency-Key : même opération, même issue ; autre opération : refus. */
  private async replay(
    kind: WalletTransactionKind,
    userId: UserId,
    tokens: number,
    idempotencyKey: string,
  ): Promise<WalletOperationResult | undefined> {
    const existing = await this.deps.wallets.findByIdempotencyKey(userId, idempotencyKey);
    if (!existing) return undefined;
    if (existing.kind !== kind || existing.tokens !== tokens) {
      throw new IdempotencyKeyReusedError();
    }
    if (existing.status === 'failed' && existing.failureCode === PROVIDER_UNAVAILABLE) {
      throw new MobileMoneyUnavailableError(existing.id);
    }
    const payment =
      kind === 'deposit' ? await this.deps.payments?.findByWalletTransactionId(existing.id) : null;
    return {
      transaction: existing,
      balance: await this.deps.wallets.getBalance(userId),
      ...(payment && { payment: toPaymentView(payment) }),
    };
  }
}
