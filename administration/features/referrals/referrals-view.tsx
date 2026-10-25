'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Hourglass, ShieldAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, Pagination, type Column } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { StatCard } from '@/components/data/stat-card';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { ApiError } from '@/lib/api/errors';
import { formatDateTime, formatNumber, formatTokens } from '@/lib/format';

import {
  campaignSettingsQuery,
  referralKeys,
  referralOverviewQuery,
  referrersQuery,
  setCampaignStatus,
  updateRules,
  type AttentionCase,
  type CampaignSettings,
  type ReferrerRow,
  type RulesInput,
} from './api';
import { AuditLines, CampaignBadge, describeRules } from './referral-ui';

const ATTENTION: Record<AttentionCase['kind'], string> = {
  FLAGGED_ATTRIBUTION: 'Attribution en vérification',
  EVALUATION_FAILING: 'Évaluation en erreur',
  TIER_WITHHELD: 'Palier atteint non crédité',
  REFEREE_DISABLED: 'Filleul désactivé (non compté)',
};

const columns: Column<ReferrerRow>[] = [
  {
    key: 'player',
    header: 'Parrain',
    cell: (r) => (
      <span>
        <span className="text-ink font-medium">{r.username}</span>
        <span className="text-muted block text-xs">n° {r.playerNumber}</span>
      </span>
    ),
  },
  { key: 'code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  { key: 'attributed', header: 'Inscrits', align: 'right', cell: (r) => formatNumber(r.attributed) },
  { key: 'qualified', header: 'Qualifiés', align: 'right', cell: (r) => formatNumber(r.qualified) },
  { key: 'counted', header: 'Comptés', align: 'right', hideOnMobile: true, cell: (r) => formatNumber(r.counted) },
  { key: 'tiers', header: 'Paliers', align: 'right', cell: (r) => formatNumber(r.tiers) },
  { key: 'tokens', header: 'Crédité', align: 'right', cell: (r) => formatTokens(r.tokensCredited) },
  {
    key: 'last',
    header: 'Dernière inscription',
    hideOnMobile: true,
    cell: (r) => formatDateTime(r.lastAttributionAt),
  },
];

/**
 * Parrainage (D-161) : pilotage de la campagne. Toutes les valeurs viennent du serveur, qui
 * qualifie et crédite seul. Aucune action ne crédite des jetons : règles et statut seulement.
 */
export function ReferralsView() {
  const overview = useQuery(referralOverviewQuery());
  const o = overview.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Parrainage"
        description="Codes personnels, filleuls attribués à l’inscription, qualification individuelle par les recharges confirmées et paliers crédités une seule fois."
        actions={o && <CampaignBadge status={o.campaign.status} />}
      />
      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            loading={!o}
            icon={Users}
            label="Inscriptions attribuées"
            value={formatNumber(o?.attributed)}
            hint={o && `${formatNumber(o.referrers)} parrains · ${formatNumber(o.activeCodes)} codes actifs`}
          />
          <StatCard
            loading={!o}
            icon={Users}
            tone="success"
            label="Filleuls qualifiés"
            value={formatNumber(o?.qualified)}
            hint={o && `${formatNumber(o.counted)} comptés dans les paliers`}
          />
          <StatCard
            loading={!o}
            icon={Gift}
            tone="accent"
            label="Récompenses créditées"
            value={formatNumber(o?.rewardsCredited)}
            hint={o && `${formatTokens(o.tokensDistributed)} distribués`}
          />
          <StatCard
            loading={!o}
            icon={Hourglass}
            tone="warning"
            label="En attente ou en erreur"
            value={o ? formatNumber(o.referrersWithWithheldTiers + o.queue.failing) : undefined}
            hint={
              o &&
              `${formatNumber(o.queue.pending)} évaluation(s) en file · ${formatNumber(o.queue.failing)} en erreur`
            }
          />
        </div>
      )}
      {o && <AttentionCard cases={o.attention} />}
      <ReferrersCard />
      <CampaignCard />
    </div>
  );
}

