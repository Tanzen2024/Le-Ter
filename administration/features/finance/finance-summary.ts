import type { FinanceOverview, ReservationStatus, WalletKind, WalletStatus } from '@/types/admin';

/**
 * Synthèses des cartes de détail des finances, calculées UNIQUEMENT à partir de
 * `finance/overview` (aucune valeur inventée, aucune addition entre FCFA des paiements,
 * jetons des comptes de jeu et recettes de la plateforme).
 */

export interface CountAmount {
  count: number;
  amount: number;
}

const ZERO: CountAmount = { count: 0, amount: 0 };
const add = (a: CountAmount, b: CountAmount): CountAmount => ({
  count: a.count + b.count,
  amount: a.amount + b.amount,
});

// --- Carte 9 : achats CinetPay par statut ---------------------------------------------------

export const PAYMENT_STATUSES = ['SUCCESS', 'PENDING', 'FAILED', 'EXPIRED'] as const;

/**
 * Les quatre statuts (exclusifs : un paiement n'en a qu'un), toujours affichés, zéro compris ;
 * un statut inconnu renvoyé par l'API est ajouté tel quel, jamais masqué.
 */
export function purchasesByStatus(
  o: FinanceOverview,
): { status: string; count: number; amount: number }[] {
  const known = PAYMENT_STATUSES.map((status) => {
    const row = o.purchases.byStatus.find((p) => p.status === status);
    return { status, count: row?.count ?? 0, amount: row?.amount ?? 0 };
  });
  const unknown = o.purchases.byStatus.filter(
    (p) => !(PAYMENT_STATUSES as readonly string[]).includes(p.status),
  );
  return [
    ...known,
    ...unknown.map((p) => ({ status: p.status, count: p.count, amount: p.amount })),
  ];
}

export function purchasesTotal(o: FinanceOverview): CountAmount {
  return o.purchases.byStatus.reduce((t, p) => add(t, p), ZERO);
}

// --- Carte 10 : mouvements des comptes de jeu ------------------------------------------------

export type MovementGroup = 'credit' | 'debit' | 'pending' | 'failed';

export const MOVEMENT_GROUPS: Record<MovementGroup, string> = {
  credit: 'Crédits effectifs',
  debit: 'Débits effectifs',
  pending: 'En attente (non réglés)',
  failed: 'Échoués ou refusés',
};

/** Effet d'une opération RÉUSSIE sur le solde du joueur. */
const DIRECTION: Record<WalletKind, 'credit' | 'debit'> = {
  deposit: 'credit',
  tournament_prize: 'credit',
  tournament_entry: 'debit',
  withdrawal: 'debit',
};

export function movementGroup(status: WalletStatus, kind: WalletKind): MovementGroup {
  if (status === 'succeeded') return DIRECTION[kind];
  return status === 'pending' ? 'pending' : 'failed';
}

const KIND_LABEL: Record<WalletKind, string> = {
  deposit: 'Achats de jetons (CinetPay)',
  withdrawal: 'Retraits',
  tournament_entry: 'Inscriptions de tournoi',
  tournament_prize: 'Gains de tournoi',
};

export interface MovementLine {
  group: MovementGroup;
  label: string;
  count: number;
  tokens: number;
}

/**
 * Mouvements regroupés en crédits, débits, attente et échecs. Les achats SANS paiement
 * CinetPay (refusés avant l'appel au fournisseur) ont leur propre ligne : ce ne sont pas
 * des achats CinetPay échoués.
 */
