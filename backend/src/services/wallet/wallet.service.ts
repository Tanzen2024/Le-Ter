import { randomUUID } from 'node:crypto';

import {
  amountForTokens,
  DEPOSIT_AMOUNT_MESSAGE,
  DEPOSIT_LIMITS_XAF,
  DirectPaymentUnavailableError,
  isAllowedDepositAmount,
  operatorOfPhone,
  PaymentOperatorUnsupportedError,
  PAYMENT_CURRENCY,
  PaymentInitializationUncertainError,
  type DirectPayOperator,
  type Payment,
  type PaymentMode,
} from '../../domain/payments/payment';
import { isSupportedWithdrawalPhone } from '../../domain/wallet/withdrawal';
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
import { classifyPaymentFailure } from '../payments/payment-failure';
import type {
  WithdrawalAvailability,
  WithdrawalMode,
  WithdrawalUnavailableReason,
} from '../withdrawals/withdrawal-availability';
import {
  DepositOutcomeUnknownError,
  MobileMoneyProviderError,
  type MobileMoneyGateway,
} from './mobile-money.gateway';

/** Code d'échec enregistré quand le fournisseur refuse ou est indisponible à la demande. */
export const PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE';
/** Clé d'idempotence du repli « page CinetPay » d'une recharge directe refusée (D-090). */
const PAGE_FALLBACK_SUFFIX = ':page-fallback';

/** Code d'échec d'un paiement direct refusé par CinetPay (opérateur non autorisé…). */
export const DIRECT_PAYMENT_REFUSED = 'DIRECT_PAYMENT_REFUSED';

export interface WalletServiceDependencies {
  wallets: WalletRepository;
  users: UserRepository;
  gateway: MobileMoneyGateway;
  /** Paiements fournisseur (D-050) : relus pour rejouer un achat déjà initialisé. */
  payments?: PaymentRepository;
  /** Retraits (D-075, D-077) : état des nouveaux retraits (`WithdrawalService.availability`). */
  withdrawalAvailability?: () => WithdrawalAvailability;
  logger: Logger;
  clock?: () => Date;
}

/** Ce que le joueur voit d'un paiement (D-050) : jamais de référence ni de jeton fournisseur. */
export interface PaymentView {
  id: string;
  status: Payment['status'];
  amount: number;
  currency: Payment['currency'];
  /**
   * `DIRECT` : validation sur le téléphone, aucune page à ouvrir. `REDIRECT` : page CinetPay
   * (paiement classique, ou paiement direct pour lequel CinetPay exige une redirection).
   */
  mode: PaymentMode;
  /** Opérateur d'un paiement direct (MTN_CM…). */
  operator?: string;
  /** Page de paiement à ouvrir, tant que le paiement est en attente. */
  paymentUrl?: string;
}

export function toPaymentView(payment: Payment): PaymentView {
  const mode: PaymentMode = payment.paymentMethod && !payment.paymentUrl ? 'DIRECT' : 'REDIRECT';
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    mode,
    ...(payment.paymentMethod && { operator: payment.paymentMethod }),
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
  /** Montant d'achat saisi : entier en FCFA dans ces limites (D-085), revalidé par le serveur. */
  depositLimits: { min: number; max: number; currency: 'XAF' };
  /**
   * Opérateurs proposés en paiement DIRECT sur le numéro d'inscription (validation sur le
   * téléphone, sans page de paiement). Vide : page CinetPay seulement (mode direct non activé,
   * ou numéro hors Cameroun).
   */
  directPayOperators: DirectPayOperator[];
  /**
   * Opérateurs présélectionnés sur la page CinetPay (D-087). Absent de la liste : la page
   * propose toutes les méthodes du pays activées sur le compte, sans garantie d'opérateur.
   */
  pageOperators: DirectPayOperator[];
  /**
   * Moyen de paiement du compte (D-090), déduit par le serveur du numéro d'inscription :
   * MTN_CM ou OM_CM ; `null` = numéro non pris en charge (aucun paiement proposé).
   */
  paymentOperator: DirectPayOperator | null;
  /** Nouveaux retraits acceptés, en sandbox ou en production (D-075, D-077). */
  withdrawalAvailable: boolean;
  /** `sandbox` : transferts simulés par CinetPay, aucun fonds réel. */
  withdrawalMode: WithdrawalMode;
  /** Motif stable quand `withdrawalMode` vaut `unavailable` (jamais de détail de configuration). */
  withdrawalUnavailableReason?: WithdrawalUnavailableReason;
}