function AttentionCard({ cases }: { cases: AttentionCase[] }) {
  return (
    <Card>
      <CardHeader
        title="Cas à vérifier"
        description="Signaux d’examen : aucun ne déclare une fraude ni ne retire une récompense automatiquement."
      />
      <CardBody>
        {cases.length === 0 ? (
          <p className="text-muted text-sm">Aucun cas en attente.</p>
        ) : (
          <ul className="divide-line divide-y text-sm">
            {cases.map((c, i) => (
              <li key={`${c.kind}-${c.attributionId ?? c.referrerId}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
                <ShieldAlert className="text-warning size-4" aria-hidden />
                <Badge tone="warning">{ATTENTION[c.kind]}</Badge>
                <Link className="text-info hover:underline" href={`/parrainage/${c.referrerId}`}>
                  {c.referrerUsername}
                </Link>
                {c.detail && <span className="text-muted">{c.detail}</span>}
                <span className="text-faint ml-auto text-xs">{formatDateTime(c.since)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ReferrersCard() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState(['q'] as const);
  const query = useQuery(referrersQuery({ page, q: filters.q }));
  return (
    <Card>
      <CardHeader title="Parrains" description="Joueurs ayant au moins un filleul attribué." />
      <FilterBar onReset={filters.q ? reset : undefined}>
        <SearchInput
          label="Rechercher un parrain"
          placeholder="Pseudo ou code de parrainage"
          value={filters.q}
          onChange={(v) => setFilter('q', v)}
        />
      </FilterBar>
      <DataTable
        caption="Parrains"
        columns={columns}
        rows={query.data?.items}
        rowKey={(r) => r.userId}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty="Aucun parrain pour le moment."
        onRowClick={(r) => router.push(`/parrainage/${r.userId}`)}
      />
      {query.data && (
        <Pagination page={page} limit={query.data.limit} total={query.data.total} onPage={setPage} />
      )}
    </Card>
  );
}

function CampaignCard() {
  const query = useQuery(campaignSettingsQuery());
  return (
    <Card id="campagne">
      <CardHeader
        title="Campagne et règles"
        description="Chaque modification crée une nouvelle version : les paliers et qualifications déjà acquis gardent leurs règles. Tout changement est audité."
      />
      <CardBody>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !query.data ? (
          <LoadingRows rows={4} />
        ) : (
          <CampaignSettingsForm key={`${query.data.campaign.rules.version}-${query.data.campaign.status}`} settings={query.data} />
        )}
      </CardBody>
    </Card>
  );
}

const RULE_FIELDS = [
  ['referralsPerTier', 'Filleuls qualifiés par palier', 1, 1000],
  ['qualificationThreshold', 'Recharges confirmées exigées par filleul (jetons)', 1, 1_000_000_000],
  ['rewardPerTier', 'Récompense par palier (jetons)', 1, 1_000_000_000],
] as const;

function CampaignSettingsForm({ settings }: { settings: CampaignSettings }) {
  const client = useQueryClient();
  const { campaign, versions, history } = settings;
  const [form, setForm] = useState({
    referralsPerTier: String(campaign.rules.referralsPerTier),
    qualificationThreshold: String(campaign.rules.qualificationThreshold),
    rewardPerTier: String(campaign.rules.rewardPerTier),
    maxTiers: campaign.rules.maxTiers === null ? '' : String(campaign.rules.maxTiers),
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRules, setPendingRules] = useState<RulesInput>();
  const [statusReason, setStatusReason] = useState('');
  const [statusDialog, setStatusDialog] = useState(false);
  const nextStatus = campaign.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

  const refresh = () => client.invalidateQueries({ queryKey: referralKeys.all });

  function submit() {
    const found: Record<string, string> = {};
    const int = (key: string, min: number, max: number) => {
      const raw = form[key as keyof typeof form].trim();
      const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(n) || n < min || n > max) found[key] = `Entier entre ${min} et ${max}.`;
      return n;
    };
    const rules = {
      referralsPerTier: int('referralsPerTier', 1, 1000),
      qualificationThreshold: int('qualificationThreshold', 1, 1_000_000_000),
      rewardPerTier: int('rewardPerTier', 1, 1_000_000_000),
      maxTiers: form.maxTiers.trim() === '' ? null : int('maxTiers', 1, 100_000),
    };
    if (form.reason.trim().length < 3) found.reason = 'Motif obligatoire (3 caractères au moins).';
    setErrors(found);
    if (Object.keys(found).length === 0) setPendingRules({ ...rules, reason: form.reason.trim() });
  }

  async function saveRules(input: RulesInput) {
    try {
      const result = await updateRules(input);
      toast.success(result.changed ? 'Nouvelle version des règles enregistrée et auditée.' : 'Règles déjà à jour.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      throw err;
    }
    await refresh();
  }

  return (
    <div className="space-y-6">
      <InfoNote>
        En vigueur (version {campaign.rules.version}) : {describeRules(campaign.rules)}
      </InfoNote>
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-sm">
          <p className="text-muted text-xs">Statut</p>
          <CampaignBadge status={campaign.status} />
        </div>
        <Button variant={campaign.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => setStatusDialog(true)}>
          {campaign.status === 'ACTIVE' ? 'Suspendre la campagne' : 'Réactiver la campagne'}
        </Button>
      </div>
      <form
        noValidate
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {RULE_FIELDS.map(([key, label]) => (
          <Field key={key} id={`rule-${key}`} label={label} error={errors[key]}>
            <Input
              id={`rule-${key}`}
              inputMode="numeric"
              value={form[key]}
              aria-invalid={Boolean(errors[key])}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <Field id="rule-maxTiers" label="Nombre maximal de paliers" hint="Vide : aucun plafond." error={errors.maxTiers}>
          <Input
            id="rule-maxTiers"
            inputMode="numeric"
            value={form.maxTiers}
            onChange={(e) => setForm((f) => ({ ...f, maxTiers: e.target.value }))}
          />
        </Field>
        <Field id="rule-reason" label="Motif de la modification" error={errors.reason} className="md:col-span-2">
          <Textarea
            id="rule-reason"
            value={form.reason}
            maxLength={500}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit">Enregistrer une nouvelle version</Button>
        </div>
      </form>
      <section>
        <h3 className="text-ink mb-2 text-sm font-semibold">Versions des règles</h3>
        <ul className="divide-line divide-y text-sm">
          {versions.map((v) => (
            <li key={v.version} className="py-2">
              <span className="text-ink font-medium">v{v.version}</span> · {describeRules(v)}{' '}
              <span className="text-faint text-xs">({formatDateTime(v.createdAt)})</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-ink mb-2 text-sm font-semibold">Historique (audit)</h3>
        <AuditLines items={history} />
      </section>

      {pendingRules && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPendingRules(undefined)}
          title="Enregistrer une nouvelle version des règles ?"
          description="Les nouvelles règles valent pour les paliers et qualifications à venir ; ceux déjà acquis ne sont jamais réécrits. Tous les parrains sont réévalués."
          confirmLabel="Enregistrer"
          onConfirm={() => saveRules(pendingRules)}
        >
          <p className="text-ink text-sm">{describeRules(pendingRules)}</p>
        </ConfirmDialog>
      )}
      {statusDialog && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setStatusDialog(false);
              setStatusReason('');
            }
          }}
          title={nextStatus === 'SUSPENDED' ? 'Suspendre la campagne ?' : 'Réactiver la campagne ?'}
          description={
            nextStatus === 'SUSPENDED'
              ? 'Les nouvelles inscriptions par code seront refusées et aucun palier ne sera crédité pendant la suspension. Les récompenses acquises sont conservées.'
              : 'Les paliers atteints pendant la suspension seront crédités automatiquement par le serveur.'
          }
          confirmLabel={nextStatus === 'SUSPENDED' ? 'Suspendre' : 'Réactiver'}
          tone={nextStatus === 'SUSPENDED' ? 'danger' : 'primary'}
          onConfirm={async () => {
            await setCampaignStatus(nextStatus, statusReason.trim());
            toast.success('Statut de la campagne enregistré et audité.');
            await refresh();
          }}
        >
          <Field id="status-reason" label="Motif (obligatoire)">
            <Textarea
              id="status-reason"
              value={statusReason}
              maxLength={500}
              onChange={(e) => setStatusReason(e.target.value)}
            />
          </Field>
        </ConfirmDialog>
      )}
    </div>
  );
}