export function movementLines(o: FinanceOverview): MovementLine[] {
  const order: MovementGroup[] = ['credit', 'debit', 'pending', 'failed'];
  return o.walletMovements
    .map((m) => ({
      group: movementGroup(m.status, m.kind),
      label: m.withoutPayment
        ? 'Achats refusés avant CinetPay (aucun paiement)'
        : (KIND_LABEL[m.kind] ?? m.kind),
      count: m.count,
      tokens: m.tokens,
    }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

export function movementTotals(
  o: FinanceOverview,
): Record<MovementGroup, { count: number; tokens: number }> {
  const totals = {
    credit: { count: 0, tokens: 0 },
    debit: { count: 0, tokens: 0 },
    pending: { count: 0, tokens: 0 },
    failed: { count: 0, tokens: 0 },
  };
  for (const line of movementLines(o)) {
    totals[line.group].count += line.count;
    totals[line.group].tokens += line.tokens;
  }
  return totals;
}

export const RESERVATION_LABEL: Record<ReservationStatus, string> = {
  ACTIVE: 'Réservées (non débitées)',
  CAPTURED: 'Capturées (débit compté dans les inscriptions)',
  RELEASED: 'Libérées',
  EXPIRED: 'Expirées',
};

// --- Carte 12 : rapprochement ----------------------------------------------------------------

/** Statut attendu de l'achat du compte de jeu pour chaque statut de paiement CinetPay. */
const EXPECTED_WALLET_STATUS: Record<string, WalletStatus> = {
  SUCCESS: 'succeeded',
  PENDING: 'pending',
  FAILED: 'failed',
  EXPIRED: 'failed',
};

export interface PaymentMatch {
  walletStatus: WalletStatus;
  payments: CountAmount;
  deposits: { count: number; tokens: number };
  /** Même nombre d'opérations et même montant (1 FCFA = 1 jeton, D-050). */
  matches: boolean;
}

/**
 * Paiements CinetPay de la période face aux achats du compte de jeu qui leur sont rattachés
 * (même statut attendu). Un écart s'affiche tel quel : il n'est jamais corrigé ici.
 */
export function paymentMatches(o: FinanceOverview): PaymentMatch[] {
  const statuses: WalletStatus[] = ['succeeded', 'pending', 'failed'];
  return statuses.map((walletStatus) => {
    const payments = o.purchases.byStatus
      .filter((p) => EXPECTED_WALLET_STATUS[p.status] === walletStatus)
      .reduce((t, p) => add(t, p), ZERO);
    const deposits = o.walletMovements
      .filter((m) => m.kind === 'deposit' && !m.withoutPayment && m.status === walletStatus)
      .reduce((t, m) => ({ count: t.count + m.count, tokens: t.tokens + m.tokens }), {
        count: 0,
        tokens: 0,
      });
    return {
      walletStatus,
      payments,
      deposits,
      matches: payments.count === deposits.count && payments.amount === deposits.tokens,
    };
  });
}

/** Achats du compte de jeu sans aucun paiement CinetPay rattaché. */
export function depositsWithoutPayment(o: FinanceOverview): { count: number; tokens: number } {
  return o.walletMovements
    .filter((m) => m.kind === 'deposit' && m.withoutPayment)
    .reduce((t, m) => ({ count: t.count + m.count, tokens: t.tokens + m.tokens }), {
      count: 0,
      tokens: 0,
    });
}

/** Le total des recettes renvoyé égale-t-il la somme de ses natures ? */
export function revenueConsistent(o: FinanceOverview): boolean {
  return o.platformRevenue.byKind.reduce((t, k) => t + k.amount, 0) === o.platformRevenue.total;
}

/**
 * Montants au-delà de la précision exacte d'un nombre JSON (2^53 − 1) : ils seraient
 * arrondis. Signalés, jamais affichés comme exacts.
 */
export function unsafeAmounts(o: FinanceOverview): string[] {
  const values: [string, number][] = [
    ...o.purchases.byStatus.map((p): [string, number] => [`Paiements ${p.status}`, p.amount]),
    ...o.walletMovements.map((m): [string, number] => [
      `Mouvements ${m.kind}/${m.status}`,
      m.tokens,
    ]),
    ...o.reservations.map((r): [string, number] => [`Réservations ${r.status}`, r.amount]),
    ...o.platformRevenue.byKind.map((k): [string, number] => [`Recettes ${k.kind}`, k.amount]),
    ['Recettes (total)', o.platformRevenue.total],
    ['Soldes des joueurs', o.playerBalances.balance],
    ['Réservé', o.playerBalances.reserved],
    ['Solde comptable', o.platformAccountBalance],
  ];
  return values.filter(([, v]) => !Number.isSafeInteger(v)).map(([name]) => name);
}