/**
 * Compte de jeu (D-040) : solde en jetons, achats (Mobile Money → compte de jeu) et retraits
 * (compte de jeu → Mobile Money personnel, numéro d'inscription). Le serveur est la seule
 * source de vérité ; chaque opération est une transaction enregistrée et idempotente
 * (une Idempotency-Key = une opération).
 *
 * - Achat : transaction en attente → demande de paiement au fournisseur → crédit SEULEMENT
 *   quand le fournisseur confirme (`settle`).
 * - Retrait : `WithdrawalService` (D-075) — quota, débit atomique, transfert CinetPay relu,
 *   remboursement unique d'un échec confirmé.
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
      depositLimits: { ...DEPOSIT_LIMITS_XAF, currency: PAYMENT_CURRENCY },
      directPayOperators:
        user && isSupportedWithdrawalPhone(user.phone)
          ? [...(this.deps.gateway.directPayOperators ?? [])]
          : [],
      pageOperators: [...(this.deps.gateway.pagePreselectOperators ?? [])],
      paymentOperator: user ? operatorOfPhone(user.phone) : null,
      ...withdrawalState(this.deps.withdrawalAvailability?.()),
    };
  }

  /**
   * Recharge AUTOMATIQUE (D-090) : `tokens` jetons payés en FCFA (1 FCFA = 1 jeton, montant
   * saisi revalidé, D-085). Le moyen de paiement est déduit par le SERVEUR du numéro
   * d'inscription (`operatorOfPhone`), jamais choisi par l'application :
   * 1. paiement DIRECT si l'opérateur y est ouvert (`CINETPAY_DIRECT_PAY_METHODS`) ;
   * 2. page CinetPay (même opérateur) SEULEMENT si le direct est refusé de façon CERTAINE
   *    (`DirectPaymentUnavailableError` : rien créé, ou paiement clos sans crédit), sous une clé
   *    d'idempotence dérivée : un rejeu retrouve la même page, jamais un second paiement ;
   * 3. issue incertaine du direct (paiement en attente) : renvoyée telle quelle, aucun repli ;
   *    direct accepté puis clos SANS débit (FAILED, EXPIRED relus chez CinetPay) : une nouvelle
   *    demande du même achat (même clé) passe par la page CinetPay (D-134) ;
   * 4. service indisponible : erreur, aucun repli (même fournisseur), rien crédité.
   * `requested` (opérateur envoyé par l'application) est refusé s'il diffère du compte.
   */
  async requestDeposit(
    userId: UserId,
    tokens: number,
    idempotencyKey: string,
    requested: { directOperator?: DirectPayOperator; pageOperator?: DirectPayOperator } = {},
  ): Promise<WalletOperationResult> {
    if (!isAllowedDepositAmount(amountForTokens(tokens))) {
      throw new ValidationError({ tokens: DEPOSIT_AMOUNT_MESSAGE });
    }
    const user = await this.deps.users.findById(userId);
    if (!user) throw new ValidationError({ user: 'Compte introuvable.' });
    const operator = operatorOfPhone(user.phone);
    if (!operator) throw new PaymentOperatorUnsupportedError();
    for (const [field, value] of [
      ['method', requested.directOperator],
      ['operator', requested.pageOperator],
    ] as const) {
      if (value !== undefined && value !== operator) {
        throw new ValidationError({
          [field]: 'Le moyen de paiement est déterminé par le numéro de votre compte.',
        });
      }
    }
    if (!this.deps.gateway.directPayOperators?.includes(operator)) {
      return this.request('deposit', userId, tokens, idempotencyKey, { pageOperator: operator });
    }
    try {
      const direct = await this.request('deposit', userId, tokens, idempotencyKey, {
        directOperator: operator,
      });
      // Direct ACCEPTÉ puis clos par CinetPay sans débit (FAILED, EXPIRED : statut final relu
      // chez le fournisseur, achat échoué, rien crédité) : le même achat (même clé) passe
      // automatiquement par la page CinetPay (D-134). Jamais pour un direct encore en attente :
      // il peut toujours être confirmé sur le téléphone (aucun double paiement).
      if (
        direct.payment?.mode === 'DIRECT' &&
        (direct.payment.status === 'FAILED' || direct.payment.status === 'EXPIRED') &&
        direct.transaction.status === 'failed'
      ) {
        this.deps.logger.info('direct payment closed without debit: hosted page fallback', {
          userId,
          operator,
          paymentStatus: direct.payment.status,
        });
        return this.request('deposit', userId, tokens, `${idempotencyKey}${PAGE_FALLBACK_SUFFIX}`, {
          pageOperator: operator,
        });
      }
      return direct;
    } catch (err) {
      if (!(err instanceof DirectPaymentUnavailableError)) throw err;
      this.deps.logger.info('direct payment refused: hosted page fallback', {
        userId,
        operator,
        reason: err.reason,
      });
      return this.request('deposit', userId, tokens, `${idempotencyKey}${PAGE_FALLBACK_SUFFIX}`, {
        pageOperator: operator,
      });
    }
  }

  /**
   * Issue décidée par le fournisseur (rappel). Idempotent : une transaction déjà réglée
   * n'est jamais modifiée une seconde fois.
   */
  settle(transactionId: string, outcome: SettlementOutcome): Promise<WalletTransaction> {
    return this.deps.wallets.settle(transactionId, outcome, this.clock());
  }

  /** Achat. Les retraits passent par `WithdrawalService` (D-075), jamais par ce chemin. */
  private async request(
    kind: 'deposit',
    userId: UserId,
    tokens: number,
    idempotencyKey: string,
    {
      directOperator,
      pageOperator,
    }: { directOperator?: DirectPayOperator; pageOperator?: DirectPayOperator } = {},
  ): Promise<WalletOperationResult> {
    // Opérateur réellement retenu (direct, ou présélectionné sur la page) : partie de l'identité
    // de l'opération pour l'idempotence.
    const preselected =
      pageOperator && this.deps.gateway.pagePreselectOperators?.includes(pageOperator)
        ? pageOperator
        : undefined;
    const chosenOperator = directOperator ?? preselected;
    if (!isValidTokenAmount(tokens)) {
      throw new ValidationError({
        tokens: 'Le nombre de jetons doit être un entier supérieur à 0.',
      });
    }
    const log = this.deps.logger.child({ userId, action: `WALLET_${kind.toUpperCase()}` });
    const replayed = await this.replay(kind, userId, tokens, idempotencyKey, chosenOperator);
    if (replayed) return replayed;

    const user = await this.deps.users.findById(userId);
    if (!user) throw new ValidationError({ user: 'Compte introuvable.' });
    // Le numéro du payeur est TOUJOURS celui de l'inscription (D-088), jamais celui du client.
    const customer = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
    };
    // Exigences du fournisseur sur le payeur : vérifiées avant toute écriture.
    this.deps.gateway.assertCollectionEligible?.(customer);
    if (directOperator) {
      if (!this.deps.gateway.assertDirectPayEligible) {
        throw new DirectPaymentUnavailableError('METHOD_NOT_ENABLED');
      }
      this.deps.gateway.assertDirectPayEligible(directOperator, user.phone);
    }

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
      await this.deps.wallets.createPendingDeposit(transaction);
    } catch (err) {
      if (err instanceof DuplicateIdempotencyKeyError) {
        // Double soumission simultanée : l'autre requête a créé l'opération.
        const existing = await this.replay(kind, userId, tokens, idempotencyKey, chosenOperator);
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
      ...(directOperator && { directOperator }),
      ...(!directOperator && pageOperator && { pageOperator }),
    };
    try {
      const { providerReference, paymentId, paymentUrl } =
        await this.deps.gateway.requestCollection(request);
      // Toujours en attente : seule la confirmation du fournisseur règle l'opération.
      const pending = await this.deps.wallets.findById(transaction.id);
      const withReference = { ...(pending ?? transaction), providerReference };
      // Paiement direct lancé sur le téléphone : pas de page. Sinon (page classique, ou
      // redirection exigée par CinetPay) : la page à ouvrir.
      const payment: PaymentView | undefined =
        paymentId && (paymentUrl || directOperator)
          ? {
              id: paymentId,
              status: 'PENDING',
              amount: amountForTokens(tokens),
              currency: PAYMENT_CURRENCY,
              mode: paymentUrl ? 'REDIRECT' : 'DIRECT',
              ...(chosenOperator && { operator: chosenOperator }),
              ...(paymentUrl && { paymentUrl }),
            }
          : undefined;
      return {
        transaction: withReference,
        balance: await this.deps.wallets.getBalance(userId),
        ...(payment && { payment }),
      };
    } catch (err) {
      if (err instanceof PaymentInitializationUncertainError) {
        // Paiement direct parti sans réponse : il a peut-être atteint le téléphone. L'achat
        // reste EN ATTENTE (ni crédit ni échec) ; la réconciliation tranche chez CinetPay.
        log.warn('direct payment initialization uncertain', { transactionId: transaction.id });
        const payment = await this.deps.payments?.findByWalletTransactionId(transaction.id);
        return {
          transaction: (await this.deps.wallets.findById(transaction.id)) ?? transaction,
          balance: await this.deps.wallets.getBalance(userId),
          ...(payment && { payment: toPaymentView(payment) }),
        };
      }
      if (
        !(err instanceof DirectPaymentUnavailableError) &&
        !(err instanceof MobileMoneyProviderError)
      ) {
        // Erreur INTERNE (base indisponible…) pendant la création : la demande a pu partir chez
        // le fournisseur. Rien n'est déclaré échoué (aucune écriture risquée), rien n'est
        // crédité ; un paiement direct est déjà marqué « initialisation incertaine » et la
        // réconciliation le retrouve chez CinetPay (D-091).
        log.error('deposit outcome unknown: internal error during creation', {
          transactionId: transaction.id,
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message.slice(0, 200) : undefined,
        });
        throw new DepositOutcomeUnknownError(transaction.id);
      }
      log.warn('mobile money request failed', {
        transactionId: transaction.id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      if (err instanceof DirectPaymentUnavailableError) {
        // Refus explicite de l'opérateur ou du compte : achat abandonné, rien de crédité ; le
        // joueur peut payer par la page CinetPay (nouvelle demande).
        await this.settle(transaction.id, {
          status: 'failed',
          failureCode: DIRECT_PAYMENT_REFUSED,
        });
        throw err;
      }
      // Échec immédiat : achat abandonné (rien n'a été crédité). Cause classée (D-100) :
      // configuration, accès refusé, réseau, délai, incident ou refus du fournisseur.
      const { category, retryable } = classifyPaymentFailure(err);
      await this.settle(transaction.id, { status: 'failed', failureCode: PROVIDER_UNAVAILABLE });
      throw new MobileMoneyUnavailableError(transaction.id, { category, retryable });
    }
  }

  /** Même Idempotency-Key : même opération, même issue ; autre opération : refus. */
  private async replay(
    kind: WalletTransactionKind,
    userId: UserId,
    tokens: number,
    idempotencyKey: string,
    chosenOperator?: DirectPayOperator,
  ): Promise<WalletOperationResult | undefined> {
    const existing = await this.deps.wallets.findByIdempotencyKey(userId, idempotencyKey);
    if (!existing) return undefined;
    if (existing.kind !== kind || existing.tokens !== tokens) {
      throw new IdempotencyKeyReusedError();
    }
    if (existing.status === 'failed' && existing.failureCode === PROVIDER_UNAVAILABLE) {
      throw new MobileMoneyUnavailableError(existing.id);
    }
    if (existing.status === 'failed' && existing.failureCode === DIRECT_PAYMENT_REFUSED) {
      throw new DirectPaymentUnavailableError('PROVIDER_REFUSED');
    }
    const payment =
      kind === 'deposit' ? await this.deps.payments?.findByWalletTransactionId(existing.id) : null;
    // Même clé, autre mode de paiement (direct ↔ page, autre opérateur) : autre opération.
    if (payment && (payment.paymentMethod ?? undefined) !== chosenOperator) {
      throw new IdempotencyKeyReusedError();
    }
    return {
      transaction: existing,
      balance: await this.deps.wallets.getBalance(userId),
      ...(payment && { payment: toPaymentView(payment) }),
    };
  }
}

/** Retraits annoncés au joueur ; sans service de retrait : indisponibles. */
function withdrawalState(
  availability: WithdrawalAvailability | undefined,
): Pick<WalletView, 'withdrawalAvailable' | 'withdrawalMode' | 'withdrawalUnavailableReason'> {
  const mode = availability?.mode ?? 'unavailable';
  const reason =
    mode === 'unavailable' ? (availability?.reason ?? 'PROVIDER_NOT_CONFIGURED') : undefined;
  return {
    withdrawalAvailable: mode !== 'unavailable',
    withdrawalMode: mode,
    ...(reason && { withdrawalUnavailableReason: reason }),
  };
}
