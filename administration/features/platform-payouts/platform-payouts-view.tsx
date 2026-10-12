'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Landmark,
  Lock,
  PiggyBank,
  Receipt,
  RefreshCw,
  Scale,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { DataTable, DetailList, Pagination, type Column } from '@/components/data/data-table';
import { StatCard } from '@/components/data/stat-card';
import { StatusBadge } from '@/components/data/status-badge';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { messageOf } from '@/lib/api/errors';
import { formatDateTime, formatXaf } from '@/lib/format';
import {
  BENEFICIARY_STATUS,
  entry,
  label,
  PAYOUT_ANOMALY,
  PAYOUT_BLOCKER,
  PLATFORM_PAYOUT_STATUS,
  TREASURY_STATE,
} from '@/lib/labels';
import type { PlatformFinanceOverview, PlatformPayoutRow } from '@/types/admin';

import { NoteDialog, readableError } from './note-dialog';
import {
  beneficiariesQuery,
  createBeneficiary,
  createPayout,
  disableBeneficiary,
  observeTreasury,
  overviewQuery,
  payoutsQuery,
  reconcile,
  verifyBeneficiary,
} from './api';

/** « Inconnu » n'est jamais affiché comme 0. */
const unknownOr = (value: number | null, text = 'Non confirmée') =>
  value === null ? (
    <span className="text-muted text-base font-medium">{text}</span>
  ) : (
    formatXaf(value)
  );

const STATUSES = Object.keys(PLATFORM_PAYOUT_STATUS);

export const payoutColumns: Column<PlatformPayoutRow>[] = [
  {
    key: 'ref',
    header: 'Référence',
    cell: (p) => (
      <span className="font-mono text-xs">
        {p.reference}
        {p.providerReference && (
          <span className="text-muted block">CinetPay : {p.providerReference}</span>
        )}
      </span>
    ),
  },
  { key: 'amount', header: 'Montant', align: 'right', cell: (p) => formatXaf(p.amount) },
  {
    key: 'fees',
    header: 'Frais (estimés / définitifs)',
    align: 'right',
    hideOnMobile: true,
    cell: (p) =>
      `${formatXaf(p.estimatedFee)} / ${p.finalFee === null ? '—' : formatXaf(p.finalFee)}`,
  },
  {
    key: 'beneficiary',
    header: 'Bénéficiaire',
    hideOnMobile: true,
    cell: (p) => (
      <span>
        {p.beneficiary.label}
        <span className="text-muted block font-mono text-xs">{p.beneficiary.msisdn}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Statut',
    cell: (p) => <StatusBadge map={PLATFORM_PAYOUT_STATUS} value={p.status} />,
  },
  {
    key: 'people',
    header: 'Initiateur / approbateur',
    hideOnMobile: true,
    cell: (p) => `${p.initiatedBy.username ?? '—'} / ${p.approvedBy?.username ?? '—'}`,
  },
  {
    key: 'issue',
    header: <span className="sr-only">Anomalie</span>,
    cell: (p) =>
      p.reconciliationResult || p.lastErrorCode ? (
        <Badge tone={p.status === 'RECONCILIATION_REQUIRED' ? 'danger' : 'warning'}>
          <AlertTriangle className="size-3" aria-hidden />{' '}
          {p.reconciliationResult ?? p.lastErrorCode}
        </Badge>
      ) : null,
  },
  { key: 'created', header: 'Créée', hideOnMobile: true, cell: (p) => formatDateTime(p.createdAt) },
];

function Indicators({ o }: { o: PlatformFinanceOverview }) {
  const [stateLabel] = entry(TREASURY_STATE, o.treasury.state);
  const charges =
    o.revenue.charges.playerTransferFees +
    o.revenue.charges.executedPayouts +
    o.revenue.charges.executedPayoutFees;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Revenus comptables validés"
        value={formatXaf(o.revenue.validatedRevenue)}
        icon={Receipt}
        hint="Somme du journal des recettes (platform_ledger)"
      />
      <StatCard
        label="Charges et retraits exécutés"
        value={formatXaf(charges)}
        icon={Scale}
        hint={`Frais des retraits joueurs ${formatXaf(o.revenue.charges.playerTransferFees)} · retraits ${formatXaf(o.revenue.charges.executedPayouts)} · frais ${formatXaf(o.revenue.charges.executedPayoutFees)}`}
      />
      <StatCard
        label="Revenus distribuables"
        value={formatXaf(o.revenue.distributable)}
        icon={PiggyBank}
        tone="accent"
      />
      <StatCard
        label="Montants réservés"
        value={formatXaf(o.revenue.reserved)}
        icon={Lock}
        tone="info"
        hint="Retraits approuvés non finalisés (montant + frais estimés)"
      />
      <StatCard
        label="Trésorerie CinetPay confirmée"
        value={unknownOr(o.treasury.confirmedAvailable)}
        icon={Landmark}
        tone={o.treasury.state === 'CONFIRMED' ? 'success' : 'warning'}
        hint={`${stateLabel}${o.treasury.lastObservation ? ` · relue le ${formatDateTime(o.treasury.lastObservation.observedAt)}` : ' · jamais relue'}`}
      />
      <StatCard
        label="Trésorerie libre"
        value={unknownOr(o.treasury.free)}
        icon={Wallet}
        hint={`Après ${formatXaf(o.treasury.obligations.total)} dus aux joueurs`}
      />
      <StatCard
        label="Frais estimés"
        value={
          o.fees.configured ? (
            unknownOr(o.fees.estimateForWithdrawable, 'Inconnus')
          ) : (
            <span className="text-muted text-base font-medium">Barème non configuré</span>
          )
        }
        icon={Banknote}
        hint={
          o.fees.configured
            ? `${(o.fees.bps ?? 0) / 100} % + ${formatXaf(o.fees.fixed)} par transfert`
            : undefined
        }
      />
      <StatCard
        label="Montant retirable"
        value={unknownOr(o.withdrawable.amount, 'Bloqué')}
        icon={ArrowLeftRight}
        tone={o.withdrawable.amount ? 'success' : 'warning'}
        hint={
          o.withdrawable.blockers.map((b) => label(PAYOUT_BLOCKER, b)).join(' ') ||
          'min(revenus distribuables, trésorerie libre), frais compris'
        }
      />
    </div>
  );
}

