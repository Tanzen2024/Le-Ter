'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, CreditCard, HandCoins, Layers } from 'lucide-react';
import Link from 'next/link';

import { StatusBadge } from '@/components/data/status-badge';
import { messageOf } from '@/lib/api/errors';
import { formatNumber, formatTokens, formatXaf, shortId } from '@/lib/format';
import { ANOMALY_TYPE, label, LEDGER_KIND, PAYMENT_STATUS, WALLET_STATUS } from '@/lib/labels';
import type { FinanceOverview } from '@/types/admin';

import { reconciliationQuery } from './api';
import { DetailCard, DetailHeading, DetailRow } from './detail-card';
import {
  depositsWithoutPayment,
  MOVEMENT_GROUPS,
  movementLines,
  movementTotals,
  paymentMatches,
  purchasesByStatus,
  purchasesTotal,
  RESERVATION_LABEL,
  revenueConsistent,
  unsafeAmounts,
  type MovementGroup,
} from './finance-summary';

type Props = { overview: FinanceOverview | undefined };

/** Carte 9 : paiements CinetPay de la période, un statut par ligne (statuts exclusifs). */
export function PurchasesDetail({ overview: o }: Props) {
  const total = o && purchasesTotal(o);
  return (
    <DetailCard
      label="Achats CinetPay par statut (période)"
      value={total ? `${formatNumber(total.count)} paiements` : '—'}
      hint={total && `${formatXaf(total.amount)} au total · chaque paiement n’a qu’un statut`}
      icon={CreditCard}
      loading={!o}
      listLabel="Détail des achats CinetPay par statut"
    >
      {o && (
        <ul>
          {purchasesByStatus(o).map((p) => (
            <DetailRow
              key={p.status}
              label={<StatusBadge map={PAYMENT_STATUS} value={p.status} />}
              value={formatXaf(p.amount)}
              sub={`${formatNumber(p.count)} opération${p.count > 1 ? 's' : ''}`}
            />
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

const GROUP_TONE: Record<MovementGroup, 'success' | 'danger' | 'warning' | undefined> = {
  credit: 'success',
  debit: undefined,
  pending: 'warning',
  failed: 'danger',
  unknown: 'warning',
};

/**
 * Carte 10 : mouvements des comptes de jeu, en jetons. Crédits et débits effectifs, attente
 * et échecs séparés ; les réservations sont listées à part et ne sont jamais des débits.
 */
export function MovementsDetail({ overview: o }: Props) {
  const totals = o && movementTotals(o);
  const lines = o ? movementLines(o) : [];
  const groups = (Object.keys(MOVEMENT_GROUPS) as MovementGroup[]).filter((g) =>
    lines.some((l) => l.group === g),
  );
  return (
    <DetailCard
      label="Mouvements des comptes de jeu (période)"
      value={totals ? `+${formatTokens(totals.credit.tokens)}` : '—'}
      hint={
        totals &&
        `Crédits effectifs · débits effectifs : −${formatTokens(totals.debit.tokens)}. Jetons, pas des FCFA encaissés.`
      }
      icon={Layers}
      loading={!o}
      listLabel="Détail des mouvements des comptes de jeu"
    >
      {o && (
        <ul>
          {lines.length === 0 && <DetailRow label="Aucun mouvement sur la période" value="—" />}
          {groups.map((g) => [
            <DetailHeading key={`h-${g}`}>{MOVEMENT_GROUPS[g]}</DetailHeading>,
            ...lines
              .filter((l) => l.group === g)
              .map((l) => (
                <DetailRow
                  key={`${g}-${l.label}`}
                  label={l.label}
                  value={formatTokens(l.tokens)}
                  sub={`${formatNumber(l.count)} opération${l.count > 1 ? 's' : ''}`}
                  tone={GROUP_TONE[g]}
                />
              )),
          ])}
          <DetailHeading>Réservations de tournoi (non débitées)</DetailHeading>
          {o.reservations.length === 0 ? (
            <DetailRow label="Aucune réservation créée sur la période" value="—" />
          ) : (
            o.reservations.map((r) => (
              <DetailRow
                key={r.status}
                label={RESERVATION_LABEL[r.status] ?? r.status}
                value={formatTokens(r.amount)}
                sub={`${formatNumber(r.count)} réservation${r.count > 1 ? 's' : ''}`}
              />
            ))
          )}
        </ul>
      )}
    </DetailCard>
  );
}

/** Carte 11 : recettes réelles de la plateforme (`platform_ledger`) par nature, en FCFA. */
export function RevenueDetail({ overview: o }: Props) {
  return (
    <DetailCard
      label="Recettes par nature (période)"
      value={formatXaf(o?.platformRevenue.total)}
      hint="Écritures du compte de la plateforme. Aucune commission sur les parties ordinaires (règle non définie)."
      icon={HandCoins}
      loading={!o}
      listLabel="Détail des recettes par nature"
    >
      {o && (
        <ul>
          {o.platformRevenue.byKind.length === 0 ? (
            <DetailRow label="Aucune recette enregistrée sur la période" value="—" />
          ) : (
            o.platformRevenue.byKind.map((k) => (
              <DetailRow
                key={k.kind}
                label={label(LEDGER_KIND, k.kind)}
                value={formatXaf(k.amount)}
                sub={`${formatNumber(k.count)} écriture${k.count > 1 ? 's' : ''}`}
              />
            ))
          )}
          <DetailRow label="Total" value={formatXaf(o.platformRevenue.total)} />
        </ul>
      )}
    </DetailCard>
  );
}

const WALLET_PAIR: Record<string, string> = {
  succeeded: 'Confirmés ↔ achats crédités',
  pending: 'En attente ↔ achats en attente',
  failed: 'Échoués ou expirés ↔ achats échoués',
};

/**
 * Carte 12 : contrôle de cohérence, en LECTURE SEULE (aucune correction déclenchée).
 * Rapprochement de la période calculé depuis `finance/overview`, puis anomalies ouvertes du
 * service de rapprochement (`reconciliation/anomalies`, tous paiements et tournois, non
 * limité à la période).
 */
export function ReconciliationDetail({ overview: o }: Props) {
  const rec = useQuery(reconciliationQuery());
  const orphans = o && depositsWithoutPayment(o);
  const unsafe = o ? unsafeAmounts(o) : [];
  const summary = rec.data?.summary;
  return (
    <DetailCard
      label="Rapprochement financier et anomalies"
      value={
        summary ? `${formatNumber(summary.total)} anomalie${summary.total > 1 ? 's' : ''}` : '—'
      }
      hint={
        summary
          ? `${formatNumber(summary.critical)} critique(s) · ${formatNumber(summary.warning)} avertissement(s) · contrôle en lecture seule`
          : rec.error
            ? `Anomalies indisponibles : ${messageOf(rec.error)}`
            : 'Contrôle en lecture seule'
      }
      icon={ArrowLeftRight}
      loading={!o}
      listLabel="Détail du rapprochement financier"
      footer={
        <Link href="/rapprochement" className="text-info hover:underline">
          Ouvrir le rapprochement complet
        </Link>
      }
    >
      {o && orphans && (
        <ul>
          <DetailHeading>Paiements CinetPay ↔ achats rattachés (période)</DetailHeading>
          {paymentMatches(o).map((m) => (
            <DetailRow
              key={m.walletStatus}
              label={
                <>
                  {WALLET_PAIR[m.walletStatus]}{' '}
                  <StatusBadge map={WALLET_STATUS} value={m.walletStatus} />
                </>
              }
              value={`${formatNumber(m.payments.count)} · ${formatXaf(m.payments.amount)}`}
              sub={`${formatNumber(m.deposits.count)} · ${formatTokens(m.deposits.tokens)}${m.matches ? '' : ' — écart'}`}
              tone={m.matches ? undefined : 'danger'}
            />
          ))}
          <DetailRow
            label="Achats sans paiement CinetPay (période)"
            value={formatTokens(orphans.tokens)}
            sub={`${formatNumber(orphans.count)} opération${orphans.count > 1 ? 's' : ''} · jamais créditées`}
            tone={orphans.count > 0 ? 'warning' : undefined}
          />
          <DetailRow
            label="Recettes : total = somme des natures"
            value={revenueConsistent(o) ? 'Cohérent' : 'Écart'}
            tone={revenueConsistent(o) ? 'success' : 'danger'}
          />
          {unsafe.length > 0 && (
            <DetailRow
              label="Montants au-delà de la précision exacte"
              value={unsafe.join(', ')}
              tone="danger"
            />
          )}
          <DetailHeading>Anomalies ouvertes (tous contrôles)</DetailHeading>
          {rec.isPending && <DetailRow label="Chargement…" value="" />}
          {rec.error && (
            <DetailRow label="Indisponible" value={messageOf(rec.error)} tone="danger" />
          )}
          {summary &&
            (summary.total === 0 ? (
              <DetailRow label="Aucune anomalie détectée" value="0" tone="success" />
            ) : (
              Object.entries(summary.byType).map(([type, count]) => (
                <DetailRow
                  key={type}
                  label={label(ANOMALY_TYPE, type)}
                  value={formatNumber(count)}
                  tone="warning"
                />
              ))
            ))}
          {rec.data && rec.data.items.length > 0 && (
            <>
              <DetailHeading>Dernières anomalies (références)</DetailHeading>
              {rec.data.items.slice(0, 5).map((a) => (
                <DetailRow
                  key={`${a.type}-${a.reference.id}`}
                  label={`${label(ANOMALY_TYPE, a.type)} · ${a.reference.label}`}
                  // Achat du compte de jeu sans paiement : montant en jetons, jamais encaissé.
                  value={
                    a.amount === null
                      ? '—'
                      : a.reference.kind === 'WALLET_TRANSACTION'
                        ? formatTokens(a.amount)
                        : formatXaf(a.amount)
                  }
                  sub={`${a.reference.kind} ${shortId(a.reference.id)}`}
                  tone={a.severity === 'CRITICAL' ? 'danger' : 'warning'}
                />
              ))}
            </>
          )}
        </ul>
      )}
    </DetailCard>
  );
}
