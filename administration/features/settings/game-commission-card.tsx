'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api/errors';
import { formatDateTime, formatNumber, formatTokens } from '@/lib/format';
import type { GameCommissionSettings, GameCommissionTier } from '@/types/admin';

import {
  addTier,
  gameCommissionQuery,
  removeTier,
  sameSchedule,
  saveGameCommission,
  simulate,
  toDraft,
  updateTier,
  validateDraft,
  type DraftTier,
  type VictoryType,
} from './game-commission';

const percentText = (p: number) => `${p.toLocaleString('fr-FR')} %`;

function rangeText(t: GameCommissionTier) {
  return t.maxStake === null
    ? `${formatNumber(t.minStake)} et plus`
    : `${formatNumber(t.minStake)} – ${formatNumber(t.maxStake)}`;
}

/** Barème en lecture seule (valeurs enregistrées par le serveur). */
function TiersTable({ tiers }: { tiers: GameCommissionTier[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Barème de commission enregistré</caption>
      <thead>
        <tr className="text-muted border-line border-b text-left text-xs">
          <th className="py-2 font-medium">Mise minimale</th>
          <th className="py-2 font-medium">Mise maximale</th>
          <th className="py-2 text-right font-medium">Taux</th>
        </tr>
      </thead>
      <tbody>
        {tiers.map((t) => (
          <tr key={t.minStake} className="border-line border-b last:border-0">
            <td className="text-ink py-2">{formatNumber(t.minStake)}</td>
            <td className="text-ink py-2">
              {t.maxStake === null ? (
                <Badge tone="info">Sans plafond</Badge>
              ) : (
                formatNumber(t.maxStake)
              )}
            </td>
            <td className="text-ink py-2 text-right font-medium">{percentText(t.percent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TiersEditor({
  draft,
  onChange,
  settings,
  disabled,
}: {
  draft: DraftTier[];
  onChange: (next: DraftTier[]) => void;
  settings: GameCommissionSettings;
  disabled: boolean;
}) {
  const { rows } = validateDraft(draft, settings.limits, settings.maxTiers);
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <caption className="sr-only">Barème de commission en cours de modification</caption>
        <thead>
          <tr className="text-muted border-line border-b text-left text-xs">
            <th className="py-2 font-medium">Mise minimale</th>
            <th className="py-2 font-medium">Mise maximale</th>
            <th className="py-2 font-medium">Taux (%)</th>
            <th className="py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <tr key={row.key} className="border-line border-b align-top last:border-0">
                <td className="py-2 pr-3">
                  <Input
                    aria-label={`Mise minimale de la tranche ${n}`}
                    inputMode="numeric"
                    value={row.minStake}
                    disabled={disabled}
                    aria-invalid={Boolean(row.errors.minStake)}
                    onChange={(e) =>
                      onChange(updateTier(draft, row.key, { minStake: e.target.value }))
                    }
                  />
                  {row.errors.minStake && (
                    <p className="text-danger mt-1 text-xs">{row.errors.minStake}</p>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {row.last ? (
                    <div className="pt-2">
                      <Badge tone="info">Sans plafond</Badge>
                    </div>
                  ) : (
                    <>
                      <Input
                        aria-label={`Mise maximale de la tranche ${n}`}
                        inputMode="numeric"
                        value={row.maxStake}
                        disabled={disabled}
                        aria-invalid={Boolean(row.errors.maxStake)}
                        onChange={(e) =>
                          onChange(updateTier(draft, row.key, { maxStake: e.target.value }))
                        }
                      />
                      {row.errors.maxStake && (
                        <p className="text-danger mt-1 text-xs">{row.errors.maxStake}</p>
                      )}
                    </>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Input
                    aria-label={`Taux de la tranche ${n}`}
                    inputMode="decimal"
                    value={row.percent}
                    disabled={disabled}
                    aria-invalid={Boolean(row.errors.percent)}
                    onChange={(e) =>
                      onChange(updateTier(draft, row.key, { percent: e.target.value }))
                    }
                  />
                  {row.errors.percent && (
                    <p className="text-danger mt-1 text-xs">{row.errors.percent}</p>
                  )}
                </td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Supprimer la tranche ${n}`}
                    disabled={disabled || draft.length <= 1}
                    onClick={() => onChange(removeTier(draft, row.key))}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || draft.length >= settings.maxTiers}
        onClick={() => onChange(addTier(draft))}
      >
        <Plus /> Ajouter une tranche
      </Button>
      <p className="text-muted text-xs">
        La première tranche commence à 1 et chaque tranche commence juste après le plafond de la
        précédente : le barème ne doit avoir ni trou ni chevauchement. La dernière tranche est
        toujours sans plafond.
      </p>
    </div>
  );
}

function SimulationPanel({
  tiers,
  koraLossMultiplier,
  source,
}: {
  tiers: GameCommissionTier[] | null;
  koraLossMultiplier: number;
  source: 'saved' | 'draft';
}) {
  const [stake, setStake] = useState('100');
  const [players, setPlayers] = useState('3');
  const [victory, setVictory] = useState<VictoryType>('SIMPLE');
  const stakeValue = /^\d+$/.test(stake.trim()) ? Number(stake.trim()) : NaN;
  const result = tiers
    ? simulate(tiers, { stake: stakeValue, players: Number(players), victory, koraLossMultiplier })
    : null;

  return (
    <section aria-labelledby="simulation-title" className="border-line rounded-lg border p-4">
      <h3 id="simulation-title" className="text-ink flex items-center gap-2 text-sm font-semibold">
        <Calculator className="text-faint size-4" aria-hidden /> Simulation indicative
      </h3>
      <p className="text-muted mt-0.5 text-xs">
        {source === 'draft'
          ? 'Calculée avec le barème en cours de modification (non enregistré).'
          : 'Calculée avec le barème enregistré.'}{' '}
        Le résultat officiel est celui calculé par le serveur au règlement de la partie.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          id="sim-stake"
          label="Mise"
          error={Number.isNaN(stakeValue) || stakeValue < 1 ? 'Entier ≥ 1.' : undefined}
        >
          <Input
            id="sim-stake"
            inputMode="numeric"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </Field>
        <Field id="sim-players" label="Nombre de joueurs">
          <Select id="sim-players" value={players} onChange={(e) => setPlayers(e.target.value)}>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </Select>
        </Field>
        <Field id="sim-victory" label="Victoire">
          <Select
            id="sim-victory"
            value={victory}
            onChange={(e) => setVictory(e.target.value as VictoryType)}
          >
            <option value="SIMPLE">Simple</option>
            <option value="KORA">Kora</option>
          </Select>
        </Field>
      </div>
      {!tiers ? (
        <p className="text-muted mt-3 text-sm">Corrigez le barème pour lancer la simulation.</p>
      ) : result ? (
        <dl
          className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm"
          aria-label="Résultat de la simulation"
        >
          <dt className="text-muted">Tranche appliquée</dt>
          <dd className="text-ink text-right">
            {rangeText(result.tier)} · {percentText(result.tier.percent)}
          </dd>
          <dt className="text-muted">Taux appliqué</dt>
          <dd className="text-ink text-right">{percentText(result.appliedPercent)}</dd>
          <dt className="text-muted">Perte de chaque perdant</dt>
          <dd className="text-ink text-right">
            {formatTokens(result.lossPerLoser)} × {result.losers}
            {victory === 'KORA' && ` (Kora : mise × ${koraLossMultiplier})`}
          </dd>
          <dt className="text-muted">Montant redistribué (mises des perdants)</dt>
          <dd className="text-ink text-right" data-testid="sim-redistributed">
            {formatTokens(result.redistributed)}
          </dd>
          <dt className="text-muted">Commission estimée</dt>
          <dd className="text-ink text-right" data-testid="sim-commission">
            {formatTokens(result.commission)}
          </dd>
          <dt className="text-ink font-medium">Gain net du gagnant</dt>
          <dd className="text-ink text-right font-semibold" data-testid="sim-net">
            {formatTokens(result.netGain)}
          </dd>
          <dt className="text-muted text-xs">Disponible exigé de chaque joueur</dt>
          <dd className="text-muted text-right text-xs">
            {formatTokens(result.requiredBalance)} (2 × la mise)
          </dd>
        </dl>
      ) : null}
      <p className="text-faint mt-3 text-xs">
        Le gagnant garde sa propre mise ; la commission est arrondie à l’entier inférieur.
      </p>
    </section>
  );
}

/**
 * Barème de commission des parties ordinaires (D-074) : consultation, modification complète
 * envoyée en un PATCH `{ tiers }`, simulation indicative. Le serveur valide, enregistre et
 * audite ; rien n'est présenté comme enregistré avant sa réponse.
 */
export function GameCommissionCard() {
  const client = useQueryClient();
  const query = useQuery(gameCommissionQuery());
  /** null : consultation ; sinon brouillon local, conservé tant qu'il n'est pas enregistré. */
  const [draft, setDraft] = useState<DraftTier[] | null>(null);
  const [pending, setPending] = useState<GameCommissionTier[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const settings = query.data;

  const validation = useMemo(
    () => (draft && settings ? validateDraft(draft, settings.limits, settings.maxTiers) : null),
    [draft, settings],
  );
  const dirty = Boolean(
    draft && settings && (!validation?.tiers || !sameSchedule(validation.tiers, settings.tiers)),
  );

  // Modifications non enregistrées : le navigateur demande confirmation avant de quitter.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(tiers: GameCommissionTier[]) {
    setServerError(null);
    try {
      const result = await saveGameCommission(tiers);
      toast.success(
        result.changed === false
          ? 'Barème déjà à jour : rien n’a été modifié.'
          : 'Barème enregistré et audité.',
      );
    } catch (err) {
      // Les modifications locales sont conservées ; l'erreur du serveur est affichée.
      if (err instanceof ApiError && err.fields) {
        setServerError(Object.values(err.fields).join(' '));
      }
      throw err;
    }
    setDraft(null);
    await client.invalidateQueries({ queryKey: gameCommissionQuery().queryKey });
  }

  return (
    <Card id="commission-parties">
      <CardHeader
        title="Commission des parties ordinaires"
        description="Taux par tranche de mise, prélevé sur les mises des perdants. En victoire par Kora, chaque perdant perd 2 × la mise ; le taux reste celui de la tranche."
        actions={
          settings &&
          settings.tiers.length > 0 &&
          !draft && (
            <Button variant="secondary" size="sm" onClick={() => setDraft(toDraft(settings.tiers))}>
              Modifier
            </Button>
          )
        }
      />
      <CardBody className="space-y-5">
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !settings ? (
          <LoadingRows rows={4} />
        ) : settings.tiers.length === 0 ? (
          <EmptyState title="Aucune tranche">
            Le serveur n’a renvoyé aucune tranche. Rechargez la page ou contactez l’exploitation.
          </EmptyState>
        ) : (
          <>
            <p className="text-muted text-xs">
              Dernière modification :{' '}
              {settings.updatedAt ? formatDateTime(settings.updatedAt) : 'jamais (barème initial)'}
            </p>
            {draft ? (
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (validation?.tiers && dirty) setPending(validation.tiers);
                }}
              >
                <TiersEditor
                  draft={draft}
                  onChange={(next) => {
                    setDraft(next);
                    setServerError(null);
                  }}
                  settings={settings}
                  disabled={pending !== null}
                />
                {validation?.formError && (
                  <p role="alert" className="text-danger text-sm">
                    {validation.formError}
                  </p>
                )}
                {serverError && (
                  <p
                    role="alert"
                    className="bg-danger-soft text-danger rounded-md px-3 py-2 text-sm"
                  >
                    Refusé par le serveur : {serverError} Vos modifications sont conservées.
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={pending !== null}
                    onClick={() => {
                      setDraft(null);
                      setServerError(null);
                    }}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={!validation?.tiers || !dirty || pending !== null}>
                    Enregistrer
                  </Button>
                </div>
              </form>
            ) : (
              <TiersTable tiers={settings.tiers} />
            )}
            <InfoNote>
              Le taux est figé au démarrage de chaque partie : une modification s’applique aux
              parties démarrées ensuite. Les parties en cours et déjà réglées ne sont jamais
              recalculées.
            </InfoNote>
            <SimulationPanel
              tiers={draft ? (validation?.tiers ?? null) : settings.tiers}
              koraLossMultiplier={settings.koraLossMultiplier}
              source={draft ? 'draft' : 'saved'}
            />
          </>
        )}
      </CardBody>
      {pending && settings && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title="Enregistrer ce barème ?"
          description="Il s’appliquera aux parties démarrées après l’enregistrement. Les parties en cours et réglées ne sont pas recalculées. La modification est inscrite au journal d’audit."
          confirmLabel="Enregistrer"
          onConfirm={() => save(pending)}
        >
          <ul className="space-y-1 text-sm">
            {pending.map((t) => (
              <li key={t.minStake} className="flex justify-between gap-3">
                <span className="text-ink-soft">{rangeText(t)}</span>
                <span className="text-ink font-medium">{percentText(t.percent)}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </Card>
  );
}