function ExecutionNotice({ o }: { o: PlatformFinanceOverview }) {
  if (!o.execution.enabled) {
    return (
      <InfoNote>
        <strong>Exécution des transferts désactivée</strong> (
        {label(PAYOUT_BLOCKER, o.execution.reason ?? 'EXECUTION_DISABLED')}). Les demandes peuvent
        être créées, approuvées et réservées, mais aucune ne peut être mise en exécution ni envoyée
        à CinetPay. L’activation relève d’une procédure distincte (D-078).
      </InfoNote>
    );
  }
  return (
    <p
      role="status"
      className="bg-warning-soft text-warning rounded-lg px-4 py-3 text-sm font-medium"
    >
      Exécution activée ({o.execution.mode === 'live' ? 'production · fonds réels' : 'sandbox'}).
    </p>
  );
}

function Obligations({ o }: { o: PlatformFinanceOverview }) {
  const anomalies = [...o.revenue.anomalies, ...o.treasury.anomalies];
  return (
    <Card>
      <CardHeader
        title="Obligations et anomalies"
        description="Fonds des joueurs déduits en priorité de la trésorerie relue"
      />
      <CardBody>
        <DetailList
          items={[
            ['Soldes des comptes de jeu', formatXaf(o.treasury.obligations.walletBalances)],
            ['Retraits des joueurs en cours', formatXaf(o.treasury.obligations.openWithdrawals)],
            ['Fonds de tournoi détenus', formatXaf(o.treasury.obligations.tournamentFundsHeld)],
            ['Total dû aux joueurs', formatXaf(o.treasury.obligations.total)],
            ['Rapprochements requis', String(o.reconciliationRequired)],
            [
              'CinetPay (relecture du solde)',
              o.treasury.providerConfigured ? 'Configuré' : 'Non configuré',
            ],
          ]}
        />
        {anomalies.length > 0 && (
          <ul className="mt-4 space-y-1.5" aria-label="Anomalies">
            {anomalies.map((a) => (
              <li key={a} className="text-warning flex gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{' '}
                {label(PAYOUT_ANOMALY, a)}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Feedback({ error, ok }: { error: unknown; ok: string | null }) {
  if (error)
    return (
      <p role="alert" className="bg-danger-soft text-danger mt-3 rounded-md px-3 py-2 text-sm">
        {messageOf(readableError(error))}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="bg-success-soft text-success mt-3 rounded-md px-3 py-2 text-sm">
        {ok}
      </p>
    );
  return null;
}

function Beneficiaries({ onChange }: { onChange: () => Promise<void> }) {
  const query = useQuery(beneficiariesQuery());
  const [form, setForm] = useState({ label: '', msisdn: '' });
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setOk(null);
    try {
      await action();
      setOk(success);
      await query.refetch();
      await onChange();
    } catch (err) {
      setError(err);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(
      () => createBeneficiary(form),
      'Bénéficiaire enregistré : un autre administrateur doit le vérifier.',
    );
    setForm({ label: '', msisdn: '' });
  }

  return (
    <Card>
      <CardHeader
        title="Bénéficiaires MTN Mobile Money"
        description="Numéros masqués ; vérification hors système par un autre administrateur"
      />
      <CardBody>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !query.data ? (
          <LoadingRows rows={2} />
        ) : query.data.beneficiaries.length === 0 ? (
          <p className="text-muted text-sm">Aucun bénéficiaire enregistré.</p>
        ) : (
          <ul className="divide-line divide-y">
            {query.data.beneficiaries.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  {b.label} <span className="text-muted font-mono text-xs">{b.msisdn}</span>
                  <span className="text-muted block text-xs">
                    Enregistré par {b.createdBy.username ?? '—'}
                    {b.verifiedBy && ` · vérifié par ${b.verifiedBy.username ?? '—'}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge map={BENEFICIARY_STATUS} value={b.status} />
                  {b.status === 'PENDING_VERIFICATION' && (
                    <Button size="sm" variant="secondary" onClick={() => setVerifying(b.id)}>
                      Attester la vérification
                    </Button>
                  )}
                  {b.status !== 'DISABLED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(() => disableBeneficiary(b.id), 'Bénéficiaire désactivé.')
                      }
                    >
                      Désactiver
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={submit}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field id="b-label" label="Libellé">
            <Input
              id="b-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              required
              minLength={3}
              maxLength={80}
            />
          </Field>
          <Field id="b-msisdn" label="Numéro MTN (Cameroun)">
            <Input
              id="b-msisdn"
              inputMode="tel"
              autoComplete="off"
              placeholder="+237 6XX XX XX XX"
              value={form.msisdn}
              onChange={(e) => setForm({ ...form, msisdn: e.target.value })}
              required
            />
          </Field>
          <Button type="submit">Enregistrer</Button>
        </form>
        <Feedback error={error} ok={ok} />
        <NoteDialog
          open={verifying !== null}
          onOpenChange={(open) => !open && setVerifying(null)}
          title="Attester la vérification du bénéficiaire"
          description="Vous attestez avoir vérifié, hors de Le Ter, que ce numéro est un compte MTN Mobile Money du bénéficiaire autorisé. Celui qui a enregistré le numéro ne peut pas l’attester."
          confirmLabel="Attester"
          required
          minLength={10}
          noteLabel="Vérification effectuée"
          onConfirm={async (note) => {
            await verifyBeneficiary(verifying!, note!);
            setOk('Bénéficiaire vérifié.');
            await query.refetch();
            await onChange();
          }}
        />
      </CardBody>
    </Card>
  );
}

function NewPayout({
  o,
  onCreated,
}: {
  o: PlatformFinanceOverview;
  onCreated: () => Promise<void>;
}) {
  const beneficiaries = useQuery(beneficiariesQuery());
  const active = beneficiaries.data?.beneficiaries.filter((b) => b.status === 'ACTIVE') ?? [];
  const [form, setForm] = useState({ beneficiaryId: '', amount: '', purpose: '' });
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const blocked = o.withdrawable.amount === null || o.withdrawable.amount === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setPending(true);
    try {
      const { payout } = await createPayout({
        beneficiaryId: form.beneficiaryId,
        amount: Number(form.amount),
        purpose: form.purpose,
      });
      setOk(`Demande ${payout.reference} créée : un autre administrateur doit l’approuver.`);
      setForm({ beneficiaryId: '', amount: '', purpose: '' });
      await onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Nouvelle demande de retrait"
        description={`Montant retirable : ${o.withdrawable.amount === null ? 'bloqué' : formatXaf(o.withdrawable.amount)}`}
      />
      <CardBody>
        {blocked && (
          <p className="text-warning mb-3 text-sm">
            {o.withdrawable.blockers.map((b) => label(PAYOUT_BLOCKER, b)).join(' ') ||
              'Aucun montant retirable.'}
          </p>
        )}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field id="p-beneficiary" label="Bénéficiaire vérifié">
            <Select
              id="p-beneficiary"
              value={form.beneficiaryId}
              onChange={(e) => setForm({ ...form, beneficiaryId: e.target.value })}
              required
            >
              <option value="">{active.length ? 'Choisir…' : 'Aucun bénéficiaire vérifié'}</option>
              {active.map((b) => (
                <option key={b.id} value={b.id}>{`${b.label} (${b.msisdn})`}</option>
              ))}
            </Select>
          </Field>
          <Field
            id="p-amount"
            label="Montant (FCFA)"
            hint="Entier, 100 à 1 500 000 ; frais estimés ajoutés par le serveur"
          >
            <Input
              id="p-amount"
              type="number"
              inputMode="numeric"
              min={100}
              max={1_500_000}
              step={1}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </Field>
          <Field id="p-purpose" label="Motif" className="sm:col-span-2">
            <Input
              id="p-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              required
              minLength={5}
              maxLength={200}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || blocked || active.length === 0}>
              {pending ? 'Envoi…' : 'Créer la demande'}
            </Button>
          </div>
        </form>
        <Feedback error={error} ok={ok} />
      </CardBody>
    </Card>
  );
}

export function PlatformPayoutsView() {
  const router = useRouter();
  const client = useQueryClient();
  const overview = useQuery(overviewQuery());
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const payouts = useQuery(payoutsQuery({ page, status }));
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin', 'platform-finance'] });
  };

  async function run(action: () => Promise<unknown>, success: (r: never) => string) {
    setError(null);
    setOk(null);
    try {
      const result = await action();
      setOk(success(result as never));
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHeader
        title="Retraits de la plateforme"
        description="Revenus propres de Le Ter vers MTN Mobile Money (Cameroun) via CinetPay. Distinct des retraits des joueurs."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                void run(
                  observeTreasury,
                  (r: { observation: { status: string } }) =>
                    `Trésorerie relue : ${r.observation.status === 'VALID' ? 'solde confirmé' : `échec (${r.observation.status})`}.`,
                )
              }
            >
              <RefreshCw /> Relire la trésorerie
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void run(
                  reconcile,
                  (r: { checked: number }) =>
                    `Rapprochement effectué : ${r.checked} retrait(s) relu(s), aucun transfert initié.`,
                )
              }
            >
              <ArrowLeftRight /> Rapprocher
            </Button>
          </>
        }
      />
      <Feedback error={error} ok={ok} />
      {overview.error ? (
        <Card className="mt-4">
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Card>
      ) : !overview.data ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="mt-4 space-y-6">
          <ExecutionNotice o={overview.data} />
          <Indicators o={overview.data} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Obligations o={overview.data} />
            <NewPayout o={overview.data} onCreated={refresh} />
          </div>
          <Beneficiaries onChange={refresh} />
        </div>
      )}
      <Card className="mt-6">
        <CardHeader
          title="Demandes"
          actions={
            <Select
              aria-label="Statut"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-auto"
            >
              <option value="">Tous les statuts</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {entry(PLATFORM_PAYOUT_STATUS, s)[0]}
                </option>
              ))}
            </Select>
          }
        />
        <DataTable
          caption="Retraits de la plateforme"
          columns={payoutColumns}
          rows={payouts.data?.items}
          rowKey={(p) => p.id}
          loading={payouts.isFetching}
          error={payouts.error}
          onRetry={() => payouts.refetch()}
          empty="Aucune demande de retrait"
          onRowClick={(p) => router.push(`/retraits-plateforme/${p.id}`)}
        />
        {payouts.data && (
          <Pagination
            page={page}
            limit={payouts.data.limit}
            total={payouts.data.total}
            onPage={setPage}
          />
        )}
      </Card>
    </>
  );
}
